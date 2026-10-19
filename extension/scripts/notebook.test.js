const assert = require('node:assert/strict');
const { test } = require('node:test');

test('stateful notebook format preserves code, Markdown, and results without setup cells', () => {
    const { createNotebook, parseNotebook, writeNotebook } = require('../out/notebookModel');
    const notebook = createNotebook();
    assert.equal(notebook.cells[0].language, 'csharp');
    assert.equal(notebook.cells[0].source, '@namespace System.Text');
    assert.equal(notebook.cells.length, 3);
    assert.ok(notebook.cells.every(cell => cell.language === 'csharp'));
    notebook.cells.push({ id: 'user-notes', language: 'markdown', source: '# User notes' });
    notebook.cells[1].source = 'var text = "<& ]]>";\r\ntext';
    notebook.cells[1].result = { status: 'success', elapsedMs: 1, value: { kind: 'scalar', text: '<&' } };
    assert.deepEqual(parseNotebook(writeNotebook(notebook)), notebook);
    assert.throws(() => parseNotebook('<Notebook version="7"/>'));
    assert.throws(() => parseNotebook('<Notebook>'));
});