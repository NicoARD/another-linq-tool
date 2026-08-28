import * as fs from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { RunnerClient } from './runnerClient';
import { ResultPanel } from './resultPanel';
import { ProfileManager } from './profiles';
import { ConfigPanel } from './configPanel';
import { resolveManagedRunner, selectRunnerFramework } from './runtimeManager';

let client: RunnerClient | undefined;
let clientLaunchKey: string | undefined;
let output: vscode.OutputChannel;
let profiles: ProfileManager;
let statusBar: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    output = vscode.window.createOutputChannel('Another LINQ Tool');
    context.subscriptions.push(output);

    profiles = new ProfileManager(context.globalState, context.secrets);
    try {
        await profiles.migrateLegacyConfiguration();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output.appendLine(`Profile migration failed; continuing with current settings: ${message}`);
    }

    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.command = 'linqRunner.selectProfile';
    context.subscriptions.push(statusBar);
    updateStatusBar();

    context.subscriptions.push(
        vscode.commands.registerCommand('linqRunner.runCurrentFile', () => runCurrentFile(context)),
        vscode.commands.registerCommand('linqRunner.debugCurrentFile', () => debugCurrentFile(context)),
        vscode.commands.registerCommand('linqRunner.restartRunner', () => restartRunner()),
        vscode.commands.registerCommand('linqRunner.selectProfile', () => selectProfile()),
        vscode.commands.registerCommand('linqRunner.newLinqFile', (resource?: vscode.Uri) =>
            createLinqFile(resource)),
        vscode.commands.registerCommand('linqRunner.configure', () =>
            ConfigPanel.show(context, profiles, () => updateStatusBar())),
        vscode.commands.registerCommand('linqRunner.openGlobalProfiles', () =>
            ConfigPanel.show(context, profiles, () => updateStatusBar())),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('linqRunner.dotnetPath') || event.affectsConfiguration('linqRunner.runnerPath')) {
                client?.dispose();
                client = undefined;
                clientLaunchKey = undefined;
                output.appendLine('Runner launch configuration changed; the runner will restart on next use.');
            }
        }),
        vscode.languages.registerCompletionItemProvider(
            { language: 'linq-csx' },
            { provideCompletionItems: (document, position, token) => provideCompletionItems(context, document, position, token) },
            '.', '@', ' ',
        ),
    );
}

async function createLinqFile(resource?: vscode.Uri): Promise<void> {
    const extension = '.linq';
    const defaultName = 'Untitled.linq';
    let directory = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (resource) {
        try {
            const stat = await vscode.workspace.fs.stat(resource);
            directory = stat.type === vscode.FileType.Directory
                ? resource
                : vscode.Uri.joinPath(resource, '..');
        } catch {
            directory = vscode.Uri.joinPath(resource, '..');
        }
    }

    const baseName = path.basename(defaultName, extension);
    let untitled: vscode.Uri;
    for (let suffix = 1; ; suffix++) {
        const name = suffix === 1 ? defaultName : `${baseName} ${suffix}${extension}`;
        const prospective = directory
            ? vscode.Uri.joinPath(directory, name)
            : vscode.Uri.parse(`untitled:${name}`);
        untitled = prospective.scheme === 'untitled'
            ? prospective
            : prospective.with({ scheme: 'untitled' });

        const alreadyOpen = vscode.workspace.textDocuments.some(
            (document) => document.uri.toString() === untitled.toString(),
        );
        let alreadyExists = false;
        if (directory) {
            try {
                await vscode.workspace.fs.stat(prospective);
                alreadyExists = true;
            } catch {
                // An unused prospective filename is what we are looking for.
            }
        }
        if (!alreadyOpen && !alreadyExists) {
            break;
        }
    }

    const document = await vscode.workspace.openTextDocument(untitled);
    await vscode.languages.setTextDocumentLanguage(document, 'linq-csx');
    await vscode.window.showTextDocument(document);
}

