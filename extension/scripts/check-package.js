/* Verifies that the VSIX contains every supported self-contained host. */
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
    'extension/runner/win-x64/LinqRunner.exe',
    'extension/runner/win-arm64/LinqRunner.exe',
    'extension/runner/linux-x64/LinqRunner',
    'extension/runner/linux-arm64/LinqRunner',
    'extension/runner/osx-x64/LinqRunner',
    'extension/runner/osx-arm64/LinqRunner',
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
            throw new Error(`VSIX is missing self-contained runner hosts:\n  ${[...requiredEntries].join('\n  ')}`);
        }
        console.log(`Verified all self-contained runner hosts in ${packages[0].name}.`);
    });
});
