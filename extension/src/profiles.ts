import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const CONFIG_FILENAME = 'linqrunner.json';

interface ProfilesConfigFile {
    defaultProfile?: string;
    profiles?: Record<string, { assemblies?: string[]; imports?: string[] }>;
}

export interface ResolvedProfile {
    name: string;
    assemblies: string[]; // absolute paths that exist
    imports: string[];
    missing: string[]; // configured paths that do not exist
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
            const abs = path.isAbsolute(entry) ? entry : path.resolve(loaded.dir, entry);
            if (fs.existsSync(abs)) {
                assemblies.push(abs);
            } else {
                missing.push(abs);
            }
        }

        return { name, assemblies, imports: raw.imports ?? [], missing };
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
