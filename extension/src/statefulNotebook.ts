import * as vscode from 'vscode';
import { createHash, randomUUID } from 'crypto';
import { createNotebook, parseNotebook, writeNotebook } from './notebookModel';
import { ProfileManager, ResolvedProfile } from './profiles';
import { ExecuteResult, RunnerClient } from './runnerClient';
import { collectionOptions, output } from './collectionNotebook';
import { prepareCellDebug, writeCellSources } from './collectionDebug';

export const statefulType = 'linqRunner.notebook';
const resultMime = 'application/vnd.another-linq-tool.result+json';
const text = (data: Uint8Array): string => Buffer.from(data).toString('utf8');

export class StatefulSerializer implements vscode.NotebookSerializer {
    deserializeNotebook(content: Uint8Array): vscode.NotebookData {
        const notebook = content.length ? parseNotebook(text(content)) : createNotebook();
        const data = new vscode.NotebookData(notebook.cells.map(cell => {
            const value = new vscode.NotebookCellData(cell.language === 'markdown' ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code,
                cell.source, cell.language === 'markdown' ? 'markdown' : 'linq-csx');
            value.metadata = { id: cell.id, executionOrder: cell.executionOrder };
            value.outputs = cell.result ? [output(cell.result, 'inline')] : [];
            return value;
        }));
        data.metadata = { profile: notebook.profile };
        return data;
    }

    serializeNotebook(data: vscode.NotebookData): Uint8Array {
        const ids = new Set<string>();
        return Buffer.from(writeNotebook({ profile: data.metadata?.profile ?? '', cells: data.cells.map(cell => {
            const item = cell.outputs?.flatMap(value => value.items).find(value => value.mime === resultMime);
            let id = cell.metadata?.id;
            if (!id || ids.has(id)) { id = randomUUID(); }
            ids.add(id);
            return { id, language: cell.kind === vscode.NotebookCellKind.Markup ? 'markdown' : 'csharp', source: cell.value,
                ...(item ? { result: JSON.parse(text(item.data)), executionOrder: cell.metadata?.executionOrder } : {}) };
        }) }), 'utf8');
    }
}

interface Kernel {
    client: RunnerClient;
    identity: string;
    order: number;
}

export class StatefulNotebook implements vscode.Disposable {
    private readonly controller: vscode.NotebookController;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly kernels = new Map<string, Kernel>();
    private readonly starting = new Map<string, Promise<Kernel>>();
    private readonly queues = new Map<string, Promise<void>>();
    private readonly busy = new Set<string>();