async function provideCompletionItems(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    position: vscode.Position,
    cancellationToken: vscode.CancellationToken,
): Promise<vscode.CompletionItem[] | undefined> {
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const profileDirective = /^\s*(?:\/\/\s*)?@profile(?:\s+(.*))?$/i.exec(linePrefix);
    if (profileDirective) {
        const range = directiveValueRange(document, position, profileDirective[1]);
        return profiles.listProfiles().map((name) => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
            item.detail = 'Another LINQ Tool profile';
            item.range = range;
            return item;
        });
    }

    const namespaceDirective = /^\s*(?:\/\/\s*)?@namespace(?:\s+(.*))?$/i.exec(linePrefix);
    const xmlNamespace = /^\s*<Namespace>([^<]*)$/i.exec(linePrefix);
    const parsed = parseProfileDirective(document.getText());
    const profile = await profiles.resolveActive(parsed.profileName);
    if (cancellationToken.isCancellationRequested) {
        return undefined;
    }

    const prelude = profile?.prelude?.trim() ? `${profile.prelude}\n\n` : '';
    const source = prelude + parsed.body;
    const sourcePosition = prelude.length + document.offsetAt(position);
    const runnerClient = await getClient(
        context,
        profile?.assemblies ?? [],
        profile?.packages ?? [],
        profile?.targetFramework,
        profile?.efCoreVersion,
        profile?.provider,
    );
    const result = await runnerClient.complete(
        source,
        sourcePosition,
        profile?.assemblies ?? [],
        profile?.imports ?? [],
        profile?.packages ?? [],
        {
            context: profile?.context,
            provider: profile?.provider,
            contextFactoryType: profile?.contextFactoryType,
            contextFactoryMethod: profile?.contextFactoryMethod,
            efCoreVersion: profile?.efCoreVersion,
        },
        Boolean(namespaceDirective || xmlNamespace),
        cancellationToken,
    );
    if (result.error) {
        output.appendLine(`Completion failed: ${result.error}`);
        return undefined;
    }

    const namespaceMatch = namespaceDirective ?? xmlNamespace;
    const range = namespaceMatch
        ? directiveValueRange(document, position, namespaceMatch[1])
        : document.getWordRangeAtPosition(position);
    return result.items.map((entry) => {
        const item = new vscode.CompletionItem(entry.label, completionKind(entry.kind));
        item.detail = entry.detail;
        if (range) {
            item.range = range;
        }
        return item;
    });
}

function directiveValueRange(
    document: vscode.TextDocument,
    position: vscode.Position,
    value: string | undefined,
): vscode.Range {
    const length = value?.length ?? 0;
    return new vscode.Range(position.translate(0, -length), position);
}

function completionKind(kind: string): vscode.CompletionItemKind {
    switch (kind) {
        case 'namespace': return vscode.CompletionItemKind.Module;
        case 'interface': return vscode.CompletionItemKind.Interface;
        case 'enum': return vscode.CompletionItemKind.Enum;
        case 'struct': return vscode.CompletionItemKind.Struct;
        case 'class': return vscode.CompletionItemKind.Class;
        case 'method': return vscode.CompletionItemKind.Method;
        case 'property': return vscode.CompletionItemKind.Property;
        case 'field': return vscode.CompletionItemKind.Field;
        case 'event': return vscode.CompletionItemKind.Event;
        case 'variable': return vscode.CompletionItemKind.Variable;
        default: return vscode.CompletionItemKind.Value;
    }
}

export function deactivate(): void {
    client?.dispose();
    client = undefined;
    clientLaunchKey = undefined;
}

function updateStatusBar(): void {
    const active = profiles.getActiveName();
    statusBar.text = active ? `$(database) Another LINQ Tool: ${active}` : '$(database) Another LINQ Tool: no profile';
    statusBar.tooltip = 'Select the active Another LINQ Tool profile';
    statusBar.show();
}

async function selectProfile(): Promise<void> {
    const names = profiles.listProfiles();
    if (names.length === 0) {
        vscode.window.showInformationMessage(
            'Another LINQ Tool: no profiles found. Run "LINQ: Configure Profiles" to define profiles for all VS Code instances.',
        );
        return;
    }

    const active = profiles.getActiveName();
    const picked = await vscode.window.showQuickPick(
        names.map((name) => ({ label: name, description: name === active ? '(active)' : undefined })),
        { placeHolder: 'Select the active Another LINQ Tool profile' },
    );
    if (picked) {
        await profiles.setActive(picked.label);
        updateStatusBar();
    }
}
async function getClient(
    context: vscode.ExtensionContext,
    assemblies: readonly string[],
    packages: readonly string[],
    targetFramework?: 'net10.0' | 'net11.0',
    efCoreVersion?: string,
    provider?: string,
): Promise<RunnerClient> {
    const config = vscode.workspace.getConfiguration('linqRunner');
    const dotnetPath = config.get<string>('dotnetPath', 'dotnet');
    const configuredRunner = config.get<string>('runnerPath', '');
    const launch = configuredRunner
        ? resolveCustomRunnerLaunch(configuredRunner, dotnetPath)
        : await resolveManagedRunner(
            context,
            selectRunnerFramework(assemblies, targetFramework),
            (message) => output.appendLine(message),
        );
    const dependencyKey = fingerprintAssemblies(assemblies);
    const launchKey = JSON.stringify([
        launch.executable,
        ...launch.args,
        'framework' in launch ? launch.framework : 'custom',
        dependencyKey,
        [...packages].map((item) => item.trim().toLowerCase()).sort(),
        efCoreVersion?.trim().toLowerCase() ?? 'auto',
        provider?.trim().toLowerCase() ?? '',
    ]);
    if (client && clientLaunchKey === launchKey) {
        return client;
    }

    client?.dispose();
    prepareRunnerLaunch(launch);
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    output.appendLine(`Using ${'framework' in launch ? launch.framework : 'custom'} runner.`);
    client = new RunnerClient(
        launch.executable,
        launch.args,
        (message) => output.appendLine(message),
        cwd,
        launch.environment,
    );
    clientLaunchKey = launchKey;
    context.subscriptions.push({ dispose: () => client?.dispose() });
    return client;
}

