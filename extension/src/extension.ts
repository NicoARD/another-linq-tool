import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { RunnerClient } from './runnerClient';
import { ResultPanel } from './resultPanel';
import { ProfileManager } from './profiles';
import { ConfigPanel } from './configPanel';

let client: RunnerClient | undefined;
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
        vscode.commands.registerCommand('linqRunner.restartRunner', () => restartRunner()),
        vscode.commands.registerCommand('linqRunner.selectProfile', () => selectProfile()),
        vscode.commands.registerCommand('linqRunner.configure', () =>
            ConfigPanel.show(context, profiles, () => updateStatusBar())),
        vscode.commands.registerCommand('linqRunner.openGlobalProfiles', () =>
            ConfigPanel.show(context, profiles, () => updateStatusBar())),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('linqRunner.dotnetPath') || event.affectsConfiguration('linqRunner.runnerPath')) {
                client?.dispose();
                client = undefined;
                output.appendLine('Runner launch configuration changed; the runner will restart on next use.');
            }
        }),
    );
}

export function deactivate(): void {
    client?.dispose();
    client = undefined;
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
function getClient(context: vscode.ExtensionContext): RunnerClient {
    if (client) {
        return client;
    }

    const config = vscode.workspace.getConfiguration('linqRunner');
    const dotnetPath = config.get<string>('dotnetPath', 'dotnet');
    const launch = resolveRunnerLaunch(context, config.get<string>('runnerPath', ''), dotnetPath);
    prepareRunnerLaunch(launch);
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    client = new RunnerClient(launch.executable, launch.args, (message) => output.appendLine(message), cwd);
    context.subscriptions.push({ dispose: () => client?.dispose() });
    return client;
}

/** Reads an optional `@profile <name>` directive from the first line and returns the remaining script body. */
function parseProfileDirective(text: string): { profileName?: string; body: string } {
    const match = /^\s*(?:\/\/\s*)?@profile[ \t]+(.+?)[ \t]*(\r?\n|$)/.exec(text);
    if (!match) {
        return { body: text };
    }
    return { profileName: match[1].trim(), body: text.slice(match[0].length) };
}

interface RunnerLaunch {
    executable: string;
    args: string[];
    runnerPath: string;
    bundled: boolean;
}

function prepareRunnerLaunch(launch: RunnerLaunch): void {
    if (!fs.existsSync(launch.runnerPath)) {
        const source = launch.bundled ? 'bundled runner' : 'configured runner';
        throw new Error(`${source} not found at ${launch.runnerPath}. ${launch.bundled ? 'Reinstall the extension or configure Another LINQ Tool: Runner Path.' : 'Check Another LINQ Tool: Runner Path.'}`);
    }

    if (process.platform !== 'win32' && launch.bundled) {
        try {
            fs.chmodSync(launch.runnerPath, 0o755);
        } catch (err) {
            throw new Error(`bundled runner is not executable and its permissions could not be updated: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

function resolveRunnerLaunch(context: vscode.ExtensionContext, configured: string, dotnetPath: string): RunnerLaunch {
    if (configured) {
        return path.extname(configured).toLowerCase() === '.dll'
            ? { executable: dotnetPath, args: [configured], runnerPath: configured, bundled: false }
            : { executable: configured, args: [], runnerPath: configured, bundled: false };
    }

    const platforms: Partial<Record<NodeJS.Platform, string>> = {
        win32: 'win',
        linux: 'linux',
        darwin: 'osx',
    };
    const architectures: Partial<Record<NodeJS.Architecture, string>> = {
        x64: 'x64',
        arm64: 'arm64',
    };
    const platform = platforms[process.platform];
    const architecture = architectures[process.arch];
    if (!platform || !architecture) {
        throw new Error(`No bundled runner is available for ${process.platform}-${process.arch}. Configure Another LINQ Tool: Runner Path to use a custom runner.`);
    }

    const runnerPath = path.join(
        context.extensionPath,
        'runner',
        `${platform}-${architecture}`,
        process.platform === 'win32' ? 'LinqRunner.exe' : 'LinqRunner',
    );
    return { executable: runnerPath, args: [], runnerPath, bundled: true };
}

async function runCurrentFile(context: vscode.ExtensionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Another LINQ Tool: no active editor.');
        return;
    }

    const config = vscode.workspace.getConfiguration('linqRunner');
    let launch: RunnerLaunch;
    try {
        launch = resolveRunnerLaunch(
            context,
            config.get<string>('runnerPath', ''),
            config.get<string>('dotnetPath', 'dotnet'),
        );
    } catch (err) {
        vscode.window.showErrorMessage(`Another LINQ Tool: ${err instanceof Error ? err.message : String(err)}`);
        return;
    }
    try {
        prepareRunnerLaunch(launch);
    } catch (err) {
        vscode.window.showErrorMessage(`Another LINQ Tool: ${err instanceof Error ? err.message : String(err)}`);
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
                const result = await getClient(context).execute(
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

async function restartRunner(): Promise<void> {
    if (!client) {
        return;
    }
    output.appendLine('Restarting runner…');
    await client.restart();
    vscode.window.showInformationMessage('Another LINQ Tool: runner restarted.');
}
