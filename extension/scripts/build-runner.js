/*
 * Publishes the .NET runner into the extension so a packaged VSIX is
 * self-contained. Keep this script dependency-free so it runs during vsce
 * prepublish on supported desktop platforms.
 */
const { existsSync, rmSync } = require('fs');
const { join, resolve } = require('path');
const { spawnSync } = require('child_process');

const extensionRoot = resolve(__dirname, '..');
const repositoryRoot = resolve(extensionRoot, '..');
const project = join(repositoryRoot, 'runner', 'LinqRunner', 'LinqRunner.csproj');
const output = join(extensionRoot, 'runner');

if (!existsSync(project)) {
    throw new Error(`Runner project was not found: ${project}`);
}

rmSync(output, { recursive: true, force: true });

const result = spawnSync(
    'dotnet',
    ['publish', project, '--configuration', 'Release', '--output', output, '--nologo'],
    { cwd: repositoryRoot, stdio: 'inherit', shell: process.platform === 'win32' },
);

if (result.error) {
    throw result.error;
}

if (result.status !== 0) {
    process.exit(result.status ?? 1);
}

const runner = join(output, 'LinqRunner.dll');
if (!existsSync(runner)) {
    throw new Error(`Publish succeeded but ${runner} was not produced.`);
}