/** Reads an optional `@profile <name>` directive and masks its text so diagnostics retain their line numbers. */
function parseProfileDirective(text: string): { profileName?: string; body: string } {
    let inQueryHeader = false;
    let offset = 0;

    for (const lineMatch of text.matchAll(/[^\r\n]*(?:\r\n|\n|$)/g)) {
        const rawLine = lineMatch[0];
        const line = rawLine.replace(/\r?\n$/, '');
        const trimmed = line.trim().replace(/^\uFEFF/, '');

        if (inQueryHeader) {
            inQueryHeader = !/<\/Query\s*>/i.test(trimmed);
        } else if (!trimmed) {
            // Blank lines are allowed within the metadata block.
        } else if (/^<Query\b/i.test(trimmed)) {
            inQueryHeader = !/<\/Query\s*>/i.test(trimmed);
        } else {
            const directive = /^(?:\/\/[ \t]*)?@(profile|kind|query|namespace)[ \t]+(.+?)[ \t]*$/i.exec(trimmed);
            if (!directive) {
                break;
            }

            if (directive[1].toLowerCase() === 'profile') {
                const masked = line.replace(/[^\r\n]/g, ' ');
                return {
                    profileName: directive[2].trim(),
                    body: text.slice(0, offset) + masked + text.slice(offset + line.length),
                };
            }
        }

        offset += rawLine.length;
        if (rawLine.length === 0) {
            break;
        }
    }

    return { body: text };
}

function fingerprintAssemblies(assemblies: readonly string[]): (string | number)[][] {
    const paths = new Set<string>();
    for (const assembly of assemblies) {
        const fullPath = path.resolve(assembly);
        paths.add(fullPath);

        const depsFile = fullPath.replace(/\.dll$/i, '.deps.json');
        if (fs.existsSync(depsFile)) {
            paths.add(depsFile);
        }

        const directory = path.dirname(fullPath);
        try {
            for (const sibling of fs.readdirSync(directory)) {
                if (/^Microsoft\.EntityFrameworkCore.*\.dll$/i.test(sibling)) {
                    paths.add(path.join(directory, sibling));
                }
            }
        } catch {
            // The primary path's missing-file fingerprint below will still force a safe relaunch.
        }
    }

    return [...paths].map((file) => {
        const identity = process.platform === 'win32' ? file.toLowerCase() : file;
        try {
            const stat = fs.statSync(file);
            return [identity, stat.size, stat.mtimeMs];
        } catch {
            return [identity, 0, 0];
        }
    }).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
}

interface RunnerLaunch {
    executable: string;
    args: string[];
    runnerPath: string;
    bundled: boolean;
    environment?: NodeJS.ProcessEnv;
}

function prepareRunnerLaunch(launch: RunnerLaunch): void {
    if (!fs.existsSync(launch.runnerPath)) {
        const source = launch.bundled ? 'bundled runner' : 'configured runner';
        throw new Error(`${source} not found at ${launch.runnerPath}. ${launch.bundled ? 'Reinstall the extension or configure Another LINQ Tool: Runner Path.' : 'Check Another LINQ Tool: Runner Path.'}`);
    }
}

function resolveCustomRunnerLaunch(configured: string, dotnetPath: string): RunnerLaunch {
    return path.extname(configured).toLowerCase() === '.dll'
        ? { executable: dotnetPath, args: [configured], runnerPath: configured, bundled: false }
        : { executable: configured, args: [], runnerPath: configured, bundled: false };
}