    constructor(private readonly context: vscode.ExtensionContext, private readonly profiles: ProfileManager,
        private readonly createClient: (profile?: ResolvedProfile) => Promise<RunnerClient>) {
        this.controller = vscode.notebooks.createNotebookController('linqRunner.notebook.kernel', statefulType, 'Another LINQ Tool: C# Notebook');
        this.controller.supportedLanguages = ['linq-csx'];
        this.controller.supportsExecutionOrder = true;
        this.controller.executeHandler = cells => { void this.schedule(cells, false); };
        this.disposables.push(this.controller,
            vscode.workspace.registerNotebookSerializer(statefulType, new StatefulSerializer(), { transientOutputs: false }),
            vscode.workspace.onDidOpenNotebookDocument(notebook => {
                if (notebook.notebookType === statefulType) { this.controller.updateNotebookAffinity(notebook, vscode.NotebookControllerAffinity.Preferred); }
            }),
            vscode.workspace.onDidCloseNotebookDocument(notebook => this.reset(notebook)),
            vscode.window.tabGroups.onDidChangeTabs(event => {
                for (const tab of event.closed) {
                    if (!(tab.input instanceof vscode.TabInputNotebook) || tab.input.notebookType !== statefulType) { continue; }
                    const uri = tab.input.uri.toString();
                    const stillOpen = vscode.window.tabGroups.all.some(group => group.tabs.some(item =>
                        item.input instanceof vscode.TabInputNotebook && item.input.uri.toString() === uri));
                    if (!stillOpen) {
                        const notebook = vscode.workspace.notebookDocuments.find(item => item.uri.toString() === uri);
                        if (notebook) { this.reset(notebook); }
                    }
                }
            }),
            vscode.commands.registerCommand('linqRunner.newNotebook', (resource?: vscode.Uri) => this.create(resource)),
            vscode.commands.registerCommand('linqRunner.notebook.run', (cell?: vscode.NotebookCell) => this.run(cell, false)),
            vscode.commands.registerCommand('linqRunner.notebook.debug', (cell?: vscode.NotebookCell) => this.run(cell, true)),
            vscode.commands.registerCommand('linqRunner.notebook.runAll', () => {
                const notebook = this.active();
                return notebook && this.schedule(notebook.getCells(), false);
            }),
            vscode.commands.registerCommand('linqRunner.notebook.restart', () => this.restart(false)),
            vscode.commands.registerCommand('linqRunner.notebook.restartAndRunAll', () => this.restart(true)),
            vscode.commands.registerCommand('linqRunner.notebook.profile', () => this.selectProfile()),
            vscode.commands.registerCommand('linqRunner.notebook.clear', (cell?: vscode.NotebookCell) => this.clear(cell, false)),
            vscode.commands.registerCommand('linqRunner.notebook.clearAll', () => this.clear(undefined, true)),
            vscode.commands.registerCommand('linqRunner.notebook.xml', () => this.switchView(false)),
            vscode.commands.registerCommand('linqRunner.notebook.ui', () => this.switchView(true)),
            vscode.languages.registerCompletionItemProvider({ notebookType: statefulType, language: 'linq-csx' }, {
                provideCompletionItems: async (document, position, token) => {
                    const notebook = vscode.workspace.notebookDocuments.find(item => item.notebookType === statefulType
                        && item.getCells().some(cell => cell.document.uri.toString() === document.uri.toString()));
                    if (!notebook || this.busy.has(notebook.uri.toString())) { return []; }
                    const profile = await this.profile(notebook);
                    const kernel = await this.kernel(notebook, profile);
                    const options = collectionOptions(profile);
                    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
                    const namespace = /^\s*(?:\/\/\s*)?@namespace\s+(.*)$/i.exec(linePrefix);
                    const result = await kernel.client.complete(document.getText(), document.offsetAt(position), profile?.assemblies ?? [],
                        options.imports, profile?.packages ?? [], options.db, Boolean(namespace), token, true);
                    return (result.items ?? []).map(entry => {
                        const item = new vscode.CompletionItem(entry.label, entry.kind === 'method' ? vscode.CompletionItemKind.Method
                            : entry.kind === 'property' ? vscode.CompletionItemKind.Property : vscode.CompletionItemKind.Variable);
                        item.detail = entry.detail;
                        if (namespace) {
                            item.kind = vscode.CompletionItemKind.Module;
                            item.range = new vscode.Range(position.line, linePrefix.length - namespace[1].length, position.line, position.character);
                        }
                        return item;
                    });
                },
            }, '.', ' '),
            vscode.notebooks.registerNotebookCellStatusBarItemProvider(statefulType, {
                provideCellStatusBarItems: cell => {
                    const item = new vscode.NotebookCellStatusBarItem(cell.metadata.executionOrder
                        ? `Last execution: ${cell.metadata.executionOrder}` : 'Not executed in this session', vscode.NotebookCellStatusBarAlignment.Left);
                    item.tooltip = 'Saved outputs do not restore live variables. Restart and Run All rebuilds notebook state.';
                    return item;
                },
            }),
        );
    }

    dispose(): void {
        this.starting.clear();
        for (const kernel of this.kernels.values()) { kernel.client.dispose(); }
        this.kernels.clear();
        this.disposables.forEach(item => item.dispose());
    }

    private active(): vscode.NotebookDocument | undefined {
        const notebook = vscode.window.activeNotebookEditor?.notebook;
        return notebook?.notebookType === statefulType ? notebook : undefined;
    }

    private focused(candidate?: vscode.NotebookCell): vscode.NotebookCell | undefined {
        if (candidate?.notebook?.notebookType === statefulType) { return candidate; }
        const editor = vscode.window.activeNotebookEditor;
        const notebook = this.active();
        const index = editor?.selection.start ?? 0;
        return notebook && index < notebook.cellCount ? notebook.cellAt(index) : undefined;
    }

    private run(candidate: vscode.NotebookCell | undefined, debug: boolean): Promise<void> | undefined {
        const cell = this.focused(candidate);
        return cell ? this.schedule([cell], debug) : undefined;
    }

