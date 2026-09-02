import * as fs from 'fs';
import * as vscode from 'vscode';
import { ProfileManager, ProfilesConfigFile, ProfileTargetFramework } from './profiles';

type DiscoverFn = (
    assemblies: string[],
    targetFramework?: ProfileTargetFramework,
    efCoreVersion?: string,
) => Promise<{ contexts: string[]; error?: string }>;

/** A webview form for editing global User Settings profiles (runtime, assemblies, imports, database/context). */
export class ConfigPanel {
    private static panel: vscode.WebviewPanel | undefined;

    static show(
        context: vscode.ExtensionContext,
        profiles: ProfileManager,
        onSaved: () => void,
        discover?: DiscoverFn,
    ): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Active);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'linqRunnerConfig',
            'Another LINQ Tool Configuration',
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        this.panel = panel;
        panel.onDidDispose(() => (this.panel = undefined));

        const post = async () => {
            const config = await profiles.readConfigForEdit();
            panel.webview.postMessage({ type: 'init', config });
        };

        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'ready':
                    await post();
                    break;
                case 'pickAssembly': {
                    const picked = await vscode.window.showOpenDialog({
                        canSelectMany: false,
                        filters: { 'Assemblies': ['dll'] },
                        openLabel: 'Add assembly',
                    });
                    if (picked && picked[0]) {
                        panel.webview.postMessage({ type: 'assemblyPicked', path: toStorablePath(picked[0].fsPath) });
                    }
                    break;
                }
                case 'pickSqliteFile': {
                    const picked = await vscode.window.showOpenDialog({
                        canSelectMany: false,
                        filters: { 'SQLite database': ['db', 'sqlite', 'sqlite3'], 'All files': ['*'] },
                        openLabel: 'Select database file',
                    });
                    if (picked && picked[0]) {
                        panel.webview.postMessage({ type: 'sqliteFilePicked', path: picked[0].fsPath });
                    }
                    break;
                }
                case 'discoverContexts': {
                    if (!discover) {
                        panel.webview.postMessage({ type: 'contextsDiscovered', error: 'Discovery is unavailable.', contexts: [] });
                        break;
                    }
                    try {
                        const result = await discover(
                            message.assemblies as string[],
                            message.targetFramework as ProfileTargetFramework | undefined,
                            message.efCoreVersion as string | undefined,
                        );
                        panel.webview.postMessage({ type: 'contextsDiscovered', contexts: result.contexts, error: result.error });
                    } catch (err) {
                        panel.webview.postMessage({ type: 'contextsDiscovered', contexts: [], error: String(err) });
                    }
                    break;
                }
                case 'exportProfile': {
                    const uri = await vscode.window.showSaveDialog({
                        saveLabel: 'Export profile',
                        filters: { 'LINQ profile': ['json'] },
                        defaultUri: vscode.Uri.file((message.name || 'profile') + '.linqprofile.json'),
                    });
                    if (uri) {
                        const content = JSON.stringify({ profiles: { [message.name]: message.profile } }, null, 2) + '\n';
                        fs.writeFileSync(uri.fsPath, content, 'utf8');
                        vscode.window.showInformationMessage('Another LINQ Tool: exported profile to ' + uri.fsPath);
                    }
                    break;
                }
                case 'importProfile': {
                    const picked = await vscode.window.showOpenDialog({
                        canSelectMany: false,
                        openLabel: 'Import profile',
                        filters: { 'LINQ profile / config': ['json'] },
                    });
                    if (picked && picked[0]) {
                        try {
                            const parsed = JSON.parse(fs.readFileSync(picked[0].fsPath, 'utf8'));
                            const imported = parsed && parsed.profiles ? parsed.profiles : parsed;
                            panel.webview.postMessage({ type: 'profilesImported', profiles: imported });
                        } catch (err) {
                            vscode.window.showErrorMessage('Another LINQ Tool: import failed — ' + String(err));
                        }
                    }
                    break;
                }
                case 'save': {
                    await profiles.saveConfig(message.config as ProfilesConfigFile);
                    onSaved();
                    panel.webview.postMessage({ type: 'saved' });
                    vscode.window.showInformationMessage('Another LINQ Tool: profile settings saved.');
                    break;
                }
            }
        });

        panel.webview.html = html(panel.webview);
    }
}

