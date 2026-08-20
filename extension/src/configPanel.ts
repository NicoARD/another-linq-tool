import * as fs from 'fs';
import * as vscode from 'vscode';
import { ProfileManager, ProfilesConfigFile } from './profiles';

/** A webview form for editing global User Settings profiles (assemblies, imports, database/context). */
export class ConfigPanel {
    private static panel: vscode.WebviewPanel | undefined;

    static show(context: vscode.ExtensionContext, profiles: ProfileManager, onSaved: () => void): void {
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
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
    h2 { margin: 0 0 4px; }
    .path { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 16px; }
    .row { display: flex; gap: 8px; align-items: center; margin: 6px 0; }
    .grow { flex: 1; }
    label { display: block; margin: 12px 0 4px; font-weight: 600; }
    input[type=text], textarea, select {
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
</style>
</head>
<body>
<h2>Another LINQ Tool Configuration</h2>

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

<div id="editor"></div>

<div class="row" style="margin-top:16px">
    <button id="save">Save</button>
    <span class="status" id="status"></span>
</div>
<div class="muted">Connection strings are stored in VS Code Secret Storage, not User Settings.</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let config = { profiles: {} };
let selected = undefined;

function profileNames() { return Object.keys(config.profiles || {}); }

function normAssembly(a) { return typeof a === 'string' ? { path: a, enabled: true } : { path: a.path, enabled: a.enabled !== false }; }

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

    const asmRows = p.assemblies.map((a, i) => {
        const n = normAssembly(a);
        return '<div class="row">' +
            '<input type="checkbox" data-asm-toggle="' + i + '"' + (n.enabled ? ' checked' : '') + ' title="Enable/disable" />' +
            '<input type="text" class="grow asm-path" data-asm-path="' + i + '" value="' + escapeAttr(n.path) + '" />' +
            '<button class="secondary" data-asm-remove="' + i + '">Remove</button>' +
        '</div>';
    }).join('');

    editor.innerHTML =
        '<label>Name</label><input type="text" id="profileName" value="' + escapeAttr(selected) + '" />' +
        '<fieldset><legend>Assemblies (DLLs)</legend>' + asmRows +
            '<div class="row"><button class="secondary" id="addAssembly">Add DLL…</button></div>' +
            '<div class="muted">Point at your application\\'s build output so EF Core and native deps are alongside the DLL.</div>' +
        '</fieldset>' +
        '<label>Imports (one namespace per line)</label>' +
        '<textarea id="imports">' + escapeHtml((p.imports || []).join('\\n')) + '</textarea>' +
        '<label>NuGet packages (one per line, e.g. Dapper@2.1.66)</label>' +
        '<textarea id="packages" placeholder="Dapper@2.1.66">' + escapeHtml((p.packages || []).join('\\n')) + '</textarea>' +
        '<fieldset><legend>Database</legend>' +
            '<div class="row"><label style="margin:0"><input type="checkbox" id="dbEnabled"' + (dbEnabled ? ' checked' : '') + ' /> Enable database (expose <code>Db</code>)</label></div>' +
            '<div id="dbFields" style="' + (dbEnabled ? '' : 'opacity:.5;pointer-events:none') + '">' +
                '<label>DbContext type</label><input type="text" id="context" value="' + escapeAttr(p.context || '') + '" placeholder="MyApp.Data.AppDbContext" />' +
                '<label>Provider</label><select id="provider">' +
                    ['', 'sqlite', 'sqlserver'].map(v => '<option' + ((p.provider || '') === v ? ' selected' : '') + '>' + v + '</option>').join('') +
                '</select>' +
                '<label>Connection string</label><input type="text" id="connectionString" value="' + escapeAttr(p.connectionString || '') + '" />' +
                '<label>Custom factory (optional) — type / method</label>' +
                '<div class="row">' +
                    '<input type="text" class="grow" id="factoryType" value="' + escapeAttr((p.contextFactory && p.contextFactory.type) || '') + '" placeholder="MyApp.Data.LinqContextFactory" />' +
                    '<input type="text" class="grow" id="factoryMethod" value="' + escapeAttr((p.contextFactory && p.contextFactory.method) || '') + '" placeholder="Create" />' +
                '</div>' +
            '</div>' +
        '</fieldset>';

    wireEditor();
}

function wireEditor() {
    const p = config.profiles[selected];
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

    bind('imports', v => p.imports = v.split('\\n').map(s => s.trim()).filter(Boolean));
    bind('packages', v => p.packages = v.split('\\n').map(s => s.trim()).filter(Boolean));
    bind('context', v => p.context = v || undefined);
    bind('connectionString', v => p.connectionString = v || undefined);
    bind('factoryType', v => setFactory(p, 'type', v));
    bind('factoryMethod', v => setFactory(p, 'method', v));
    const provider = document.getElementById('provider');
    if (provider) provider.onchange = e => p.provider = e.target.value || undefined;
    const dbEnabled = document.getElementById('dbEnabled');
    if (dbEnabled) dbEnabled.onchange = e => { p.dbEnabled = e.target.checked; render(); };
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
        document.getElementById('status').textContent = m.path ? 'Saved to ' + m.path : 'No workspace folder to save into.';
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