    private async profile(notebook: vscode.NotebookDocument): Promise<ResolvedProfile | undefined> {
        const selected = notebook.metadata.profile;
        const profile = await this.profiles.resolveActive(selected);
        if (selected && profile?.name !== selected) { throw new Error(`Notebook profile "${selected}" does not exist.`); }
        if (profile?.missing.length) { throw new Error(`Missing profile assemblies: ${profile.missing.join(', ')}`); }
        return profile;
    }

    private async kernel(notebook: vscode.NotebookDocument, profile?: ResolvedProfile): Promise<Kernel> {
        const key = notebook.uri.toString();
        const identity = JSON.stringify(profile ?? null);
        let kernel = this.kernels.get(key);
        if (kernel && kernel.identity !== identity) {
            throw new Error('The execution profile changed. Restart Kernel before continuing.');
        }
        if (kernel) { return kernel; }
        const existing = this.starting.get(key);
        if (existing) {
            kernel = await existing;
            if (kernel.identity !== identity) { throw new Error('The execution profile changed. Restart Kernel before continuing.'); }
            return kernel;
        }
        const pending = this.createClient(profile).then(client => {
            const created = { client, identity, order: 0 };
            if (this.starting.get(key) !== pending || notebook.isClosed) {
                client.dispose();
                throw new Error('Notebook kernel initialization was cancelled.');
            }
            this.kernels.set(key, created);
            return created;
        });
        this.starting.set(key, pending);
        try { return await pending; }
        finally { if (this.starting.get(key) === pending) { this.starting.delete(key); } }
    }

    private schedule(cells: readonly vscode.NotebookCell[], debug: boolean): Promise<void> {
        const notebook = cells[0]?.notebook;
        if (!notebook) { return Promise.resolve(); }
        const key = notebook.uri.toString();
        const pending = (this.queues.get(key) ?? Promise.resolve()).then(async () => {
            this.busy.add(key);
            try {
                for (const cell of [...cells].sort((left, right) => left.index - right.index)) {
                    if (notebook.isClosed || cell.index < 0) { break; }
                    if (cell.kind === vscode.NotebookCellKind.Markup) { continue; }
                    if (!await this.execute(cell, debug)) { break; }
                }
            } finally { this.busy.delete(key); }
        }).catch(error => { void vscode.window.showErrorMessage(`Notebook execution failed: ${String(error)}`); });
        this.queues.set(key, pending);
        return pending;
    }

    private async execute(cell: vscode.NotebookCell, debug: boolean): Promise<boolean> {
        await vscode.commands.executeCommand('notebook.selectKernel', { notebookEditor: cell.notebook.uri,
            id: this.controller.id, extension: this.context.extension.id });
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.start(Date.now());
        let session: vscode.DebugSession | undefined;
        let success = false;
        try {
            const profile = await this.profile(cell.notebook);
            const kernel = await this.kernel(cell.notebook, profile);
            const options = collectionOptions(profile);
            execution.executionOrder = ++kernel.order;
            const sources = await writeCellSources(this.context, cell.notebook);
            const debugSource = { sourcePath: sources[cell.index].path, sourceOffset: 0,
                sourceChecksum: createHash('sha256').update(cell.document.getText()).digest('hex') };
            if (debug) {
                const prepared = await prepareCellDebug(this.context, cell.notebook, cell, kernel.client, true);
                session = prepared.session;
            }
            const result = await kernel.client.execute(cell.document.getText(),
                vscode.workspace.getConfiguration('linqRunner').get<number>('rowLimit', 1000),
                profile?.assemblies ?? [], options.imports, profile?.packages ?? [], options.db, execution.token, debugSource, true);
            await execution.replaceOutput([output(result, 'inline')]);
            const edit = new vscode.WorkspaceEdit();
            edit.set(cell.notebook.uri, [vscode.NotebookEdit.updateCellMetadata(cell.index,
                { ...cell.metadata, id: cell.metadata.id || randomUUID(), executionOrder: kernel.order })]);
            await vscode.workspace.applyEdit(edit);
            success = result.status === 'success';
            if (execution.token.isCancellationRequested || result.status === 'cancelled') { this.reset(cell.notebook); }
        } catch (error) {
            const result: ExecuteResult = execution.token.isCancellationRequested
                ? { status: 'cancelled', elapsedMs: 0 }
                : { status: 'infrastructureError', elapsedMs: 0, error: { type: 'NotebookError', message: String(error) } };
            if (!cell.notebook.isClosed && cell.index >= 0) { await execution.replaceOutput([output(result, 'inline')]); }
            if (execution.token.isCancellationRequested) { this.reset(cell.notebook); }
        } finally {
            execution.end(success, Date.now());
            if (session) { await vscode.debug.stopDebugging(session); }
        }
        return success;
    }

