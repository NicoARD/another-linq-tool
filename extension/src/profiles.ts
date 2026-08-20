import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const CONFIG_FILENAME = 'linqrunner.json';

export type AssemblyEntry = string | { path: string; enabled?: boolean };

export interface ProfileEntry {
    assemblies?: AssemblyEntry[];
    imports?: string[];
    context?: string;
    provider?: string;
    connectionString?: string;
    contextFactory?: { type?: string; method?: string };
    dbEnabled?: boolean;
}

export interface ProfilesConfigFile {
    defaultProfile?: string;
    profiles?: Record<string, ProfileEntry>;
}

export function normalizeAssembly(entry: AssemblyEntry): { path: string; enabled: boolean } {
    return typeof entry === 'string'
        ? { path: entry, enabled: true }
        : { path: entry.path, enabled: entry.enabled !== false };
}

export interface ResolvedProfile {
    name: string;
    assemblies: string[]; // absolute paths that exist
    imports: string[];
    missing: string[]; // configured paths that do not exist
    context?: string;
    provider?: string;
    connectionString?: string;
    contextFactoryType?: string;
    contextFactoryMethod?: string;
}

/**
 * Loads execution profiles from a `linqrunner.json` file at a workspace-folder root and tracks the
 * active profile. A profile lists the application DLLs to load and default namespaces to import.
 */
export class ProfileManager {
    constructor(private readonly memento: vscode.Memento) {}

    listProfiles(): string[] {
        const loaded = this.read();
        return loaded ? Object.keys(loaded.config.profiles ?? {}) : [];
    }

    getActiveName(): string | undefined {
        const loaded = this.read();
        if (!loaded) {
            return undefined;
        }
        const names = Object.keys(loaded.config.profiles ?? {});
        if (names.length === 0) {
            return undefined;
        }
        const stored = this.memento.get<string>('activeProfile');
        if (stored && names.includes(stored)) {
            return stored;
        }
        if (loaded.config.defaultProfile && names.includes(loaded.config.defaultProfile)) {
            return loaded.config.defaultProfile;
        }
        return names[0];
    }

    async setActive(name: string): Promise<void> {
        await this.memento.update('activeProfile', name);
    }

    resolveActive(): ResolvedProfile | undefined {
        const loaded = this.read();
        if (!loaded) {
            return undefined;
        }
        const name = this.getActiveName();
        if (!name) {
            return undefined;
        }
        const raw = loaded.config.profiles?.[name];
        if (!raw) {
            return undefined;
        }

        const assemblies: string[] = [];
        const missing: string[] = [];
        for (const entry of raw.assemblies ?? []) {
            const normalized = normalizeAssembly(entry);
            if (!normalized.enabled) {
                continue;
            }
            const abs = path.isAbsolute(normalized.path) ? normalized.path : path.resolve(loaded.dir, normalized.path);
            if (fs.existsSync(abs)) {
                assemblies.push(abs);
            } else {
                missing.push(abs);
            }
        }

        const dbEnabled = raw.dbEnabled !== false;

        return {
            name,
            assemblies,
            imports: raw.imports ?? [],
            missing,
            context: dbEnabled ? raw.context : undefined,
            provider: dbEnabled ? raw.provider : undefined,
            connectionString: dbEnabled ? raw.connectionString : undefined,
            contextFactoryType: dbEnabled ? raw.contextFactory?.type : undefined,
            contextFactoryMethod: dbEnabled ? raw.contextFactory?.method : undefined,
        };
    }

    /** Reads the config for editing, returning an empty config + intended path if none exists yet. */
    readConfigForEdit(): { config: ProfilesConfigFile; path: string | undefined } {
        const configPath = this.findConfig() ?? this.defaultConfigPath();
        let config: ProfilesConfigFile = { profiles: {} };
        if (configPath && fs.existsSync(configPath)) {
            try {
                config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ProfilesConfigFile;
            } catch {
                // fall back to empty config; the editor will overwrite on save.
            }
        }
        return { config, path: configPath };
    }

    /** Writes the config back to linqrunner.json (creating it at the workspace root if needed). */
    saveConfig(config: ProfilesConfigFile): string | undefined {
        const target = this.findConfig() ?? this.defaultConfigPath();
        if (!target) {
            return undefined;
        }
        fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n', 'utf8');
        return target;
    }

    private defaultConfigPath(): string | undefined {
        const folder = vscode.workspace.workspaceFolders?.[0];
        return folder ? path.join(folder.uri.fsPath, CONFIG_FILENAME) : undefined;
    }

    private read(): { config: ProfilesConfigFile; dir: string } | undefined {
        const configPath = this.findConfig();
        if (!configPath) {
            return undefined;
        }
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ProfilesConfigFile;
            return { config, dir: path.dirname(configPath) };
        } catch {
            return undefined;
        }
    }

    private findConfig(): string | undefined {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            const candidate = path.join(folder.uri.fsPath, CONFIG_FILENAME);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }
}
