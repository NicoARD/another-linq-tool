const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { RunnerClient } = require('../out/runnerClient');
const { CancellationToken, CancellationTokenSource } = require('vscode-jsonrpc/node');

test('stateful submissions retain variables and survive a compilation error', async () => {
    const client = new RunnerClient('dotnet', [path.resolve(__dirname, '../../runner/LinqRunner/bin/Debug/net8.0/LinqRunner.dll')], () => {});
    const execute = source => client.execute(source, 100, [], [], [], {}, CancellationToken.None, undefined, true);
    try {
        assert.equal((await execute('int notebookValue = 40;')).status, 'success');
        const result = await execute('notebookValue += 2; notebookValue');
        assert.equal(result.status, 'success', JSON.stringify(result));
        assert.equal(result.value.text, '42');
        assert.equal((await execute('this is invalid C#')).status, 'compileError');
        assert.equal((await execute('notebookValue')).value.text, '42');
        const completed = await client.complete('notebookValue.To', 16, [], [], [], {}, false, CancellationToken.None, true);
        assert.ok(completed.items.some(item => item.label === 'ToString'));
        assert.equal((await execute('notebookValue = 50; throw new Exception("expected");')).status, 'runtimeError');
        assert.equal((await execute('notebookValue')).value.text, '50');
        await client.restart();
        assert.equal((await execute('notebookValue')).status, 'compileError');
    } finally { client.dispose(); }
});

test('a non-cooperative notebook submission can be cancelled without affecting another runner', async () => {
    const runner = path.resolve(__dirname, '../../runner/LinqRunner/bin/Debug/net8.0/LinqRunner.dll');
    const client = new RunnerClient('dotnet', [runner], () => {});
    const other = new RunnerClient('dotnet', [runner], () => {});
    const cancellation = new CancellationTokenSource();
    let timer;
    try {
        await client.execute('int value = 1;', 100, [], [], [], {}, CancellationToken.None, undefined, true);
        await other.execute('int value = 99;', 100, [], [], [], {}, CancellationToken.None, undefined, true);
        const pending = client.execute('while (true) {}', 100, [], [], [], {}, cancellation.token, undefined, true);
        timer = setTimeout(() => cancellation.cancel(), 200);
        await assert.rejects(pending);
        const result = await other.execute('value', 100, [], [], [], {}, CancellationToken.None, undefined, true);
        assert.equal(result.value.text, '99');
    } finally {
        clearTimeout(timer); cancellation.dispose(); client.dispose(); other.dispose();
    }
});