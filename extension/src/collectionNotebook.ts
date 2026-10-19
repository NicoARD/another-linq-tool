import * as vscode from 'vscode';
import { createHash, randomUUID } from 'crypto';
import { CollectionCell, createCollection, parseCollection, ScriptCollection, writeCollection } from './collectionModel';
import { ProfileManager, ResolvedProfile } from './profiles';
import { DbOptions, ExecuteResult, RunnerClient } from './runnerClient';
import { renderBody, ResultPanel } from './resultPanel';

export const collectionType = 'linqRunner.collection';
const resultMime = 'application/vnd.another-linq-tool.result+json';
type GetClient = (profile?: ResolvedProfile) => Promise<RunnerClient>;

function encode(value: string): Uint8Array { return Buffer.from(value, 'utf8'); }
function decode(value: Uint8Array): string { return Buffer.from(value).toString('utf8'); }

function output(result: ExecuteResult, location: string): vscode.NotebookCellOutput {
    const body = location === 'panel' ? '' : `<details open><summary>${result.status} - ${result.elapsedMs} ms</summary>${renderBody(result)}</details>`;
    const style = '<style>table{border-collapse:collapse;max-width:100%}th,td{border:1px solid var(--vscode-panel-border);padding:4px 8px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere}.type{opacity:.7;font-size:11px}.error{color:var(--vscode-errorForeground)}details{margin:6px 0}summary{cursor:pointer}</style>';
    return new vscode.NotebookCellOutput([
        new vscode.NotebookCellOutputItem(encode(JSON.stringify(result)), resultMime),
        vscode.NotebookCellOutputItem.text(style + body, 'text/html'),
    ]);
}

export class CollectionSerializer implements vscode.NotebookSerializer {
    deserializeNotebook(content: Uint8Array): vscode.NotebookData {
        const collection = content.length ? parseCollection(decode(content)) : createCollection();
        const data = new vscode.NotebookData(collection.cells.map(cell => {
            const value = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, cell.source, 'linq-csx');
            value.metadata = { id: cell.id, role: cell.role, inputHash: cell.inputHash };
            value.outputs = cell.result ? [output(cell.result, collection.outputLocation)] : [];
            return value;
        }));
        data.metadata = { profile: collection.profile, namespaces: collection.namespaces, outputLocation: collection.outputLocation };
        return data;
    }

    serializeNotebook(data: vscode.NotebookData): Uint8Array {
        const collection: ScriptCollection = {
            profile: data.metadata?.profile ?? '', namespaces: data.metadata?.namespaces ?? [],
            outputLocation: data.metadata?.outputLocation ?? 'inline',
            cells: data.cells.map((cell, index) => {
                const resultItem = cell.outputs?.flatMap(item => item.items).find(item => item.mime === resultMime);
                return {
                    id: cell.metadata?.id || randomUUID(), role: index === 0 ? 'prelude' : 'script', source: cell.value,
                    ...(resultItem ? { result: JSON.parse(decode(resultItem.data)), inputHash: cell.metadata?.inputHash } : {}),
                } as CollectionCell;
            }),
        };
        if (!collection.cells.length) {
            collection.cells.push({ id: randomUUID(), role: 'prelude', source: '' });
        }
        return encode(writeCollection(collection));
    }
}

export function collectionOptions(profile?: ResolvedProfile, namespaces: string[] = []): { imports: string[]; db: DbOptions } {
    return {
        imports: [...new Set([...(profile?.imports ?? []), ...namespaces])],
        db: {
            context: profile?.context, provider: profile?.provider, connectionString: profile?.connectionString,
            contextFactoryType: profile?.contextFactoryType, contextFactoryMethod: profile?.contextFactoryMethod,
            efCoreVersion: profile?.efCoreVersion, bypassQueryFilters: profile?.bypassQueryFilters,
        },
    };
}