function toStorablePath(picked: string): string {
    // Keep it absolute with forward slashes; the resolver handles both. Users can relativize by hand.
    return picked.replace(/\\/g, '/');
}

function html(webview: vscode.Webview): string {
    const nonce = String(Math.random()).slice(2);
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0; margin: 0; }
    .container { padding: 16px; }
    h2 { margin: 0 0 4px; }
    .row { display: flex; gap: 8px; align-items: center; margin: 6px 0; }
    .grow { flex: 1; }
    label { display: block; margin: 12px 0 4px; font-weight: 600; }
    input[type=text], input[type=password], input[type=number], textarea, select {
        width: 100%; box-sizing: border-box; background: var(--vscode-input-background);
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555);
        padding: 4px 6px; border-radius: 3px; font-family: inherit;
    }
    textarea { min-height: 64px; resize: vertical; }
    button {
        background: var(--vscode-button-background); color: var(--vscode-button-foreground);
        border: none; padding: 5px 12px; border-radius: 3px; cursor: pointer;
    }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    fieldset { border: 1px solid var(--vscode-panel-border, #444); border-radius: 4px; margin: 16px 0; padding: 8px 12px; }
    legend { padding: 0 4px; color: var(--vscode-descriptionForeground); }
    .asm-path { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
    .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .status { margin-top: 12px; color: var(--vscode-descriptionForeground); }
    .warn { color: var(--vscode-editorWarning-foreground); font-size: 12px; }

    .profiles-bar {
        position: sticky; top: 0; z-index: 10; background: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-panel-border, #444); padding: 12px 16px;
    }
    .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--vscode-panel-border, #444); padding: 0 16px; }
    .tab {
        background: transparent; color: var(--vscode-foreground); border: none; border-bottom: 2px solid transparent;
        padding: 8px 14px; cursor: pointer; opacity: .75; border-radius: 0;
    }
    .tab.active { opacity: 1; border-bottom-color: var(--vscode-focusBorder, #007acc); font-weight: 600; }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    .pkg-name { flex: 2; }
    .pkg-version { flex: 1; }
</style>
</head>
<body>

<div class="profiles-bar">
    <div class="row">
        <label style="margin:0">Profile</label>
        <select id="profileSelect" class="grow"></select>
        <button class="secondary" id="newProfile">New</button>
        <button class="secondary" id="cloneProfile">Clone</button>
        <button class="secondary" id="deleteProfile">Delete</button>
        <button class="secondary" id="exportProfile">Export</button>
        <button class="secondary" id="importProfile">Import</button>
    </div>
    <div class="row"><label style="margin:0"><input type="checkbox" id="isDefault" /> Default profile</label></div>
</div>

<div class="tabs">
    <button class="tab active" data-tab="general">General</button>
    <button class="tab" data-tab="refs">References &amp; Code</button>
    <button class="tab" data-tab="database">Database</button>
    <button class="tab" data-tab="advanced">Advanced</button>
</div>

<div class="container">
    <div id="editor"></div>
    <div class="row" style="margin-top:16px">
        <button id="save">Save</button>
        <span class="status" id="status"></span>
    </div>
    <div class="muted">Connection strings are stored in VS Code Secret Storage, not User Settings.</div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let config = { profiles: {} };
let selected = undefined;
let activeTab = 'general';

function profileNames() { return Object.keys(config.profiles || {}); }
function normAssembly(a) { return typeof a === 'string' ? { path: a, enabled: true } : { path: a.path, enabled: a.enabled !== false }; }

function parseConn(s) {
    const map = {};
    (s || '').split(';').forEach(part => {
        const i = part.indexOf('=');
        if (i > 0) map[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
    });
    return map;
}
function first(map, keys) { for (const k of keys) { if (map[k] !== undefined && map[k] !== '') return map[k]; } return ''; }

function wizardFields(provider, conn) {
    const m = parseConn(conn);
    if (provider === 'sqlite') {
        return '<label>Database file</label><div class="row">' +
            '<input type="text" class="grow" id="w_sqlite_file" value="' + escapeAttr(first(m, ['data source', 'datasource', 'filename'])) + '" placeholder="C:/data/app.db" />' +
            '<button class="secondary" type="button" id="w_sqlite_browse">Browse…</button></div>';
    }
    if (provider === 'sqlserver') {
        const windows = ('trusted_connection' in m) || ('integrated security' in m);
        return '<label>Server</label><input type="text" id="w_ss_server" value="' + escapeAttr(first(m, ['server', 'data source'])) + '" placeholder="localhost\\\\SQLEXPRESS" />' +
            '<label>Database</label><input type="text" id="w_ss_db" value="' + escapeAttr(first(m, ['database', 'initial catalog'])) + '" placeholder="MyApp" />' +
            '<label>Authentication</label><select id="w_ss_auth">' +
                '<option value="windows"' + (windows ? ' selected' : '') + '>Windows (Integrated)</option>' +
                '<option value="sql"' + (!windows ? ' selected' : '') + '>SQL Server login</option>' +
            '</select>' +
            '<div id="w_ss_sqlauth" style="' + (windows ? 'display:none' : '') + '">' +
                '<label>User</label><input type="text" id="w_ss_user" value="' + escapeAttr(first(m, ['user id', 'uid'])) + '" />' +
                '<label>Password</label><input type="password" id="w_ss_pwd" value="' + escapeAttr(first(m, ['password', 'pwd'])) + '" autocomplete="off" />' +
            '</div>' +
            '<div class="row" style="margin-top:8px"><label style="margin:0"><input type="checkbox" id="w_ss_trust"' + (/^(true|yes)$/i.test(m['trustservercertificate'] || '') ? ' checked' : '') + ' /> Trust server certificate</label></div>';
    }
    if (provider === 'postgresql') {
        return '<label>Host</label><input type="text" id="w_pg_host" value="' + escapeAttr(first(m, ['host', 'server'])) + '" placeholder="localhost" />' +
            '<label>Port</label><input type="number" id="w_pg_port" value="' + escapeAttr(m['port'] || '5432') + '" />' +
            '<label>Database</label><input type="text" id="w_pg_db" value="' + escapeAttr(first(m, ['database'])) + '" />' +
            '<label>Username</label><input type="text" id="w_pg_user" value="' + escapeAttr(first(m, ['username', 'user id', 'userid'])) + '" />' +
            '<label>Password</label><input type="password" id="w_pg_pwd" value="' + escapeAttr(first(m, ['password'])) + '" autocomplete="off" />';
    }
    if (provider === 'mysql') {
        return '<label>Server</label><input type="text" id="w_my_server" value="' + escapeAttr(first(m, ['server', 'host'])) + '" placeholder="localhost" />' +
            '<label>Port</label><input type="number" id="w_my_port" value="' + escapeAttr(m['port'] || '3306') + '" />' +
            '<label>Database</label><input type="text" id="w_my_db" value="' + escapeAttr(first(m, ['database'])) + '" />' +
            '<label>User</label><input type="text" id="w_my_user" value="' + escapeAttr(first(m, ['user id', 'uid', 'username', 'user'])) + '" />' +
            '<label>Password</label><input type="password" id="w_my_pwd" value="' + escapeAttr(first(m, ['password', 'pwd'])) + '" autocomplete="off" />';
    }
    return '<div class="muted">Select a provider to use the guided connection builder, or enter a raw connection string below.</div>';
}

function buildConn(provider) {
    const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const c = id => { const el = document.getElementById(id); return el ? el.checked : false; };
    if (provider === 'sqlite') {
        const f = v('w_sqlite_file'); return f ? 'Data Source=' + f : '';
    }
    if (provider === 'sqlserver') {
        const parts = [];
        if (v('w_ss_server')) parts.push('Server=' + v('w_ss_server'));
        if (v('w_ss_db')) parts.push('Database=' + v('w_ss_db'));
        const auth = (document.getElementById('w_ss_auth') || {}).value;
        if (auth === 'windows') { parts.push('Trusted_Connection=True'); }
        else {
            if (v('w_ss_user')) parts.push('User Id=' + v('w_ss_user'));
            if (v('w_ss_pwd')) parts.push('Password=' + v('w_ss_pwd'));
        }
        if (c('w_ss_trust')) parts.push('TrustServerCertificate=True');
        return parts.join(';');
    }
    if (provider === 'postgresql') {
        const parts = [];
        if (v('w_pg_host')) parts.push('Host=' + v('w_pg_host'));
        if (v('w_pg_port')) parts.push('Port=' + v('w_pg_port'));
        if (v('w_pg_db')) parts.push('Database=' + v('w_pg_db'));
        if (v('w_pg_user')) parts.push('Username=' + v('w_pg_user'));
        if (v('w_pg_pwd')) parts.push('Password=' + v('w_pg_pwd'));
        return parts.join(';');
    }
    if (provider === 'mysql') {
        const parts = [];
        if (v('w_my_server')) parts.push('Server=' + v('w_my_server'));
        if (v('w_my_port')) parts.push('Port=' + v('w_my_port'));
        if (v('w_my_db')) parts.push('Database=' + v('w_my_db'));
        if (v('w_my_user')) parts.push('User Id=' + v('w_my_user'));
        if (v('w_my_pwd')) parts.push('Password=' + v('w_my_pwd'));
        return parts.join(';');
    }
    return undefined;
}

function render() {
    const names = profileNames();
    if (!selected || !names.includes(selected)) selected = names[0];

    const sel = document.getElementById('profileSelect');
    sel.innerHTML = names.map(n => '<option' + (n === selected ? ' selected' : '') + '>' + escapeHtml(n) + '</option>').join('');
    document.getElementById('isDefault').checked = config.defaultProfile === selected;

    const editor = document.getElementById('editor');
    if (!selected) { editor.innerHTML = '<p class="muted">No profiles yet. Click "New" to create one.</p>'; return; }
    const p = config.profiles[selected];
    p.assemblies = p.assemblies || [];
    const dbEnabled = p.dbEnabled !== false;
    const provider = p.provider || '';

    const asmRows = p.assemblies.map((a, i) => {
        const n = normAssembly(a);
        return '<div class="row">' +
            '<input type="checkbox" data-asm-toggle="' + i + '"' + (n.enabled ? ' checked' : '') + ' title="Enable/disable" />' +
            '<input type="text" class="grow asm-path" data-asm-path="' + i + '" value="' + escapeAttr(n.path) + '" />' +
            '<button class="secondary" data-asm-remove="' + i + '">Remove</button>' +
        '</div>';
    }).join('');

    const pkgRows = (p.packages || []).map((pkg, i) => {
        const at = pkg.lastIndexOf('@');
        const name = at > 0 ? pkg.slice(0, at) : pkg;
        const version = at > 0 ? pkg.slice(at + 1) : '';
        return '<div class="row">' +
            '<input type="text" class="pkg-name" data-pkg-name="' + i + '" value="' + escapeAttr(name) + '" placeholder="Dapper" />' +
            '<input type="text" class="pkg-version" data-pkg-version="' + i + '" value="' + escapeAttr(version) + '" placeholder="2.1.66 (optional)" />' +
            '<button class="secondary" data-pkg-remove="' + i + '">Remove</button>' +
        '</div>';
    }).join('');

    const generalTab =
        '<div class="tab-panel" data-panel="general">' +
        '<label>Name</label><input type="text" id="profileName" value="' + escapeAttr(selected) + '" />' +
        '<label>.NET runtime</label><select id="targetFramework">' +
            '<option value="auto"' + (!p.targetFramework ? ' selected' : '') + '>Automatic (based on assemblies)</option>' +
            '<option value="net10.0"' + (p.targetFramework === 'net10.0' ? ' selected' : '') + '>.NET 10 LTS</option>' +
            '<option value="net11.0"' + (p.targetFramework === 'net11.0' ? ' selected' : '') + '>.NET 11 (Preview)</option>' +
        '</select>' +
        '<div class="muted">Automatic uses .NET 10 by default and selects a newer runtime when a configured assembly requires it.</div>' +
        '<label>Imports (one namespace per line)</label>' +
        '<textarea id="imports">' + escapeHtml((p.imports || []).join('\\n')) + '</textarea>' +
        '</div>';

    const refsTab =
        '<div class="tab-panel" data-panel="refs">' +
        '<fieldset><legend>NuGet packages</legend>' + pkgRows +
            '<div class="row"><button class="secondary" id="addPackage">Add package</button></div>' +
            '<div class="muted">Version is optional; leave blank for the latest compatible release.</div>' +
        '</fieldset>' +
        '<fieldset><legend>Project references (DLLs)</legend>' + asmRows +
            '<div class="row"><button class="secondary" id="addAssembly">Add DLL…</button></div>' +
            '<div class="muted">Point at your application\\'s build output so EF Core and native deps are alongside the DLL.</div>' +
        '</fieldset>' +
        '<label>Run before every script (C#)</label>' +
        '<textarea id="prelude" placeholder="// Variables, helper methods, or setup statements">' + escapeHtml(p.prelude || '') + '</textarea>' +
        '<div class="muted">This snippet is prepended to every script run with this profile.</div>' +
        '</div>';

    const databaseTab =
        '<div class="tab-panel" data-panel="database">' +
        '<div class="row"><label style="margin:0"><input type="checkbox" id="dbEnabled"' + (dbEnabled ? ' checked' : '') + ' /> Enable database (expose <code>Db</code>)</label></div>' +
        '<div id="dbFields" style="' + (dbEnabled ? '' : 'opacity:.5;pointer-events:none') + '">' +
            '<label>Provider</label><select id="provider">' +
                [['', 'None / custom'], ['sqlite', 'SQLite'], ['sqlserver', 'SQL Server'], ['postgresql', 'PostgreSQL'], ['mysql', 'MySQL']]
                    .map(o => '<option value="' + o[0] + '"' + (provider === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
            '</select>' +
            '<fieldset><legend>Connection</legend>' +
                '<div id="wizard">' + wizardFields(provider, p.connectionString || '') + '</div>' +
                '<details style="margin-top:10px"' + (!provider ? ' open' : '') + '><summary class="muted">Advanced: raw connection string</summary>' +
                    '<div class="row" style="margin-top:6px">' +
                        '<input type="password" class="grow" id="connectionString" value="' + escapeAttr(p.connectionString || '') + '" autocomplete="off" />' +
                        '<button class="secondary" type="button" id="toggleConnectionString" title="Show connection string" aria-label="Show connection string">&#128065;</button>' +
                    '</div>' +
                '</details>' +
            '</fieldset>' +
            '<fieldset><legend>DbContext</legend>' +
                '<div class="row">' +
                    '<input type="text" class="grow" id="context" list="contextList" value="' + escapeAttr(p.context || '') + '" placeholder="MyApp.Data.AppDbContext" />' +
                    '<button class="secondary" type="button" id="refreshContexts" title="Detect DbContext types from the configured DLLs and referenced project DLLs beside them">Detect</button>' +
                '</div>' +
                '<datalist id="contextList"></datalist>' +
                '<div class="muted" id="contextStatus">Click Detect to find DbContext types in the configured DLLs (and referenced project DLLs in the same folder).</div>' +
            '</fieldset>' +
        '</div>' +
        '</div>';

    const advancedTab =
        '<div class="tab-panel" data-panel="advanced">' +
        '<label>EF Core version</label>' +
        '<input type="text" id="efCoreVersion" value="' + escapeAttr(p.efCoreVersion || '') + '" placeholder="Automatic (for example, 8.0.19)" />' +
        '<div class="muted">Leave blank to detect EF Core beside the application DLL. An explicit version is used when the provider must be restored.</div>' +
        '<fieldset><legend>Custom DbContext factory (optional)</legend>' +
            '<label>Type</label><input type="text" id="factoryType" value="' + escapeAttr((p.contextFactory && p.contextFactory.type) || '') + '" placeholder="MyApp.Data.LinqContextFactory" />' +
            '<label>Method</label><input type="text" id="factoryMethod" value="' + escapeAttr((p.contextFactory && p.contextFactory.method) || '') + '" placeholder="Create" />' +
        '</fieldset>' +
        '</div>';

    editor.innerHTML = generalTab + refsTab + databaseTab + advancedTab;
    applyActiveTab();
    wireEditor();
}

function applyActiveTab() {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === activeTab));
    document.querySelectorAll('.tab-panel').forEach(pn => pn.classList.toggle('active', pn.getAttribute('data-panel') === activeTab));
}

function enabledAssemblies(p) {
    return (p.assemblies || []).map(normAssembly).filter(a => a.enabled && a.path).map(a => a.path);
}

function wireWizard(p) {
    const provider = p.provider || '';
    const syncFromWizard = () => {
        const built = buildConn(provider);
        if (built !== undefined) {
            p.connectionString = built || undefined;
            const raw = document.getElementById('connectionString');
            if (raw) raw.value = built;
        }
    };
    ['w_sqlite_file','w_ss_server','w_ss_db','w_ss_user','w_ss_pwd','w_pg_host','w_pg_port','w_pg_db','w_pg_user','w_pg_pwd','w_my_server','w_my_port','w_my_db','w_my_user','w_my_pwd']
        .forEach(id => { const el = document.getElementById(id); if (el) el.oninput = syncFromWizard; });
    ['w_ss_trust'].forEach(id => { const el = document.getElementById(id); if (el) el.onchange = syncFromWizard; });
    const auth = document.getElementById('w_ss_auth');
    if (auth) auth.onchange = e => {
        const sqlAuth = document.getElementById('w_ss_sqlauth');
        if (sqlAuth) sqlAuth.style.display = e.target.value === 'windows' ? 'none' : '';
        syncFromWizard();
    };
    const browse = document.getElementById('w_sqlite_browse');
    if (browse) browse.onclick = () => vscode.postMessage({ type: 'pickSqliteFile' });
}

function wireEditor() {
    const p = config.profiles[selected];

    document.querySelectorAll('.tab').forEach(t => t.onclick = () => { activeTab = t.getAttribute('data-tab'); applyActiveTab(); });

    const add = document.getElementById('addAssembly');
    if (add) add.onclick = () => vscode.postMessage({ type: 'pickAssembly' });

    document.querySelectorAll('[data-asm-toggle]').forEach(el => el.onchange = e => {
        const i = +e.target.getAttribute('data-asm-toggle');
        p.assemblies[i] = { path: normAssembly(p.assemblies[i]).path, enabled: e.target.checked };
    });
    document.querySelectorAll('[data-asm-path]').forEach(el => el.oninput = e => {
        const i = +e.target.getAttribute('data-asm-path');
        p.assemblies[i] = { path: e.target.value, enabled: normAssembly(p.assemblies[i]).enabled };
    });
    document.querySelectorAll('[data-asm-remove]').forEach(el => el.onclick = e => {
        const i = +e.target.getAttribute('data-asm-remove');
        p.assemblies.splice(i, 1); render();
    });

    const addPkg = document.getElementById('addPackage');
    if (addPkg) addPkg.onclick = () => { (p.packages = p.packages || []).push(''); render(); };
    const syncPackages = () => {
        const names = document.querySelectorAll('[data-pkg-name]');
        const versions = document.querySelectorAll('[data-pkg-version]');
        const out = [];
        names.forEach((el, idx) => {
            const name = el.value.trim();
            const version = versions[idx] ? versions[idx].value.trim() : '';
            if (name) out.push(version ? name + '@' + version : name);
        });
        p.packages = out;
    };
    document.querySelectorAll('[data-pkg-name],[data-pkg-version]').forEach(el => el.oninput = syncPackages);
    document.querySelectorAll('[data-pkg-remove]').forEach(el => el.onclick = e => {
        const i = +e.target.getAttribute('data-pkg-remove');
        (p.packages || []).splice(i, 1); render();
    });

    bind('imports', v => p.imports = v.split('\\n').map(s => s.trim()).filter(Boolean));
    bind('prelude', v => p.prelude = v || undefined);
    bind('efCoreVersion', v => p.efCoreVersion = v.trim() || undefined);
    const targetFramework = document.getElementById('targetFramework');
    if (targetFramework) targetFramework.onchange = e => {
        p.targetFramework = e.target.value === 'auto' ? undefined : e.target.value;
    };
    bind('context', v => p.context = v || undefined);
    bind('connectionString', v => p.connectionString = v || undefined);
    const toggleConnectionString = document.getElementById('toggleConnectionString');
    if (toggleConnectionString) toggleConnectionString.onclick = () => {
        const input = document.getElementById('connectionString');
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        const label = showing ? 'Show connection string' : 'Hide connection string';
        toggleConnectionString.title = label;
        toggleConnectionString.setAttribute('aria-label', label);
    };
    bind('factoryType', v => setFactory(p, 'type', v));
    bind('factoryMethod', v => setFactory(p, 'method', v));
    const provider = document.getElementById('provider');
    if (provider) provider.onchange = e => {
        p.provider = e.target.value || undefined;
        const wizard = document.getElementById('wizard');
        if (wizard) wizard.innerHTML = wizardFields(p.provider || '', p.connectionString || '');
        wireWizard(p);
    };
    const dbEnabled = document.getElementById('dbEnabled');
    if (dbEnabled) dbEnabled.onchange = e => { p.dbEnabled = e.target.checked; render(); };

    const refresh = document.getElementById('refreshContexts');
    if (refresh) refresh.onclick = () => {
        const status = document.getElementById('contextStatus');
        if (status) status.textContent = 'Detecting DbContext types…';
        vscode.postMessage({
            type: 'discoverContexts',
            assemblies: enabledAssemblies(p),
            targetFramework: p.targetFramework,
            efCoreVersion: p.efCoreVersion,
        });
    };

    wireWizard(p);
}

function setFactory(p, key, v) {
    p.contextFactory = p.contextFactory || {};
    p.contextFactory[key] = v || undefined;
    if (!p.contextFactory.type && !p.contextFactory.method) p.contextFactory = undefined;
}

function bind(id, fn) { const el = document.getElementById(id); if (el) el.oninput = e => fn(e.target.value); }

document.getElementById('profileSelect').onchange = e => { selected = e.target.value; render(); };
document.getElementById('isDefault').onchange = e => { config.defaultProfile = e.target.checked ? selected : undefined; };
document.getElementById('newProfile').onclick = () => {
    let i = 1, name = 'profile'; while (config.profiles[name]) name = 'profile' + (++i);
    config.profiles[name] = { assemblies: [], imports: [] }; selected = name; render();
};
document.getElementById('cloneProfile').onclick = () => {
    if (!selected) return;
    let base = selected + ' copy', name = base, i = 1;
    while (config.profiles[name]) name = base + ' ' + (++i);
    config.profiles[name] = JSON.parse(JSON.stringify(config.profiles[selected]));
    selected = name; render();
};
document.getElementById('exportProfile').onclick = () => {
    if (selected) vscode.postMessage({ type: 'exportProfile', name: selected, profile: config.profiles[selected] });
};
document.getElementById('importProfile').onclick = () => vscode.postMessage({ type: 'importProfile' });
document.getElementById('deleteProfile').onclick = () => {
    if (!selected) return; delete config.profiles[selected];
    if (config.defaultProfile === selected) config.defaultProfile = undefined;
    selected = undefined; render();
};
document.getElementById('save').onclick = () => {
    const nameEl = document.getElementById('profileName');
    if (nameEl && selected) {
        const newName = nameEl.value.trim();
        if (newName && newName !== selected && !config.profiles[newName]) {
            config.profiles[newName] = config.profiles[selected];
            delete config.profiles[selected];
            if (config.defaultProfile === selected) config.defaultProfile = newName;
            selected = newName;
        }
    }
    vscode.postMessage({ type: 'save', config });
};

window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'init') {
        config = m.config || { profiles: {} }; config.profiles = config.profiles || {};
        render();
    } else if (m.type === 'assemblyPicked') {
        const p = config.profiles[selected]; if (p) { (p.assemblies = p.assemblies || []).push(m.path); render(); }
    } else if (m.type === 'sqliteFilePicked') {
        const fileInput = document.getElementById('w_sqlite_file');
        if (fileInput) { fileInput.value = m.path; fileInput.dispatchEvent(new Event('input')); }
    } else if (m.type === 'contextsDiscovered') {
        const list = document.getElementById('contextList');
        const status = document.getElementById('contextStatus');
        if (list) list.innerHTML = (m.contexts || []).map(c => '<option value="' + escapeAttr(c) + '"></option>').join('');
        if (status) {
            if (m.error) status.textContent = 'Detection failed: ' + m.error;
            else if (!m.contexts || m.contexts.length === 0) status.textContent = 'No DbContext types found in the configured DLLs.';
            else status.textContent = 'Found ' + m.contexts.length + ' DbContext type(s). Choose one from the field above.';
        }
    } else if (m.type === 'profilesImported') {
        let last;
        for (const entry of Object.entries(m.profiles || {})) {
            const name = entry[0]; let target = name, i = 1;
            while (config.profiles[target]) target = name + ' (' + (++i) + ')';
            config.profiles[target] = entry[1]; last = target;
        }
        if (last) selected = last;
        render();
    } else if (m.type === 'saved') {
        document.getElementById('status').textContent = 'Saved to VS Code User Settings.';
        render();
    }
});

function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g,'&quot;'); }

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
