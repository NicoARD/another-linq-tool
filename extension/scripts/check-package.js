/* Verifies that the VSIX contains both portable runner targets. */
const { readdirSync, statSync } = require('fs');
const { resolve } = require('path');
const yauzl = require('yauzl');

const extensionRoot = resolve(__dirname, '..');
const packages = readdirSync(extensionRoot)
    .filter((name) => name.endsWith('.vsix'))
    .map((name) => ({ name, path: resolve(extensionRoot, name) }))
    .sort((left, right) => statSync(right.path).mtimeMs - statSync(left.path).mtimeMs);

if (packages.length === 0) {
    throw new Error('vsce did not produce a VSIX package.');
}

const requiredEntries = new Set([
    'extension/runner/net10.0/LinqRunner.dll',
    'extension/runner/net10.0/LinqRunner.deps.json',
    'extension/runner/net10.0/LinqRunner.runtimeconfig.json',
    'extension/runner/net11.0/LinqRunner.dll',
    'extension/runner/net11.0/LinqRunner.deps.json',
    'extension/runner/net11.0/LinqRunner.runtimeconfig.json',
]);

yauzl.open(packages[0].path, { lazyEntries: true }, (error, zip) => {
    if (error) {
        throw error;
    }

    zip.readEntry();
    zip.on('entry', (entry) => {
        requiredEntries.delete(entry.fileName);
        zip.readEntry();
    });
    zip.on('end', () => {
        if (requiredEntries.size > 0) {
            throw new Error(`VSIX is missing portable runner files:\n  ${[...requiredEntries].join('\n  ')}`);
        }
        console.log(`Verified both portable runner targets in ${packages[0].name}.`);
    });
});
