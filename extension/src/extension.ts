import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { RunnerClient } from './runnerClient';
import { ResultPanel } from './resultPanel';

let client: RunnerClient | undefined;
let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
    output = vscode.window.createOutputChannel('LINQ Runner');
    context.subscriptions.push(output);

    context.subscriptions.push(
        vscode.commands.registerCommand('linqRunner.runCurrentFile', () => runCurrentFile(context)),
        vscode.commands.registerCommand('linqRunner.restartRunner', () => restartRunner()),
    );
}

export function deactivate(): void {
    client?.dispose();
    client = undefined;
}

function getClient(context: vscode.ExtensionContext): RunnerClient {
    if (client) {
        return client;
    }

    const config = vscode.workspace.getConfiguration('linqRunner');
    const dotnetPath = config.get<string>('dotnetPath', 'dotnet');
    const runnerPath = resolveRunnerPath(context, config.get<string>('runnerPath', ''));

    client = new RunnerClient(dotnetPath, runnerPath, (message) => output.appendLine(message));
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

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Running LINQ script…', cancellable: false },
        async () => {
            try {
                const result = await getClient(context).execute(source, rowLimit);
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
