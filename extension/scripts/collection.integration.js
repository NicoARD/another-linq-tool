const vscode = require('vscode');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

exports.run = async () => {
    const root = path.resolve(__dirname, '..');
    const report = process.env.LINQ_COLLECTION_REPORT;
    const results = [];
    let uri;
    let aliasUri;
    try {
        const extension = vscode.extensions.getExtension('N-Tsoulos.another-linq-tool');
        assert.ok(extension, 'Development extension is installed');
        await extension.activate();
        const creationDirectory = vscode.Uri.file(await fs.mkdtemp(path.join(os.tmpdir(), 'collection-create-')));
        await vscode.commands.executeCommand('linqRunner.newCollection', creationDirectory);
        const firstUntitled = vscode.window.activeNotebookEditor.notebook;
        const comparablePath = value => process.platform === 'win32' ? value.toLowerCase() : value;
        assert.equal(firstUntitled.isUntitled, true);
        assert.equal(firstUntitled.notebookType, 'linqRunner.collection');
        assert.equal(comparablePath(firstUntitled.uri.path), comparablePath(vscode.Uri.joinPath(creationDirectory, 'Untitled.linqc').path));
        assert.equal(firstUntitled.cellCount, 3);
        assert.equal(firstUntitled.cellAt(0).metadata.role, 'namespaces');
        assert.equal(firstUntitled.cellAt(0).document.getText(), '@namespace System.Text');
        await vscode.commands.executeCommand('linqRunner.newCollection', creationDirectory);
        const secondUntitled = vscode.window.activeNotebookEditor.notebook;
        assert.equal(secondUntitled.isUntitled, true);
        assert.equal(comparablePath(secondUntitled.uri.path), comparablePath(vscode.Uri.joinPath(creationDirectory, 'Untitled 2.linqc').path));
        assert.deepEqual(await fs.readdir(creationDirectory.fsPath), []);
        await fs.rmdir(creationDirectory.fsPath);
        results.push('New collection matches the script workflow: untitled notebook, Explorer folder, unique filenames, no disk writes');
        await vscode.workspace.getConfiguration('linqRunner').update('runnerPath', path.join(root, 'runner', 'net8.0', 'LinqRunner.dll'), vscode.ConfigurationTarget.Global);
        const { createCollection, writeCollection, parseCollection } = require('../out/collectionModel');
        const collection = createCollection();
        collection.cells[0].source = 'var shared = new StringBuilder("40").Length + 38;';
        collection.cells[1].source = 'var answer = shared + 2;\nanswer';
        collection.cells.push({ id: 'second', role: 'script', source: 'shared + 3' });
        uri = vscode.Uri.file(path.join(os.tmpdir(), `collection-integration-${Date.now()}.linqc`));
        await vscode.workspace.fs.writeFile(uri, Buffer.from(writeCollection(collection)));
        const notebook = await vscode.workspace.openNotebookDocument(uri);
        await vscode.window.showNotebookDocument(notebook);
        await vscode.commands.executeCommand('notebook.selectKernel', { id: 'linqRunner.collection.kernel', extension: extension.id });
        assert.equal(notebook.notebookType, 'linqRunner.collection');
        assert.equal(notebook.cellCount, 4);
        const namespaceCompletions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', notebook.cellAt(0).document.uri, new vscode.Position(0, '@namespace System.Te'.length));
        assert.ok(namespaceCompletions.items.some(item => (typeof item.label === 'string' ? item.label : item.label.label) === 'System.Text'));
        await vscode.commands.executeCommand('linqRunner.collection.namespaces');
        assert.equal(vscode.window.activeNotebookEditor.selection.start, 0);
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('notebook.cell.collapseCellInput'));
        assert.ok(commands.includes('notebook.cell.expandCellInput'));
        await vscode.commands.executeCommand('linqRunner.collection.collapse', notebook.cellAt(2));
        await vscode.commands.executeCommand('linqRunner.collection.expand', notebook.cellAt(2));
        assert.equal(notebook.cellAt(2).document.getText(), collection.cells[1].source);
        results.push('Namespace block includes an example, completes namespace names, and blocks collapse/expand without changing code');
        results.push('Native notebook opens XML with prelude and two script cells');
        aliasUri = vscode.Uri.file(uri.fsPath.replace(/\.linqc$/, '.csxc'));
        await vscode.workspace.fs.writeFile(aliasUri, Buffer.from(writeCollection(collection)));
        const alias = await vscode.workspace.openNotebookDocument(aliasUri);
        assert.equal(alias.notebookType, 'linqRunner.collection');
        assert.equal(alias.cellAt(1).document.getText(), collection.cells[0].source);
        results.push('The .csxc alias opens with the same XML format and notebook controller');
        await vscode.commands.executeCommand('linqRunner.collection.run', notebook.cellAt(2));
        await vscode.commands.executeCommand('linqRunner.collection.run', notebook.cellAt(3));
        for (const [index, expected] of [[2, '42'], [3, '43']]) {
            const item = notebook.cellAt(index).outputs.flatMap(output => output.items).find(item => item.mime === 'application/vnd.another-linq-tool.result+json');
            assert.ok(item, `Script ${index} has persisted structured output`);
            const result = JSON.parse(Buffer.from(item.data).toString());
            assert.equal(result.status, 'success', JSON.stringify(result));
            assert.equal(result.value.text, expected);
        }
        results.push('Both cells execute independently with the shared prelude');
        const completionEdit = new vscode.WorkspaceEdit();
        completionEdit.insert(notebook.cellAt(3).document.uri, new vscode.Position(0, 0), 'shared.ToString();\n');
        await vscode.workspace.applyEdit(completionEdit);
        const completions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', notebook.cellAt(3).document.uri, new vscode.Position(0, 8));
        assert.ok(completions.items.some(item => (typeof item.label === 'string' ? item.label : item.label.label) === 'ToString'));
        results.push('Native cell completion sees the type of shared prelude variables');
        assert.ok(await notebook.save());
        const saved = parseCollection(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString());
        assert.equal(saved.namespaceSource, '@namespace System.Text');
        assert.equal(saved.cells[1].result.value.text, '42');
        assert.equal(saved.cells[2].result.value.text, '43');
        results.push('Real notebook save persists both structured results into XML');
        await vscode.commands.executeCommand('linqRunner.collection.clear', notebook.cellAt(2));
        assert.equal(notebook.cellAt(2).outputs.length, 0);
        assert.equal(notebook.cellAt(3).outputs.length, 1);
        await vscode.commands.executeCommand('linqRunner.collection.clearAll');
        await notebook.save();
        const cleared = parseCollection(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString());
        assert.ok(cleared.cells.every(cell => !cell.result));
        results.push('Per-cell and clear-all actions remove saved outputs without altering sibling results prematurely');
        await vscode.commands.executeCommand('linqRunner.collection.xml');
        assert.equal(vscode.window.activeTextEditor.document.uri.toString(), uri.toString());
        await vscode.commands.executeCommand('linqRunner.collection.ui');
        assert.equal(vscode.window.activeNotebookEditor.notebook.uri.toString(), uri.toString());
        results.push('XML/UI switching reopens the same saved resource');
        const current = vscode.window.activeNotebookEditor.notebook;
        const normalized = new Promise((resolve, reject) => {
            const timer = setTimeout(() => { listener.dispose(); reject(new Error('Prelude was not restored after native cell insertion.')); }, 10000);
            const listener = vscode.workspace.onDidChangeNotebookDocument(event => {
                if (event.notebook.uri.toString() === current.uri.toString()
                    && current.cellAt(0).metadata.role === 'namespaces' && current.cellAt(1).metadata.role === 'prelude' && current.cellCount === 5) {
                    listener.dispose(); clearTimeout(timer); resolve();
                }
            });
        });
        const inserted = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'shared + 4', 'linq-csx');
        const insertedEdit = new vscode.WorkspaceEdit();
        insertedEdit.set(current.uri, [vscode.NotebookEdit.insertCells(0, [inserted])]);
        await vscode.workspace.applyEdit(insertedEdit);
        await normalized;
        assert.equal(current.cellAt(1).document.getText(), collection.cells[0].source);
        assert.equal(current.cellAt(2).document.getText(), 'shared + 4');
        const deletedEdit = new vscode.WorkspaceEdit();
        deletedEdit.set(current.uri, [vscode.NotebookEdit.deleteCells(new vscode.NotebookRange(2, 3))]);
        await vscode.workspace.applyEdit(deletedEdit);
        results.push('Native insertion above the prelude preserves its role and restores it to the first position');
        const { RunnerClient } = require('../out/runnerClient');
        const standalone = new RunnerClient('dotnet', [path.join(root, 'runner', 'net8.0', 'LinqRunner.dll')], () => {});
        const standaloneCancellation = new vscode.CancellationTokenSource();
        try {
            const existingSource = await fs.readFile(path.join(root, '..', 'examples', 'hello.linq'), 'utf8');
            const regular = await standalone.execute(existingSource, 1000, [], [], [], {}, standaloneCancellation.token);
            assert.equal(regular.status, 'success', JSON.stringify(regular));
            results.push('Existing standalone hello.linq still executes through the unchanged RPC path');
        } finally { standaloneCancellation.dispose(); standalone.dispose(); }
        const debugCell = vscode.window.activeNotebookEditor.notebook.cellAt(2);
        const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(debugCell.document.uri, new vscode.Position(0, 0)));
        vscode.debug.addBreakpoints([breakpoint]);
        let resolveStopped;
        let rejectStopped;
        const stopped = new Promise((resolve, reject) => { resolveStopped = resolve; rejectStopped = reject; });
        const timer = setTimeout(() => rejectStopped(new Error('Cell breakpoint did not stop within 45 seconds.')), 45000);
        let stopCount = 0;
        const tracker = vscode.debug.registerDebugAdapterTrackerFactory('coreclr', {
            createDebugAdapterTracker: session => session.configuration.linqCollection ? {
                onDidSendMessage: message => {
                    if (message.type !== 'event' || message.event !== 'stopped') { return; }
                    (async () => {
                        const stack = await session.customRequest('stackTrace', { threadId: message.body.threadId });
                        const frame = stack.stackFrames[0];
                        assert.equal(frame.source.path, debugCell.document.uri.toString());
                        assert.equal(frame.line, stopCount === 0 ? 1 : 2);
                        const evaluated = await session.customRequest('evaluate', { expression: 'shared', frameId: frame.id, context: 'watch' });
                        assert.equal(evaluated.result, '40');
                        if (stopCount++ === 0) {
                            await session.customRequest('next', { threadId: message.body.threadId });
                            return;
                        }
                        const answer = await session.customRequest('evaluate', { expression: 'answer', frameId: frame.id, context: 'watch' });
                        assert.equal(answer.result, '42');
                        await session.customRequest('continue', { threadId: message.body.threadId });
                        resolveStopped();
                    })().catch(rejectStopped);
                },
            } : undefined,
        });
        try {
            const running = vscode.commands.executeCommand('linqRunner.collection.debug', debugCell);
            await stopped;
            await running;
            results.push('Cell breakpoint, notebook source navigation, stepping to line 2, and prelude/local inspection work');
        } finally {
            clearTimeout(timer);
            tracker.dispose();
            vscode.debug.removeBreakpoints([breakpoint]);
            if (vscode.debug.activeDebugSession) { await vscode.debug.stopDebugging(vscode.debug.activeDebugSession); }
        }
        if (report) { await fs.writeFile(report, JSON.stringify({ success: true, results }, null, 2)); }
        console.log(results.join('\n'));
    } catch (error) {
        if (report) { await fs.writeFile(report, JSON.stringify({ success: false, results, error: error.stack || String(error) }, null, 2)); }
        throw error;
    } finally {
        if (uri) { await vscode.workspace.fs.delete(uri).then(() => {}, () => {}); }
        if (aliasUri) { await vscode.workspace.fs.delete(aliasUri).then(() => {}, () => {}); }
    }
};