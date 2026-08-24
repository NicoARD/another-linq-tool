/*
 * Publishes the .NET runner into the extension so a packaged VSIX is
 * self-contained. Keep this script dependency-free so it runs during vsce
 * prepublish on supported desktop platforms.
 */
const { chmodSync, existsSync, rmSync } = require('fs');
const { join, resolve } = require('path');
const { spawnSync } = require('child_process');

const extensionRoot = resolve(__dirname, '..');
const repositoryRoot = resolve(extensionRoot, '..');
const project = join(repositoryRoot, 'runner', 'LinqRunner', 'LinqRunner.csproj');
const output = join(extensionRoot, 'runner');
const runtimeIdentifiers = [
    'win-x64',
    'win-arm64',
    'linux-x64',
    'linux-arm64',
    'osx-x64',
    'osx-arm64',
];

if (!existsSync(project)) {
    throw new Error(`Runner project was not found: ${project}`);
}

rmSync(output, { recursive: true, force: true });

for (const runtimeIdentifier of runtimeIdentifiers) {
    const runtimeOutput = join(output, runtimeIdentifier);
    const result = spawnSync(
        'dotnet',
        [
            'publish', project,
            '--configuration', 'Release',
            '--runtime', runtimeIdentifier,
            '--self-contained', 'true',
            '--output', runtimeOutput,
            '--nologo',
        ],
        { cwd: repositoryRoot, stdio: 'inherit', shell: process.platform === 'win32' },
    );

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }

    const executable = join(runtimeOutput, runtimeIdentifier.startsWith('win-') ? 'LinqRunner.exe' : 'LinqRunner');
    if (!existsSync(executable)) {
        throw new Error(`Publish succeeded but ${executable} was not produced.`);
    }

    if (!runtimeIdentifier.startsWith('win-')) {
        chmodSync(executable, 0o755);
    }
}