async function runCurrentFile(context: vscode.ExtensionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Another LINQ Tool: no active editor.');
        return;
    }

    const rowLimit = vscode.workspace.getConfiguration('linqRunner').get<number>('rowLimit', 1000);
    const title = path.basename(editor.document.fileName);

    const { profileName, body } = parseProfileDirective(editor.document.getText());
    const profile = await profiles.resolveActive(profileName);
    if (profileName && profile?.name !== profileName) {
        vscode.window.showWarningMessage(
            `Another LINQ Tool: profile "${profileName}" from the @profile directive was not found. Using "${profile?.name ?? 'no profile'}".`,
        );
    }
    const source = [profile?.prelude, body]
        .filter((part): part is string => Boolean(part?.trim()))
        .join('\n\n');
    if (profile?.missing.length) {
        output.appendLine(
            `Profile "${profile.name}": ${profile.missing.length} configured assembly path(s) not found:\n  ${profile.missing.join('\n  ')}`,
        );
        vscode.window.showWarningMessage(
            `Another LINQ Tool: profile "${profile.name}" has ${profile.missing.length} missing assembly path(s). Build the referenced project(s). See the Another LINQ Tool output for details.`,
        );
    }

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Running script…', cancellable: true },
        async (_progress, cancellationToken) => {
            try {
                const runnerClient = await getClient(
                    context,
                    profile?.assemblies ?? [],
                    profile?.packages ?? [],
                    profile?.targetFramework,
                    profile?.efCoreVersion,
                    profile?.provider,
                );
                const result = await runnerClient.execute(
                    source,
                    rowLimit,
                    profile?.assemblies ?? [],
                    profile?.imports ?? [],
                    profile?.packages ?? [],
                    {
                        context: profile?.context,
                        provider: profile?.provider,
                        connectionString: profile?.connectionString,
                        contextFactoryType: profile?.contextFactoryType,
                        contextFactoryMethod: profile?.contextFactoryMethod,
                        efCoreVersion: profile?.efCoreVersion,
                    },
                    cancellationToken,
                );
                ResultPanel.show(result, title);
            } catch (err) {
                if (cancellationToken.isCancellationRequested) {
                    ResultPanel.show({ status: 'cancelled', elapsedMs: 0 }, title);
                    return;
                }
                const message = err instanceof Error ? err.message : String(err);
                output.appendLine(`Execution failed: ${message}`);
                vscode.window.showErrorMessage(`Another LINQ Tool: execution failed. ${message}`);
            }
        },
    );
}

async function debugCurrentFile(context: vscode.ExtensionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Another LINQ Tool: no active editor.');
        return;
    }
    const rowLimit = vscode.workspace.getConfiguration('linqRunner').get<number>('rowLimit', 1000);
    const title = path.basename(editor.document.fileName);
    const documentText = editor.document.getText();
    const { profileName, body } = parseProfileDirective(documentText);
    const profile = await profiles.resolveActive(profileName);
    if (profileName && profile?.name !== profileName) {
        vscode.window.showWarningMessage(
            `Another LINQ Tool: profile "${profileName}" from the @profile directive was not found. Using "${profile?.name ?? 'no profile'}".`,
        );
    }

    const prelude = profile?.prelude?.trim() ? `${profile.prelude}\n\n` : '';
    const source = prelude + body;
    let debugSession: vscode.DebugSession | undefined;
    try {
        const runnerClient = await getClient(
            context,
            profile?.assemblies ?? [],
            profile?.packages ?? [],
            profile?.targetFramework,
            profile?.efCoreVersion,
            profile?.provider,
        );
        const processId = await runnerClient.processId();
        const started = await vscode.debug.startDebugging(undefined, {
            type: 'coreclr',
            name: `Debug ${title}`,
            request: 'attach',
            processId: String(processId),
            justMyCode: false,
            requireExactSource: false,
        });
        if (!started) {
            throw new Error('The .NET debugger could not attach to the runner.');
        }

        debugSession = vscode.debug.activeDebugSession;
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Debugging script…', cancellable: true },
            (_progress, cancellationToken) => runnerClient.execute(
                source,
                rowLimit,
                profile?.assemblies ?? [],
                profile?.imports ?? [],
                profile?.packages ?? [],
                {
                    context: profile?.context,
                    provider: profile?.provider,
                    connectionString: profile?.connectionString,
                    contextFactoryType: profile?.contextFactoryType,
                    contextFactoryMethod: profile?.contextFactoryMethod,
                    efCoreVersion: profile?.efCoreVersion,
                },
                cancellationToken,
                {
                    sourcePath: editor.document.fileName,
                    sourceOffset: prelude.length,
                    sourceChecksum: createHash('sha256').update(documentText, 'utf8').digest('hex'),
                },
            ),
        );
        ResultPanel.show(result, title);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output.appendLine(`Debugging failed: ${message}`);
        vscode.window.showErrorMessage(`Another LINQ Tool: debugging failed. ${message}`);
    } finally {
        if (debugSession?.type === 'coreclr' && debugSession.name === `Debug ${title}`) {
            await vscode.debug.stopDebugging(debugSession);
        }
    }
}

async function restartRunner(): Promise<void> {
    if (!client) {
        return;
    }
    output.appendLine('Restarting runner…');
    await client.restart();
    vscode.window.showInformationMessage('Another LINQ Tool: runner restarted.');
}