export class CollectionNotebook implements vscode.Disposable {
    private readonly controller: vscode.NotebookController;
    private readonly subscriptions: vscode.Disposable[] = [];
    private queue: Promise<void> = Promise.resolve();
    private readonly running = new Set<string>();
    private readonly normalizing = new Set<string>();
    private readonly statusChanged = new vscode.EventEmitter<void>();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly profiles: ProfileManager,
        private readonly getClient: GetClient,
    ) {
        this.controller = vscode.notebooks.createNotebookController('linqRunner.collection.kernel', collectionType, 'Another LINQ Tool');
        this.controller.supportedLanguages = ['linq-csx'];
        this.controller.executeHandler = (cells) => {
            for (const cell of cells.filter(item => cells.length === 1 || item.metadata.role !== 'prelude')) { void this.enqueue(cell, false); }
        };
        this.subscriptions.push(this.controller,
            this.statusChanged,
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.uri.scheme === 'vscode-notebook-cell') { this.statusChanged.fire(); }
            }),
            vscode.workspace.onDidOpenNotebookDocument(notebook => {
                if (notebook.notebookType === collectionType) { this.controller.updateNotebookAffinity(notebook, vscode.NotebookControllerAffinity.Preferred); }
            }),
            vscode.workspace.onDidChangeNotebookDocument(event => {
                if (event.notebook.notebookType === collectionType) {
                    this.statusChanged.fire();
                    if (event.contentChanges.length) { void this.normalize(event.notebook).catch(error => vscode.window.showErrorMessage(String(error))); }
                }
            }),
            vscode.workspace.registerNotebookSerializer(collectionType, new CollectionSerializer(), { transientOutputs: false }),
            vscode.commands.registerCommand('linqRunner.collection.run', (cell?: vscode.NotebookCell) => this.run(cell, false)),
            vscode.commands.registerCommand('linqRunner.collection.debug', (cell?: vscode.NotebookCell) => this.run(cell, true)),
            vscode.commands.registerCommand('linqRunner.collection.profile', () => this.selectProfile()),
            vscode.commands.registerCommand('linqRunner.collection.namespaces', () => this.editNamespaces()),
            vscode.commands.registerCommand('linqRunner.collection.output', () => this.selectOutput()),
            vscode.commands.registerCommand('linqRunner.collection.clear', (cell?: vscode.NotebookCell) => this.clear(cell, false)),
            vscode.commands.registerCommand('linqRunner.collection.clearAll', () => this.clear(undefined, true)),
            vscode.commands.registerCommand('linqRunner.collection.xml', () => this.switchView('default')),
            vscode.commands.registerCommand('linqRunner.collection.ui', () => this.switchView(collectionType)),
            vscode.commands.registerCommand('linqRunner.newCollection', (resource?: vscode.Uri) => this.create(resource)),
            vscode.notebooks.registerNotebookCellStatusBarItemProvider(collectionType, {
                onDidChangeCellStatusBarItems: this.statusChanged.event,
                provideCellStatusBarItems: async cell => {
                    const label = cell.metadata.role === 'prelude'
                        ? `Shared prelude | Profile: ${cell.notebook.metadata.profile || '(Active)'} | Namespaces: ${(cell.notebook.metadata.namespaces ?? []).join(', ') || '(None)'}`
                        : `Script ${cell.index}`;
                    const item = new vscode.NotebookCellStatusBarItem(label, vscode.NotebookCellStatusBarAlignment.Left);
                    item.tooltip = cell.metadata.role === 'prelude' ? 'Runs before every independent script block.' : 'Each block runs with a fresh shared prelude and database context.';
                    if (cell.outputs.length && cell.metadata.inputHash) {
                        const profile = await this.profiles.resolveActive(cell.notebook.metadata.profile);
                        if (cell.metadata.inputHash !== this.input(cell, profile).hash) {
                            const stale = new vscode.NotebookCellStatusBarItem('$(warning) Results out of date', vscode.NotebookCellStatusBarAlignment.Right);
                            stale.tooltip = 'Code or shared setup changed since these saved results were produced.';
                            return [item, stale];
                        }
                    }
                    return [item];
                },
            }),
        );
    }

    dispose(): void { this.subscriptions.forEach(item => item.dispose()); }

    private async normalize(notebook: vscode.NotebookDocument): Promise<void> {
        const key = notebook.uri.toString();
        if (this.normalizing.has(key) || notebook.isClosed) { return; }
        this.normalizing.add(key);
        try {
            const cells = notebook.getCells();
            const prelude = cells.find(cell => cell.metadata.role === 'prelude');
            if (!prelude || prelude.index !== 0) {
                const data = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, prelude?.document.getText() ?? '', 'linq-csx');
                data.metadata = { ...prelude?.metadata, id: prelude?.metadata.id || randomUUID(), role: 'prelude' };
                data.outputs = prelude?.outputs ? [...prelude.outputs] : [];
                const edit = new vscode.WorkspaceEdit();
                edit.set(notebook.uri, [
                    ...(prelude ? [vscode.NotebookEdit.deleteCells(new vscode.NotebookRange(prelude.index, prelude.index + 1))] : []),
                    vscode.NotebookEdit.insertCells(0, [data]),
                ]);
                await vscode.workspace.applyEdit(edit);
            }
            const ids = new Set<string>();
            const edits: vscode.NotebookEdit[] = [];
            for (const cell of notebook.getCells()) {
                const role = cell.index === 0 ? 'prelude' : 'script';
                let id = cell.metadata.id;
                if (!id || ids.has(id)) { id = randomUUID(); }
                ids.add(id);
                if (id !== cell.metadata.id || role !== cell.metadata.role) {
                    edits.push(vscode.NotebookEdit.updateCellMetadata(cell.index, { ...cell.metadata, id, role }));
                }
            }
            if (edits.length) {
                const edit = new vscode.WorkspaceEdit();
                edit.set(notebook.uri, edits);
                await vscode.workspace.applyEdit(edit);
            }
        } finally { this.normalizing.delete(key); }
    }

    private active(): vscode.NotebookDocument | undefined {
        const notebook = vscode.window.activeNotebookEditor?.notebook;
        return notebook?.notebookType === collectionType ? notebook : undefined;
    }

    private cell(candidate?: vscode.NotebookCell): vscode.NotebookCell | undefined {
        if (candidate?.notebook?.notebookType === collectionType) { return candidate; }
        const editor = vscode.window.activeNotebookEditor;
        return this.active()?.cellAt(editor?.selection.start ?? 0);
    }

    private async run(candidate: vscode.NotebookCell | undefined, debug: boolean): Promise<void> {
        const cell = this.cell(candidate);
        if (cell) { await this.enqueue(cell, debug); }
    }

    private enqueue(cell: vscode.NotebookCell, debug: boolean): Promise<void> {
        const key = cell.document.uri.toString();
        if (this.running.has(key)) { return Promise.resolve(); }
        this.running.add(key);
        const pending = this.queue.then(() => this.execute(cell, debug));
        this.queue = pending.catch(error => {
            void vscode.window.showErrorMessage(`Collection execution failed: ${error instanceof Error ? error.message : String(error)}`);
        }).finally(() => this.running.delete(key));
        return this.queue;
    }

    private async execute(cell: vscode.NotebookCell, debug: boolean): Promise<void> {
        if (cell.notebook.isClosed || cell.index < 0) { return; }
        await vscode.commands.executeCommand('notebook.selectKernel', {
            notebookEditor: cell.notebook.uri,
            id: this.controller.id,
            extension: this.context.extension.id,
        });
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.start(Date.now());
        let success = false;
        let session: vscode.DebugSession | undefined;
        try {
            const notebook = cell.notebook;
            const selected = notebook.metadata.profile as string | undefined;
            const profile = await this.profiles.resolveActive(selected);
            if (selected && profile?.name !== selected) { throw new Error(`Collection profile "${selected}" was not found.`); }
            if (profile?.missing.length) { throw new Error(`Missing profile assemblies: ${profile.missing.join(', ')}`); }
            const { prelude, source, hash } = this.input(cell, profile);
            const client = await this.getClient(profile);
            const options = collectionOptions(profile, notebook.metadata.namespaces);
            let debugSource: { sourcePath: string; sourceOffset: number; sourceChecksum: string } | undefined;
            if (debug) {
                const { prepareCellDebug } = await import('./collectionDebug');
                const prepared = await prepareCellDebug(this.context, notebook, cell, client);
                session = prepared.session;
                debugSource = { sourcePath: prepared.sourcePath, sourceOffset: prelude.length, sourceChecksum: createHash('sha256').update(cell.document.getText()).digest('hex') };
            }
            const result = await client.execute(source,
                vscode.workspace.getConfiguration('linqRunner').get<number>('rowLimit', 1000),
                profile?.assemblies ?? [], options.imports, profile?.packages ?? [], options.db, execution.token, debugSource);
            if (result.diagnostics && prelude) {
                const lineOffset = (prelude.match(/\n/g) ?? []).length;
                result.diagnostics = result.diagnostics.map(diagnostic => ({ ...diagnostic, line: Math.max(0, diagnostic.line - (debug ? 0 : lineOffset)) }));
            }
            if (cell.index >= 0 && !notebook.isClosed) {
                await this.metadata(notebook, vscode.NotebookEdit.updateCellMetadata(cell.index, { ...cell.metadata, id: cell.metadata.id || randomUUID(), inputHash: hash }));
                await execution.replaceOutput([output(result, notebook.metadata.outputLocation ?? 'inline')]);
                if (notebook.metadata.outputLocation === 'panel') { ResultPanel.show(result, `Script ${cell.index}`); }
            }
            success = result.status === 'success';
        } catch (error) {
            const result: ExecuteResult = execution.token.isCancellationRequested
                ? { status: 'cancelled', elapsedMs: 0 }
                : { status: 'infrastructureError', elapsedMs: 0, error: { type: 'CollectionError', message: error instanceof Error ? error.message : String(error) } };
            if (!cell.notebook.isClosed && cell.index >= 0) { await execution.replaceOutput([output(result, 'inline')]); }
        } finally {
            execution.end(success, Date.now());
            if (session) { await vscode.debug.stopDebugging(session); }
        }
    }

    private async metadata(notebook: vscode.NotebookDocument, edit: vscode.NotebookEdit): Promise<void> {
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.set(notebook.uri, [edit]);
        if (!await vscode.workspace.applyEdit(workspaceEdit)) { throw new Error('The collection could not be updated.'); }
    }

    private input(cell: vscode.NotebookCell, profile?: ResolvedProfile): { prelude: string; source: string; hash: string } {
        const prefix = [profile?.prelude, cell.metadata.role !== 'prelude'
            ? cell.notebook.getCells().find(item => item.metadata.role === 'prelude')?.document.getText() : '']
            .filter(value => Boolean(value?.trim())).join('\n\n');
        const prelude = prefix ? prefix + '\n\n' : '';
        const source = prelude + cell.document.getText();
        const { connectionString: _secret, ...identity } = profile ?? {};
        const hash = createHash('sha256').update(JSON.stringify([source, identity, cell.notebook.metadata.namespaces])).digest('hex');
        return { prelude, source, hash };
    }

    private async selectProfile(): Promise<void> {
        const notebook = this.active();
        if (!notebook) { return; }
        const items = [{ label: '(Active profile)', value: '' }, ...this.profiles.listProfiles().map(name => ({ label: name, value: name }))];
        const selected = await vscode.window.showQuickPick(items, { title: `Collection profile: ${notebook.metadata.profile || '(Active profile)'}` });
        if (selected) { await this.metadata(notebook, vscode.NotebookEdit.updateNotebookMetadata({ ...notebook.metadata, profile: selected.value })); }
    }

    private async editNamespaces(): Promise<void> {
        const notebook = this.active();
        if (!notebook) { return; }
        const value = await vscode.window.showInputBox({ title: 'Collection namespaces', value: (notebook.metadata.namespaces ?? []).join(', '), prompt: 'Comma-separated C# namespaces', validateInput: input => input.split(',').some(name => name.trim() && !/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/.test(name.trim())) ? 'Enter namespace names, without using or semicolons.' : undefined });
        if (value !== undefined) { await this.metadata(notebook, vscode.NotebookEdit.updateNotebookMetadata({ ...notebook.metadata, namespaces: [...new Set(value.split(',').map(name => name.trim()).filter(Boolean))] })); }
    }

    private async selectOutput(): Promise<void> {
        const notebook = this.active();
        if (!notebook) { return; }
        const selected = await vscode.window.showQuickPick([{ label: 'Under each block', value: 'inline' }, { label: 'Results panel', value: 'panel' }], { title: 'Collection output location' });
        if (!selected) { return; }
        await this.metadata(notebook, vscode.NotebookEdit.updateNotebookMetadata({ ...notebook.metadata, outputLocation: selected.value }));
        for (const cell of notebook.getCells()) {
            if (this.running.has(cell.document.uri.toString())) { continue; }
            const item = cell.outputs.flatMap(value => value.items).find(value => value.mime === resultMime);
            if (item) {
                const execution = this.controller.createNotebookCellExecution(cell);
                execution.start();
                await execution.replaceOutput([output(JSON.parse(decode(item.data)), selected.value)]);
                execution.end(undefined);
            }
        }
    }

    private async clear(candidate: vscode.NotebookCell | undefined, all: boolean): Promise<void> {
        const notebook = this.active() ?? candidate?.notebook;
        if (!notebook) { return; }
        for (const cell of all ? notebook.getCells() : [this.cell(candidate)].filter((value): value is vscode.NotebookCell => Boolean(value))) {
            if (this.running.has(cell.document.uri.toString())) { continue; }
            const execution = this.controller.createNotebookCellExecution(cell);
            execution.start();
            await execution.clearOutput();
            execution.end(undefined);
        }
    }

    private async switchView(viewType: string): Promise<void> {
        const notebook = this.active();
        const text = vscode.window.activeTextEditor?.document;
        const document = notebook ?? text;
        if (!document) { return; }
        if (document.isDirty) {
            const choice = await vscode.window.showWarningMessage('Save collection changes before switching views?', { modal: true }, 'Save');
            if (choice !== 'Save' || !await document.save()) { return; }
        }
        if (viewType === collectionType) {
            try { parseCollection(decode(await vscode.workspace.fs.readFile(document.uri))); }
            catch (error) { void vscode.window.showErrorMessage(String(error)); return; }
        }
        await vscode.commands.executeCommand('vscode.openWith', document.uri, viewType);
    }

    private async create(resource?: vscode.Uri): Promise<void> {
        let directory = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (resource) {
            try {
                const stat = await vscode.workspace.fs.stat(resource);
                directory = stat.type === vscode.FileType.Directory ? resource : vscode.Uri.joinPath(resource, '..');
            } catch {
                directory = vscode.Uri.joinPath(resource, '..');
            }
        }
        for (let suffix = 1; ; suffix++) {
            const name = suffix === 1 ? 'Untitled.linqc' : `Untitled ${suffix}.linqc`;
            const prospective = directory ? vscode.Uri.joinPath(directory, name) : vscode.Uri.parse(`untitled:${name}`);
            const untitled = prospective.scheme === 'untitled' ? prospective : prospective.with({ scheme: 'untitled' });
            const alreadyOpen = [...vscode.workspace.textDocuments, ...vscode.workspace.notebookDocuments]
                .some(document => document.uri.toString() === untitled.toString());
            let alreadyExists = false;
            if (directory) {
                try { await vscode.workspace.fs.stat(prospective); alreadyExists = true; } catch { }
            }
            if (alreadyOpen || alreadyExists) { continue; }
            await vscode.commands.executeCommand('vscode.openWith', untitled, collectionType);
            return;
        }
    }
}