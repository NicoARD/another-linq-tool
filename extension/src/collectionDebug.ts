import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { realpathSync } from 'fs';
import { RunnerClient } from './runnerClient';

interface CellSource {
    uri: vscode.Uri;
    path: string;
}

function mapSources(message: unknown, sources: CellSource[], toAdapter: boolean): void {
    if (!message || typeof message !== 'object') { return; }
    const value = message as Record<string, unknown>;
    if (typeof value.path === 'string') {
        const source = sources.find(item => toAdapter
            ? value.path === item.uri.toString() || value.path === item.uri.toString(true)
            : String(value.path).replace(/\\/g, '/').toLowerCase() === item.path.replace(/\\/g, '/').toLowerCase());
        if (source) {
            value.path = toAdapter ? source.path : source.uri.toString();
            value.name = toAdapter ? source.path.split(/[\\/]/).pop() : 'Collection cell';
        }
    }
    for (const child of Object.values(value)) {
        if (Array.isArray(child)) { child.forEach(item => mapSources(item, sources, toAdapter)); }
        else if (child && typeof child === 'object') { mapSources(child, sources, toAdapter); }
    }
}

export async function prepareCellDebug(
    context: vscode.ExtensionContext,
    notebook: vscode.NotebookDocument,
    cell: vscode.NotebookCell,
    client: RunnerClient,
): Promise<{ session: vscode.DebugSession; sourcePath: string }> {
    const identity = createHash('sha256').update(notebook.uri.toString()).digest('hex').slice(0, 24);
    const directory = vscode.Uri.joinPath(context.globalStorageUri, 'collection-debug', identity);
    await vscode.workspace.fs.createDirectory(directory);
    const sources: CellSource[] = [];
    for (const item of notebook.getCells()) {
        const id = createHash('sha256').update(item.metadata.id || item.document.uri.toString()).digest('hex').slice(0, 24);
        const file = vscode.Uri.joinPath(directory, `${id}.csx`);
        await vscode.workspace.fs.writeFile(file, Buffer.from(item.document.getText(), 'utf8'));
        sources.push({ uri: item.document.uri, path: realpathSync.native(file.fsPath) });
    }
    const name = `Another LINQ Tool: Collection ${cell.index}`;
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory('coreclr', {
        createDebugAdapterTracker: session => session.configuration.linqCollection === identity ? {
            onWillReceiveMessage: message => mapSources(message, sources, true),
            onDidSendMessage: message => mapSources(message, sources, false),
        } : undefined,
    });
    let startedSession: vscode.DebugSession | undefined;
    const started = vscode.debug.onDidStartDebugSession(session => {
        if (session.configuration.linqCollection === identity) { startedSession = session; }
    });
    try {
        const attached = await vscode.debug.startDebugging(undefined, {
            type: 'coreclr', name, request: 'attach', processId: String(await client.processId()),
            justMyCode: false, requireExactSource: false, linqCollection: identity,
        });
        const session = startedSession ?? vscode.debug.activeDebugSession;
        if (!attached || session?.configuration.linqCollection !== identity) {
            throw new Error('The .NET debugger could not attach to the collection runner.');
        }
        const ended = vscode.debug.onDidTerminateDebugSession(terminated => {
            if (terminated.id === session.id) { tracker.dispose(); ended.dispose(); }
        });
        for (const source of sources) {
            const breakpoints = vscode.debug.breakpoints.filter((breakpoint): breakpoint is vscode.SourceBreakpoint =>
                breakpoint instanceof vscode.SourceBreakpoint && breakpoint.enabled && breakpoint.location.uri.toString() === source.uri.toString());
            await session.customRequest('setBreakpoints', {
                source: { path: source.path },
                breakpoints: breakpoints.map(breakpoint => ({
                    line: breakpoint.location.range.start.line + 1,
                    condition: breakpoint.condition, hitCondition: breakpoint.hitCondition, logMessage: breakpoint.logMessage,
                })),
            });
        }
        return { session, sourcePath: sources[cell.index].path };
    } catch (error) {
        tracker.dispose();
        if (startedSession) { await vscode.debug.stopDebugging(startedSession); }
        throw error;
    } finally {
        started.dispose();
    }
}