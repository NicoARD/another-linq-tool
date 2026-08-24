import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export type RunnerFramework = 'net10.0' | 'net11.0';

export interface ManagedRunnerLaunch {
    executable: string;
    args: string[];
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

    if (highestMajor > 11) {
        throw new Error(
            `A configured assembly targets .NET ${highestMajor}, but this version supports assemblies through .NET 11.`,
        );
    }

    if (requested && requested !== 'auto') {
        if (requested === 'net10.0' && highestMajor > 10) {
            throw new Error(
                'The active profile selects .NET 10, but one of its configured assemblies targets .NET 11.',
            );
        }
        return requested;
    }

    return highestMajor === 11 ? 'net11.0' : 'net10.0';
}

/** Resolves an existing compatible host first and acquires one only when necessary. */
export async function resolveManagedRunner(
    context: vscode.ExtensionContext,
    framework: RunnerFramework,
    log: (message: string) => void,
): Promise<ManagedRunnerLaunch> {
    const version = framework === 'net11.0' ? '11.0' : '10.0';
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
            rejectPreviews: framework === 'net10.0',
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

    const runnerPath = path.join(context.extensionPath, 'runner', framework, 'LinqRunner.dll');
    return {
        executable: dotnetPath,
        args: [runnerPath],
        runnerPath,
        bundled: true,
        framework,
    };
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
