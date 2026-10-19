const vscode = require('vscode');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { createNotebook, writeNotebook, parseNotebook } = require('../out/notebookModel');

exports.run = async () => {
    const results = [];
    const files = [];
    const result = cell => {
        const item = cell.outputs.flatMap(output => output.items).find(item => item.mime === 'application/vnd.another-linq-tool.result+json');
        assert.ok(item, 'Executed cell has structured output');
        return JSON.parse(Buffer.from(item.data).toString());
    };
    const replace = async (cell, source) => {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(cell.document.uri, new vscode.Range(new vscode.Position(0, 0), cell.document.positionAt(cell.document.getText().length)), source);
        assert.ok(await vscode.workspace.applyEdit(edit));
    };
    const open = async extension => {
        const data = createNotebook();
        data.cells.push({ id: 'test-markdown', language: 'markdown', source: '# Test notes' });
        data.cells[1].source = 'int notebookShared = 40;';
        data.cells[2].source = 'var notebookAnswer = notebookShared + 2;\nnotebookAnswer';
        const uri = vscode.Uri.file(path.join(os.tmpdir(), `stateful-${Date.now()}-${files.length}.${extension}`));
        files.push(uri);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(writeNotebook(data)));
        const notebook = await vscode.workspace.openNotebookDocument(uri);
        await vscode.window.showNotebookDocument(notebook);
        assert.equal(notebook.notebookType, 'linqRunner.notebook');
        assert.equal(notebook.cellAt(0).document.getText(), '@namespace System.Text');
        assert.equal(notebook.cellAt(3).kind, vscode.NotebookCellKind.Markup);
        return notebook;
    };
    try {
        await vscode.commands.executeCommand('linqRunner.newNotebook');
        const untitled = vscode.window.activeNotebookEditor.notebook;
        assert.equal(untitled.notebookType, 'linqRunner.notebook');
        assert.equal(untitled.isUntitled, true);
        assert.equal(untitled.cellCount, 3);
        assert.ok(untitled.getCells().every(cell => cell.kind === vscode.NotebookCellKind.Code));
        assert.ok(untitled.uri.path.endsWith('.linqnb'));
        assert.equal(untitled.cellAt(0).kind, vscode.NotebookCellKind.Code);
        assert.equal(untitled.cellAt(0).document.getText(), '@namespace System.Text');
        assert.ok(untitled.getCells().every(cell => !cell.metadata.role));
        results.push('New File creates an untitled stateful notebook with a namespace block and two code examples, without starter Markdown');
        const notebook = await open('linqnb');
        const namespaces = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', notebook.cellAt(0).document.uri,
            new vscode.Position(0, '@namespace System.Te'.length));
        assert.ok(namespaces.items.some(item => (typeof item.label === 'string' ? item.label : item.label.label) === 'System.Text'));
        results.push('The top namespace block includes an example and namespace-name IntelliSense');
        await vscode.commands.executeCommand('linqRunner.notebook.runAll');
        assert.equal(result(notebook.cellAt(2)).status, 'success', JSON.stringify(result(notebook.cellAt(2))));
        assert.equal(result(notebook.cellAt(2)).value.text, '42');
        assert.equal(notebook.cellAt(3).outputs.length, 0);
        assert.equal(notebook.cellAt(0).executionSummary.executionOrder, 1);
        assert.equal(notebook.cellAt(1).executionSummary.executionOrder, 2);
        assert.equal(notebook.cellAt(2).executionSummary.executionOrder, 3);
        results.push('Stateful Run All shares variables and skips Markdown without special setup blocks');
        await replace(notebook.cellAt(2), 'notebookShared.To');
        const completions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', notebook.cellAt(2).document.uri, new vscode.Position(0, 17));
        assert.ok(completions.items.some(item => (typeof item.label === 'string' ? item.label : item.label.label) === 'ToString'));
        await replace(notebook.cellAt(2), 'new StringBuilder().Append(notebookShared).ToString()');
        await vscode.commands.executeCommand('linqRunner.notebook.run', notebook.cellAt(2));
        assert.equal(result(notebook.cellAt(2)).value.text, '40');
        results.push('Completion and using directives see the live state of executed cells');
        await replace(notebook.cellAt(2), 'notebookShared');
        await vscode.commands.executeCommand('linqRunner.notebook.run', notebook.cellAt(2));
        assert.ok(await notebook.save());
        const saved = parseNotebook(Buffer.from(await vscode.workspace.fs.readFile(notebook.uri)).toString());
        assert.equal(saved.cells[0].source, '@namespace System.Text');
        assert.equal(saved.cells[3].language, 'markdown');
        assert.equal(saved.cells[2].result.value.text, '40');
        results.push('Markdown, code, execution order, and latest outputs save into notebook XML');

        const other = await open('csxnb');
        await vscode.commands.executeCommand('linqRunner.notebook.run', other.cellAt(2));
        assert.equal(result(other.cellAt(2)).status, 'compileError');
        await vscode.commands.executeCommand('linqRunner.notebook.run', other.cellAt(1));
        await vscode.window.showNotebookDocument(notebook);
        await vscode.commands.executeCommand('linqRunner.notebook.restart');
        await vscode.commands.executeCommand('linqRunner.notebook.run', notebook.cellAt(2));
        assert.equal(result(notebook.cellAt(2)).status, 'compileError');
        await replace(other.cellAt(2), 'notebookShared');
        await vscode.commands.executeCommand('linqRunner.notebook.run', other.cellAt(2));
        assert.equal(result(other.cellAt(2)).value.text, '40');
        results.push('The csxnb alias has an isolated kernel; restarting another notebook does not clear its variables');

        await vscode.window.showNotebookDocument(notebook);
        await vscode.commands.executeCommand('linqRunner.notebook.restartAndRunAll');
        assert.equal(result(notebook.cellAt(2)).value.text, '40');
        await replace(notebook.cellAt(1), 'not valid C#');
        await replace(notebook.cellAt(2), 'notebookShared = 100; notebookShared');
        await vscode.commands.executeCommand('linqRunner.notebook.runAll');
        assert.equal(result(notebook.cellAt(1)).status, 'compileError');
        await replace(notebook.cellAt(2), 'notebookShared');
        await vscode.commands.executeCommand('linqRunner.notebook.run', notebook.cellAt(2));
        assert.equal(result(notebook.cellAt(2)).value.text, '40');
        results.push('Run All stops at a compile failure without executing later cells or destroying previous state');

        await replace(notebook.cellAt(1), 'int notebookShared = 40;');
        await replace(notebook.cellAt(2), 'var notebookAnswer = notebookShared + 2;\nnotebookAnswer');
        await vscode.commands.executeCommand('linqRunner.notebook.restart');
        await vscode.commands.executeCommand('linqRunner.notebook.run', notebook.cellAt(1));
        const cell = notebook.cellAt(2);
        const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(cell.document.uri, new vscode.Position(0, 0)));
        vscode.debug.addBreakpoints([breakpoint]);
        let resolveStopped;
        let rejectStopped;
        const stopped = new Promise((resolve, reject) => { resolveStopped = resolve; rejectStopped = reject; });
        const timer = setTimeout(() => rejectStopped(new Error('Stateful notebook breakpoint timed out.')), 45000);
        let count = 0;
        const tracker = vscode.debug.registerDebugAdapterTrackerFactory('coreclr', {
            createDebugAdapterTracker: session => session.configuration.linqCollection ? {
                onDidSendMessage: message => {
                    if (message.type !== 'event' || message.event !== 'stopped') { return; }
                    (async () => {
                        const stack = await session.customRequest('stackTrace', { threadId: message.body.threadId });
                        const frame = stack.stackFrames[0];
                        assert.equal(frame.source.path, cell.document.uri.toString());
                        assert.equal(frame.line, count === 0 ? 1 : 2);
                        const variable = await session.customRequest('evaluate', { expression: 'notebookShared', frameId: frame.id, context: 'watch' });
                        assert.equal(variable.result, '40');
                        if (count++ === 0) { await session.customRequest('next', { threadId: message.body.threadId }); return; }
                        await session.customRequest('continue', { threadId: message.body.threadId });
                        resolveStopped();
                    })().catch(rejectStopped);
                },
            } : undefined,
        });
        try {
            const running = vscode.commands.executeCommand('linqRunner.notebook.debug', cell);
            await stopped;
            await running;
            assert.equal(result(cell).value.text, '42');
            results.push('Stateful cell debugging maps source, steps, and inspects variables from an earlier submission');
        } finally {
            clearTimeout(timer); tracker.dispose(); vscode.debug.removeBreakpoints([breakpoint]);
            if (vscode.debug.activeDebugSession) { await vscode.debug.stopDebugging(vscode.debug.activeDebugSession); }
        }
        await vscode.commands.executeCommand('linqRunner.notebook.clearAll');
        assert.ok(notebook.getCells().every(cell => cell.outputs.length === 0));
        await replace(notebook.cellAt(2), 'notebookShared');
        await vscode.commands.executeCommand('linqRunner.notebook.run', notebook.cellAt(2));
        assert.equal(result(notebook.cellAt(2)).value.text, '40');
        results.push('Clearing notebook outputs does not clear live kernel state');
        assert.ok(await notebook.save());
        await vscode.commands.executeCommand('linqRunner.notebook.xml');
        assert.equal(vscode.window.activeTextEditor.document.uri.toString(), notebook.uri.toString());
        await vscode.commands.executeCommand('linqRunner.notebook.ui');
        assert.equal(vscode.window.activeNotebookEditor.notebook.uri.toString(), notebook.uri.toString());
        results.push('Stateful notebook XML/UI switching keeps the same saved resource');
        const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
            (tab.input instanceof vscode.TabInputNotebook || tab.input instanceof vscode.TabInputText)
            && tab.input.uri.toString() === notebook.uri.toString());
        await vscode.window.tabGroups.close(tabs, true);
        const reopened = await vscode.workspace.openNotebookDocument(notebook.uri);
        await vscode.window.showNotebookDocument(reopened);
        assert.equal(result(reopened.cellAt(2)).value.text, '40');
        await vscode.commands.executeCommand('linqRunner.notebook.run', reopened.cellAt(2));
        assert.equal(result(reopened.cellAt(2)).status, 'compileError');
        results.push('Reopening preserves saved output but starts a fresh kernel with no restored variables');
        return results;
    } finally {
        for (const uri of files) { await vscode.workspace.fs.delete(uri).then(() => {}, () => {}); }
    }
};