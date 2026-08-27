import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const CONFIG_FILENAME = 'linqrunner.json';
const PROFILES_SETTING = 'profiles';
const DEFAULT_PROFILE_SETTING = 'defaultProfile';
const ACTIVE_PROFILE_KEY = 'activeProfile';
const CONNECTION_SECRET_PREFIX = 'profileConnectionString:';

export type AssemblyEntry = string | { path: string; enabled?: boolean };
export type ProfileTargetFramework = 'net10.0' | 'net11.0';

export interface ProfileEntry {
    targetFramework?: ProfileTargetFramework;
    efCoreVersion?: string;
    assemblies?: AssemblyEntry[];
    imports?: string[];
    packages?: string[];
    prelude?: string;
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
    targetFramework?: ProfileTargetFramework;
    efCoreVersion?: string;
    assemblies: string[];
    imports: string[];
    packages: string[];
    prelude?: string;
    missing: string[];
    context?: string;
    provider?: string;
    connectionString?: string;
    contextFactoryType?: string;
    contextFactoryMethod?: string;
}

/** Manages user-configurable profiles in global User Settings and connection strings in Secret Storage. */
export class ProfileManager {
    constructor(
        private readonly globalState: vscode.Memento,
        private readonly secrets: vscode.SecretStorage,
    ) {}

    async migrateLegacyConfiguration(): Promise<void> {
        const settings = this.settings();
        for (const key of ['dotnetPath', 'runnerPath', 'rowLimit']) {
            const existing = settings.inspect<unknown>(key);
            if (existing?.globalValue === undefined && existing?.workspaceValue !== undefined) {
                await settings.update(key, existing.workspaceValue, vscode.ConfigurationTarget.Global);
            }
        }
        if (settings.inspect<Record<string, ProfileEntry>>(PROFILES_SETTING)?.globalValue !== undefined) {
            return;
        }

        // Preserve the old precedence: the workspace file overrode the old global file.
        const migrated: ProfilesConfigFile = { profiles: {} };
        const connectionStrings = new Map<string, string>();
        for (const file of [this.legacyGlobalConfigPath(), this.findLegacyWorkspaceConfig()]) {
            const loaded = file && this.loadLegacyFile(file);
            if (!loaded) {
                continue;
            }
            for (const [name, profile] of Object.entries(loaded.config.profiles ?? {})) {
                migrated.profiles![name] = this.absolutizeAssemblies(profile, loaded.dir);
                if (profile.connectionString) {
                    connectionStrings.set(name, profile.connectionString);
                }
            }
            if (loaded.config.defaultProfile) {
                migrated.defaultProfile = loaded.config.defaultProfile;
            }
        }

        if (Object.keys(migrated.profiles!).length > 0) {
            await this.saveConfig(migrated);
            for (const [name, connectionString] of connectionStrings) {
                await this.secrets.store(this.connectionSecretKey(name), connectionString);
            }
        }
    }

    listProfiles(): string[] {
        return Object.keys(this.readSettings().profiles ?? {});
    }

    getActiveName(): string | undefined {
        const config = this.readSettings();
        const names = Object.keys(config.profiles ?? {});
        if (names.length === 0) {
            return undefined;
        }
        const stored = this.globalState.get<string>(ACTIVE_PROFILE_KEY);
        if (stored && names.includes(stored)) {
            return stored;
        }
        return config.defaultProfile && names.includes(config.defaultProfile) ? config.defaultProfile : names[0];
    }

    async setActive(name: string): Promise<void> {
        await this.globalState.update(ACTIVE_PROFILE_KEY, name);
    }

