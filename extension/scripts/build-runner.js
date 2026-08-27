/*
 * Publishes one portable runner which rolls forward onto the execution runtime selected for the
 * active profile. Keep this script dependency-free so it runs during vsce prepublish everywhere.
 */
const { existsSync, rmSync } = require('fs');
const { join, resolve } = require('path');
const { spawnSync } = require('child_process');

const extensionRoot = resolve(__dirname, '..');
const repositoryRoot = resolve(extensionRoot, '..');
const project = join(repositoryRoot, 'runner', 'LinqRunner', 'LinqRunner.csproj');
const output = join(extensionRoot, 'runner');
const targetFrameworks = ['net8.0'];

if (!existsSync(project)) {
    throw new Error(`Runner project was not found: ${project}`);
}

rmSync(output, { recursive: true, force: true });

for (const targetFramework of targetFrameworks) {
    const frameworkOutput = join(output, targetFramework);
    const result = spawnSync(
        'dotnet',
        [
            'publish', project,
            '--configuration', 'Release',
            '--framework', targetFramework,
            '--self-contained', 'false',
            '--output', frameworkOutput,
            '-p:UseAppHost=false',
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

    const runner = join(frameworkOutput, 'LinqRunner.dll');
    if (!existsSync(runner)) {
        throw new Error(`Publish succeeded but ${runner} was not produced.`);
    }
}
