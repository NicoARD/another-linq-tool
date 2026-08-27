import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export type RunnerFramework = `net${number}.0`;

export interface ManagedRunnerLaunch {
    executable: string;
    args: string[];
    environment?: NodeJS.ProcessEnv;
    runnerPath: string;
    bundled: true;
    framework: RunnerFramework;
}

interface DotnetAcquireResult {
    dotnetPath: string;
}

type DotnetPathResult = string | DotnetAcquireResult | undefined;

const targetFrameworkMarker = Buffer.from('.NETCoreApp,Version=v', 'ascii');

/** Selects the newest runner required by the profile's managed assembly references. */
export function selectRunnerFramework(
    assemblies: readonly string[],
    requested?: RunnerFramework | 'auto',
): RunnerFramework {
    let highestMajor = 10;
    for (const assembly of assemblies) {
        const major = readTargetFrameworkMajor(assembly);
        if (major !== undefined) {
            highestMajor = Math.max(highestMajor, major);
        }
    }

    if (requested && requested !== 'auto') {
        const requestedMajor = frameworkMajor(requested);
        if (highestMajor > requestedMajor) {
            throw new Error(
                `The active profile selects .NET ${requestedMajor}, but a configured assembly targets .NET ${highestMajor}.`,
            );
        }
        return requested;
    }

    return `net${highestMajor}.0`;
}

/** Resolves an existing compatible host first and acquires one only when necessary. */
export async function resolveManagedRunner(
    context: vscode.ExtensionContext,
    framework: RunnerFramework,
    log: (message: string) => void,
): Promise<ManagedRunnerLaunch> {
    const major = frameworkMajor(framework);
    const version = `${major}.0`;
    const acquireContext = {
        version,
        mode: 'runtime',
        requestingExtensionId: context.extension.id,
        architecture: process.arch,
        rethrowError: true,
    };

    let dotnetPath: string | undefined;
    try {
        const found = await vscode.commands.executeCommand<DotnetPathResult>('dotnet.findPath', {
            acquireContext,
            versionSpecRequirement: 'equal',
            rejectPreviews: major <= 10,
        });
        dotnetPath = normalizeDotnetPath(found);
    } catch (err) {
        log(`Could not search for an existing .NET ${version} runtime: ${messageOf(err)}`);
    }

    if (!dotnetPath) {
        log(`A compatible .NET ${version} runtime was not found; acquiring it with the .NET Install Tool.`);
        try {
            const acquired = await vscode.commands.executeCommand<DotnetPathResult>('dotnet.acquire', acquireContext);
            dotnetPath = normalizeDotnetPath(acquired);
        } catch (err) {
            throw new Error(`Could not acquire the .NET ${version} runtime: ${messageOf(err)}`);
        }
    }

    if (!dotnetPath) {
        throw new Error(`The .NET Install Tool did not return a path for the .NET ${version} runtime.`);
    }

    const runnerPath = path.join(context.extensionPath, 'runner', 'net8.0', 'LinqRunner.dll');
    const runtimeConfig = createRuntimeConfig(context, framework, major);
    return {
        executable: dotnetPath,
        args: ['exec', '--runtimeconfig', runtimeConfig, runnerPath],
        environment: major > 10 ? { ...process.env, DOTNET_ROLL_FORWARD_TO_PRERELEASE: '1' } : undefined,
        runnerPath,
        bundled: true,
        framework,
    };
}

function createRuntimeConfig(context: vscode.ExtensionContext, framework: RunnerFramework, major: number): string {
    const directory = path.join(context.globalStorageUri.fsPath, 'runtime');
    fs.mkdirSync(directory, { recursive: true });
    const runtimeConfig = path.join(directory, `LinqRunner.${framework}.runtimeconfig.json`);
    const contents = JSON.stringify({
        runtimeOptions: {
            tfm: framework,
            rollForward: 'LatestPatch',
            framework: {
                name: 'Microsoft.NETCore.App',
                // A preview baseline rolls forward to both later previews and the eventual stable
                // release. Stable runtime lines use their normal 0.0 baseline.
                version: major > 10 ? `${major}.0.0-preview.1` : `${major}.0.0`,
            },
        },
    }, null, 2) + '\n';
    if (!fs.existsSync(runtimeConfig) || fs.readFileSync(runtimeConfig, 'utf8') !== contents) {
        fs.writeFileSync(runtimeConfig, contents, 'utf8');
    }
    return runtimeConfig;
}

function frameworkMajor(framework: RunnerFramework): number {
    const match = /^net(\d+)\.0$/.exec(framework);
    if (!match) {
        throw new Error(`Unsupported .NET target framework '${framework}'.`);
    }
    return Number.parseInt(match[1], 10);
}

function readTargetFrameworkMajor(assemblyPath: string): number | undefined {
    if (path.extname(assemblyPath).toLowerCase() !== '.dll' || !fs.existsSync(assemblyPath)) {
        return undefined;
    }

    const handle = fs.openSync(assemblyPath, 'r');
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let carry = Buffer.alloc(0);
    try {
        while (true) {
            const bytesRead = fs.readSync(handle, chunk, 0, chunk.length, null);
            if (bytesRead === 0) {
                return undefined;
            }

            const searchable = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
            const markerIndex = searchable.indexOf(targetFrameworkMarker);
            if (markerIndex >= 0) {
                const suffix = searchable.subarray(markerIndex + targetFrameworkMarker.length).toString('ascii');
                const match = /^(\d+)/.exec(suffix);
                if (match) {
                    return Number.parseInt(match[1], 10);
                }
            }

            carry = searchable.subarray(Math.max(0, searchable.length - 64));
        }
    } finally {
        fs.closeSync(handle);
    }
}

function messageOf(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
}

function normalizeDotnetPath(result: DotnetPathResult): string | undefined {
    return typeof result === 'string' ? result : result?.dotnetPath;
}