    async resolveActive(overrideName?: string): Promise<ResolvedProfile | undefined> {
        const config = this.readSettings();
        const names = Object.keys(config.profiles ?? {});
        const name = overrideName && names.includes(overrideName) ? overrideName : this.getActiveName();
        const raw = name && config.profiles?.[name];
        if (!name || !raw) {
            return undefined;
        }

        const assemblies: string[] = [];
        const missing: string[] = [];
        for (const entry of raw.assemblies ?? []) {
            const normalized = normalizeAssembly(entry);
            if (!normalized.enabled) {
                continue;
            }
            // Global settings should use absolute paths. Preserve relative paths only for manually edited settings.
            const assemblyPath = path.isAbsolute(normalized.path) ? normalized.path : path.resolve(normalized.path);
            (fs.existsSync(assemblyPath) ? assemblies : missing).push(assemblyPath);
        }

        const dbEnabled = raw.dbEnabled !== false;
        return {
            name,
            targetFramework: raw.targetFramework,
            efCoreVersion: raw.efCoreVersion?.trim() || undefined,
            assemblies,
            imports: raw.imports ?? [],
            packages: raw.packages ?? [],
            prelude: raw.prelude,
            missing,
            context: dbEnabled ? raw.context : undefined,
            provider: dbEnabled ? raw.provider : undefined,
            connectionString: dbEnabled ? await this.secrets.get(this.connectionSecretKey(name)) : undefined,
            contextFactoryType: dbEnabled ? raw.contextFactory?.type : undefined,
            contextFactoryMethod: dbEnabled ? raw.contextFactory?.method : undefined,
        };
    }

    async readConfigForEdit(): Promise<ProfilesConfigFile> {
        const config = this.readSettings();
        const profiles: Record<string, ProfileEntry> = {};
        for (const [name, profile] of Object.entries(config.profiles ?? {})) {
            profiles[name] = { ...profile, connectionString: await this.secrets.get(this.connectionSecretKey(name)) };
        }
        return { defaultProfile: config.defaultProfile, profiles };
    }

    async saveConfig(config: ProfilesConfigFile): Promise<void> {
        const oldProfiles = this.readSettings().profiles ?? {};
        const profiles: Record<string, ProfileEntry> = {};
        for (const [name, profile] of Object.entries(config.profiles ?? {})) {
            const { connectionString, ...settingProfile } = profile;
            profiles[name] = settingProfile;
            const key = this.connectionSecretKey(name);
            if (connectionString) {
                await this.secrets.store(key, connectionString);
            } else {
                await this.secrets.delete(key);
            }
        }
        for (const oldName of Object.keys(oldProfiles)) {
            if (!(oldName in profiles)) {
                await this.secrets.delete(this.connectionSecretKey(oldName));
            }
        }
        await this.settings().update(PROFILES_SETTING, profiles, vscode.ConfigurationTarget.Global);
        await this.settings().update(DEFAULT_PROFILE_SETTING, config.defaultProfile ?? '', vscode.ConfigurationTarget.Global);
    }

    private settings(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('linqRunner');
    }

    private readSettings(): ProfilesConfigFile {
        return {
            profiles: this.settings().get<Record<string, ProfileEntry>>(PROFILES_SETTING, {}),
            defaultProfile: this.settings().get<string>(DEFAULT_PROFILE_SETTING, '') || undefined,
        };
    }

    private connectionSecretKey(profileName: string): string {
        return CONNECTION_SECRET_PREFIX + profileName;
    }

    private absolutizeAssemblies(profile: ProfileEntry, baseDir: string): ProfileEntry {
        return {
            ...profile,
            connectionString: undefined,
            assemblies: profile.assemblies?.map((entry) => {
                const normalized = normalizeAssembly(entry);
                const assemblyPath = path.isAbsolute(normalized.path) ? normalized.path : path.resolve(baseDir, normalized.path);
                return typeof entry === 'string' ? assemblyPath : { ...entry, path: assemblyPath };
            }),
        };
    }

    private findLegacyWorkspaceConfig(): string | undefined {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            const candidate = path.join(folder.uri.fsPath, CONFIG_FILENAME);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }

    private legacyGlobalConfigPath(): string {
        return path.join(os.homedir(), '.linqrunner', CONFIG_FILENAME);
    }

    private loadLegacyFile(filePath: string): { config: ProfilesConfigFile; dir: string } | undefined {
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
