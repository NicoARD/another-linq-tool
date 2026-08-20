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

export function activate(context: vscode.ExtensionContext): void {
    output = vscode.window.createOutputChannel('LINQ Runner');
    context.subscriptions.push(output);

    profiles = new ProfileManager(context.workspaceState);

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
        vscode.commands.registerCommand('linqRunner.openGlobalProfiles', () => openGlobalProfiles()),
    );
}

export function deactivate(): void {
    client?.dispose();
    client = undefined;
}

function updateStatusBar(): void {
    const active = profiles.getActiveName();
    statusBar.text = active ? `$(database) LINQ: ${active}` : '$(database) LINQ: no profile';
    statusBar.tooltip = 'Select the active LINQ Runner profile';
    statusBar.show();
}

async function selectProfile(): Promise<void> {
    const names = profiles.listProfiles();
    if (names.length === 0) {
        vscode.window.showInformationMessage(
            'LINQ Runner: no profiles found. Add profiles to a workspace linqrunner.json, or run "LINQ: Open Global Profiles" to define them for all VS Code instances.',
        );
        return;
    }

    const active = profiles.getActiveName();
    const picked = await vscode.window.showQuickPick(
        names.map((name) => ({ label: name, description: name === active ? '(active)' : undefined })),
        { placeHolder: 'Select the active LINQ Runner profile' },
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

function resolveRunnerPath(context: vscode.ExtensionContext, configured: string): string {
    if (configured) {
        return configured;
    }
    return path.join(
        context.extensionPath,
        '..',
        'runner',
        'LinqRunner',
        'bin',
        'Debug',
        'net9.0',
        'LinqRunner.dll',
    );
}

async function runCurrentFile(context: vscode.ExtensionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('LINQ Runner: no active editor.');
        return;
    }

    const runnerPath = resolveRunnerPath(context, vscode.workspace.getConfiguration('linqRunner').get<string>('runnerPath', ''));
    if (!fs.existsSync(runnerPath)) {
        vscode.window.showErrorMessage(
            `LINQ Runner: runner not found at ${runnerPath}. Build it with "dotnet build" in runner/LinqRunner.`,
        );
        return;
    }

    const source = editor.document.getText();
    const rowLimit = vscode.workspace.getConfiguration('linqRunner').get<number>('rowLimit', 1000);
    const title = path.basename(editor.document.fileName);

    const profile = profiles.resolveActive();
    if (profile?.missing.length) {
        output.appendLine(
            `Profile "${profile.name}": ${profile.missing.length} configured assembly path(s) not found:\n  ${profile.missing.join('\n  ')}`,
        );
        vscode.window.showWarningMessage(
            `LINQ Runner: profile "${profile.name}" has ${profile.missing.length} missing assembly path(s). Build the referenced project(s). See the LINQ Runner output for details.`,
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
                vscode.window.showErrorMessage(`LINQ Runner: execution failed. ${message}`);
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
    vscode.window.showInformationMessage('LINQ Runner: runner restarted.');
}

// Opens (creating if needed) the global profiles file shared across all VS Code instances.
async function openGlobalProfiles(): Promise<void> {
    const target = profiles.globalConfigPath();
    if (!fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const template = {
            defaultProfile: 'app',
            profiles: {
                app: {
                    assemblies: ['C:/path/to/YourApp/bin/Debug/net9.0/YourApp.Data.dll'],
                    imports: ['YourApp.Data'],
                    context: 'YourApp.Data.AppDbContext',
                    provider: 'sqlserver',
                    connectionString: 'Server=localhost;Database=YourDb;User Id=sa;Password=...;Encrypt=True;TrustServerCertificate=True',
                },
            },
        };
        fs.writeFileSync(target, JSON.stringify(template, null, 2) + '\n', 'utf8');
    }
    const doc = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(doc);
    updateStatusBar();
}