    private reset(notebook: vscode.NotebookDocument): void {
        const key = notebook.uri.toString();
        this.kernels.get(key)?.client.dispose();
        this.kernels.delete(key);
        this.starting.delete(key);
    }

    private async restart(runAll: boolean): Promise<void> {
        const notebook = this.active();
        if (!notebook) { return; }
        if (this.busy.has(notebook.uri.toString())) {
            void vscode.window.showWarningMessage('Cancel the running cell before restarting the notebook kernel.');
            return;
        }
        this.reset(notebook);
        if (runAll) { await this.schedule(notebook.getCells(), false); }
    }

    private async selectProfile(): Promise<void> {
        const notebook = this.active();
        if (!notebook || this.busy.has(notebook.uri.toString())) { return; }
        const choice = await vscode.window.showQuickPick([{ label: '(Active profile)', value: '' },
            ...this.profiles.listProfiles().map(name => ({ label: name, value: name }))], { title: 'Notebook profile (restarts kernel)' });
        if (!choice) { return; }
        if (this.kernels.has(notebook.uri.toString())) {
            const confirm = await vscode.window.showWarningMessage('Changing profiles clears live notebook state. Saved results are kept.', { modal: true }, 'Restart Kernel');
            if (confirm !== 'Restart Kernel') { return; }
        }
        this.reset(notebook);
        const edit = new vscode.WorkspaceEdit();
        edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata({ ...notebook.metadata, profile: choice.value })]);
        await vscode.workspace.applyEdit(edit);
    }

    private async clear(candidate: vscode.NotebookCell | undefined, all: boolean): Promise<void> {
        const cell = this.focused(candidate);
        const notebook = cell?.notebook ?? this.active();
        if (!notebook || this.busy.has(notebook.uri.toString())) { return; }
        await vscode.commands.executeCommand('notebook.selectKernel', { id: this.controller.id, extension: this.context.extension.id });
        for (const item of all ? notebook.getCells() : cell ? [cell] : []) {
            if (item.kind !== vscode.NotebookCellKind.Code) { continue; }
            const execution = this.controller.createNotebookCellExecution(item);
            execution.start();
            await execution.clearOutput();
            execution.end(undefined);
        }
    }

    private async switchView(ui: boolean): Promise<void> {
        const document = this.active() ?? vscode.window.activeTextEditor?.document;
        if (!document) { return; }
        if (document.isDirty) {
            const choice = await vscode.window.showWarningMessage('Save notebook changes before switching views?', { modal: true }, 'Save');
            if (choice !== 'Save' || !await document.save()) { return; }
        }
        if (ui) {
            try { parseNotebook(text(await vscode.workspace.fs.readFile(document.uri))); }
            catch (error) { void vscode.window.showErrorMessage(String(error)); return; }
        }
        await vscode.commands.executeCommand('vscode.openWith', document.uri, ui ? statefulType : 'default');
    }

    private async create(resource?: vscode.Uri): Promise<void> {
        let directory = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (resource) {
            try { directory = (await vscode.workspace.fs.stat(resource)).type === vscode.FileType.Directory ? resource : vscode.Uri.joinPath(resource, '..'); }
            catch { directory = vscode.Uri.joinPath(resource, '..'); }
        }
        for (let suffix = 1; ; suffix++) {
            const name = suffix === 1 ? 'Untitled.linqnb' : `Untitled ${suffix}.linqnb`;
            const prospective = directory ? vscode.Uri.joinPath(directory, name) : vscode.Uri.parse(`untitled:${name}`);
            const uri = prospective.with({ scheme: 'untitled' });
            if ([...vscode.workspace.notebookDocuments, ...vscode.workspace.textDocuments].some(document => document.uri.toString() === uri.toString())) { continue; }
            if (directory) {
                try { await vscode.workspace.fs.stat(prospective); continue; } catch { }
            }
            await vscode.commands.executeCommand('vscode.openWith', uri, statefulType);
            return;
        }
    }
}