const assert = require('node:assert/strict');
const { test } = require('node:test');

test('collection source and saved results round trip', () => {
    const { parseCollection, writeCollection } = require('../out/collectionModel');
    const source = 'var text = "<& ]]>";\r\ntext';
    const collection = {
        profile: 'Development', namespaces: ['System.Text'], outputLocation: 'inline',
        cells: [
            { id: 'setup', role: 'prelude', source: 'var number = 42;' },
            { id: 'query', role: 'script', source, result: { status: 'success', elapsedMs: 5, value: { kind: 'scalar', text: '<&' } }, inputHash: 'abc' },
        ],
    };
    assert.deepEqual(parseCollection(writeCollection(collection)), collection);
});

test('invalid collections are rejected without empty-document fallback', () => {
    const { parseCollection } = require('../out/collectionModel');
    for (const xml of ['<Collection>', '<Collection version="9"/>', '<Collection version="1"><Cell id="x" role="prelude"/><Cell id="x" role="script"/></Collection>']) {
        assert.throws(() => parseCollection(xml));
    }
});

test('empty collection has a prelude and an independent script', () => {
    const { createCollection, parseCollection, writeCollection } = require('../out/collectionModel');
    const collection = createCollection();
    assert.equal(collection.cells[0].role, 'prelude');
    assert.equal(collection.cells[1].role, 'script');
    assert.deepEqual(parseCollection(writeCollection(collection)), collection);
});

test('source whitespace, entities, unicode, and cleared outputs survive save', () => {
    const { createCollection, parseCollection, writeCollection } = require('../out/collectionModel');
    for (const source of ['  \n\t value \n ', '"&#13; &amp; &lt;"', '\u03bb\r\n\u2603', '', '0', 'false']) {
        const collection = createCollection();
        collection.cells[1].source = source;
        collection.cells[1].result = { status: 'success', elapsedMs: 1, sqlCommands: [{ order: 1, text: 'SELECT @p', commandType: 'Text', parameters: [{ name: '@p', value: '<&' }] }] };
        const reopened = parseCollection(writeCollection(collection));
        assert.equal(reopened.cells[1].source, source);
        assert.deepEqual(reopened.cells[1].result, collection.cells[1].result);
        delete reopened.cells[1].result;
        assert.equal(parseCollection(writeCollection(reopened)).cells[1].result, undefined);
    }
});

test('missing prelude, duplicate ids, invalid outputs and DTDs are rejected', () => {
    const { parseCollection } = require('../out/collectionModel');
    for (const xml of [
        '<Collection version="1"><Cell id="x" role="script"><Source>1</Source></Cell></Collection>',
        '<Collection version="1"><Cell id="x" role="prelude"/><Cell id="x" role="script"/></Collection>',
        '<Collection version="1"><Cell id="x" role="prelude"><Output>{}</Output></Cell></Collection>',
        '<!DOCTYPE Collection><Collection version="1"><Cell id="x" role="prelude"/></Collection>',
    ]) { assert.throws(() => parseCollection(xml)); }
});

test('editable namespace directive block round trips independently from legacy imports', () => {
    const { createCollection, parseCollection, writeCollection } = require('../out/collectionModel');
    const collection = createCollection();
    collection.namespaceSource = '@namespace System.Text\r\n@namespace System.Globalization\n';
    assert.deepEqual(parseCollection(writeCollection(collection)), collection);
});