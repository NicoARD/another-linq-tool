const { runTests } = require('@vscode/test-electron');
const { mkdtemp, readdir, symlink, readFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { homedir, tmpdir } = require('node:os');

async function main() {
    const root = resolve(__dirname, '..');
    const temporary = await mkdtemp(join(tmpdir(), 'alt-notebook-tests-'));
    const extensions = join(temporary, 'extensions');
    await require('node:fs/promises').mkdir(extensions);
    const installed = join(homedir(), '.vscode', 'extensions');
    for (const entry of await readdir(installed)) {
        if (/^ms-dotnettools\.(csharp|vscode-dotnet-runtime)-/.test(entry)) {
            await symlink(join(installed, entry), join(extensions, entry), process.platform === 'win32' ? 'junction' : 'dir');
        }
    }
    const report = join(temporary, 'report.json');
    console.log(`Integration report: ${report}`);
    try {
        await runTests({
            vscodeExecutablePath: process.env.VSCODE_EXECUTABLE,
            extensionDevelopmentPath: root,
            extensionTestsPath: join(__dirname, 'collection.integration.js'),
            extensionTestsEnv: { LINQ_COLLECTION_REPORT: report, LINQ_TEST_RUNNER: process.env.LINQ_TEST_RUNNER ?? '' },
            launchArgs: [
                '--user-data-dir', join(temporary, 'user'), '--extensions-dir', extensions,
                '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
            ],
        });
    } finally {
        console.log(await readFile(report, 'utf8').catch(() => 'The test host did not write a report.'));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });