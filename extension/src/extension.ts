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
    const runnerPath = resolveRunnerPath(context, config.get<string>('runnerPath', ''));
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    client = new RunnerClient(dotnetPath, runnerPath, (message) => output.appendLine(message), cwd);
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

function resolveRunnerPath(context: vscode.ExtensionContext, configured: string): string {
    if (configured) {
        return configured;
    }
    return path.join(
        context.extensionPath,
        'runner',
        'LinqRunner.dll',
    );
}

async function runCurrentFile(context: vscode.ExtensionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Another LINQ Tool: no active editor.');
        return;
    }

    const runnerPath = resolveRunnerPath(context, vscode.workspace.getConfiguration('linqRunner').get<string>('runnerPath', ''));
    if (!fs.existsSync(runnerPath)) {
        vscode.window.showErrorMessage(
            `Another LINQ Tool: bundled runner not found at ${runnerPath}. Reinstall the extension or set Another LINQ Tool: Runner Path.`,
        );
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
        { location: vscode.ProgressLocation.Notification, title: 'Running script…', cancellable: false },
        async () => {
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
                );
                ResultPanel.show(result, title);
            } catch (err) {
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
