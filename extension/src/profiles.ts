import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const CONFIG_FILENAME = 'linqrunner.json';

export type AssemblyEntry = string | { path: string; enabled?: boolean };

export interface ProfileEntry {
    assemblies?: AssemblyEntry[];
    imports?: string[];
    packages?: string[];
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
    packages: string[];
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
        return [...this.readMerged().profiles.keys()];
    }

    getActiveName(): string | undefined {
        const merged = this.readMerged();
        const names = [...merged.profiles.keys()];
        if (names.length === 0) {
            return undefined;
        }
        const stored = this.memento.get<string>('activeProfile');
        if (stored && names.includes(stored)) {
            return stored;
        }
        if (merged.defaultProfile && names.includes(merged.defaultProfile)) {
            return merged.defaultProfile;
        }
        return names[0];
    }

    async setActive(name: string): Promise<void> {
        await this.memento.update('activeProfile', name);
    }

    resolveActive(): ResolvedProfile | undefined {
        const merged = this.readMerged();
        const name = this.getActiveName();
        if (!name) {
            return undefined;
        }
        const found = merged.profiles.get(name);
        if (!found) {
            return undefined;
        }
        const raw = found.entry;

        const assemblies: string[] = [];
        const missing: string[] = [];
        for (const entry of raw.assemblies ?? []) {
            const normalized = normalizeAssembly(entry);
            if (!normalized.enabled) {
                continue;
            }
            // Relative paths resolve against the file that DEFINED the profile (global or workspace).
            const abs = path.isAbsolute(normalized.path) ? normalized.path : path.resolve(found.dir, normalized.path);
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
            packages: raw.packages ?? [],
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

    /** The global profiles file, shared across every VS Code instance and the CLI. */
    globalConfigPath(): string {
        return path.join(os.homedir(), '.linqrunner', CONFIG_FILENAME);
    }

    // Merges global profiles (base) with the workspace file (overrides by name). Each profile remembers
    // the directory of the file that defined it, so relative assembly paths resolve correctly.
    private readMerged(): { profiles: Map<string, { entry: ProfileEntry; dir: string }>; defaultProfile?: string } {
        const profiles = new Map<string, { entry: ProfileEntry; dir: string }>();
        let defaultProfile: string | undefined;

        for (const file of [this.globalConfigPath(), this.findConfig()]) {
            if (!file) {
                continue;
            }
            const loaded = this.loadFile(file);
            if (!loaded) {
                continue;
            }
            for (const [profileName, entry] of Object.entries(loaded.config.profiles ?? {})) {
                profiles.set(profileName, { entry, dir: loaded.dir });
            }
            if (loaded.config.defaultProfile) {
                defaultProfile = loaded.config.defaultProfile;
            }
        }

        return { profiles, defaultProfile };
    }

    private loadFile(filePath: string): { config: ProfilesConfigFile; dir: string } | undefined {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        try {
            return { config: JSON.parse(fs.readFileSync(filePath, 'utf8')) as ProfilesConfigFile, dir: path.dirname(filePath) };
        } catch {
            return undefined;
        }
    }
}
