import * as vscode from 'vscode';
import { ExecuteResult, ResultNode, SqlCommandInfo } from './runnerClient';

/** Renders an execution result in a reusable, script-free webview panel. */
export class ResultPanel {
    private static panel: vscode.WebviewPanel | undefined;

    static show(result: ExecuteResult, title: string): void {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'linqRunnerResult',
                'Another LINQ Tool Result',
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                { enableScripts: false, retainContextWhenHidden: true },
            );
            this.panel.onDidDispose(() => (this.panel = undefined));
        }

        this.panel.title = `Another LINQ Tool Result — ${title}`;
        this.panel.webview.html = renderHtml(result);
        this.panel.reveal(vscode.ViewColumn.Beside, true);
    }
}

function renderHtml(result: ExecuteResult): string {
    const body = renderBody(result);
    const meta = `<div class="meta">${escape(result.status)} · ${result.elapsedMs} ms</div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
<style>
    body { font-family: var(--vscode-editor-font-family, monospace); color: var(--vscode-foreground); padding: 12px; }
    .meta { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 12px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid var(--vscode-panel-border, #444); padding: 4px 8px; text-align: left; vertical-align: top; font-size: 13px; }
    th { background: var(--vscode-editorWidget-background); position: sticky; top: 0; }
    tr:nth-child(even) td { background: var(--vscode-list-hoverBackground); }
    .scalar { font-size: 15px; padding: 8px 0; }
    .kv td:first-child { color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe); white-space: nowrap; }
    details.nested > summary { cursor: pointer; color: var(--vscode-textLink-foreground); white-space: nowrap; }
    details.nested[open] > summary { margin-bottom: 6px; }
    details.nested table { margin: 4px 0; }
    .cell-type { color: var(--vscode-descriptionForeground); font-size: 10px; margin-left: 4px; }
    .type { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .error { color: var(--vscode-errorForeground); }
    .error pre { white-space: pre-wrap; background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; }
    .diag { color: var(--vscode-editorWarning-foreground); }
    .truncated { color: var(--vscode-editorWarning-foreground); font-size: 12px; margin-top: 8px; }
    .null { color: var(--vscode-descriptionForeground); font-style: italic; }
    .section { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--vscode-descriptionForeground); margin: 4px 0; }
    .console { white-space: pre-wrap; background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; font-size: 13px; margin-bottom: 12px; }
    .dump { margin-bottom: 16px; }
    details.sql { margin-top: 10px; }
    details.sql summary { cursor: pointer; color: var(--vscode-textLink-foreground); }
    .sql-command { margin: 10px 0 14px; }
    .sql-command pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; margin: 6px 0; }
    .sql-parameters { margin: 6px 0; }
</style>
</head>
<body>
${meta}
${body}
</body>
</html>`;
}

function renderBody(result: ExecuteResult): string {
    const consoleBlock = result.output ? renderConsole(result.output, result.outputTruncated) : '';
    const dumps = renderDumps(result);

    if (result.status === 'compileError') {
        return consoleBlock + dumps + renderDiagnostics(result) + renderSql(result.sqlCommands);
    }
    if (result.status === 'runtimeError' || result.status === 'infrastructureError') {
        return consoleBlock + dumps + renderError(result) + renderSql(result.sqlCommands);
    }
    if (result.status === 'cancelled') {
        return consoleBlock + dumps + `<div class="diag">Execution cancelled.</div>` + renderSql(result.sqlCommands);
    }

    const hasDumps = (result.dumps?.length ?? 0) > 0;
    let value = '';
    if (result.value && result.value.kind !== 'null') {
        value = renderNode(result.value);
    } else if (!hasDumps) {
        value = result.value ? renderNode(result.value) : `<div class="null">no value</div>`;
    }

    return consoleBlock + dumps + value + renderSql(result.sqlCommands);
}

function renderDumps(result: ExecuteResult): string {
    return (result.dumps ?? [])
        .map((d) => {
            const heading = d.label ? `<div class="section">${escape(d.label)}</div>` : '';
            return `<div class="dump">${heading}${renderNode(d.value)}${renderSql(d.sqlCommands)}</div>`;
        })
        .join('');
}

function renderSql(commands?: SqlCommandInfo[]): string {
    if (!commands?.length) {
        return '';
    }

    const label = commands.length === 1 ? 'SQL' : `SQL (${commands.length} commands)`;
    const items = commands.map((command) => {
        const parameters = command.parameters?.length
            ? `${command.parameters.map((p) => `${p.name} = ${p.value ?? 'NULL'}`).join('\n')}\n\n`
            : '';
        const outcome = command.succeeded === false ? `Failed${command.error ? `: ${command.error}` : ''}` : 'Succeeded';
        const execution = command.elapsedMs === undefined ? outcome : `${outcome} · Execution: ${command.elapsedMs} ms`;
        return `<div class="sql-command"><pre>${escape(parameters + command.text)}</pre><div class="type">${escape(command.commandType)} · ${escape(execution)}</div></div>`;
    }).join('');

    return `<details class="sql"><summary>${label}</summary>${items}</details>`;
}

function renderConsole(output: string, truncated?: boolean): string {
    const note = truncated ? `<div class="truncated">Console output truncated.</div>` : '';
    return `<div class="section">Console output</div><pre class="console">${escape(output)}</pre>${note}`;
}

function renderNode(node: ResultNode): string {
    switch (node.kind) {
        case 'null':
            return `<div class="null">null</div>`;
        case 'scalar':
            return `<div class="scalar">${escape(node.text ?? '')}</div><div class="type">${escape(node.typeName ?? '')}</div>`;
        case 'object':
            return renderObject(node);
        case 'table':
            return renderTable(node);
        default:
            return `<div>${escape(JSON.stringify(node))}</div>`;
    }
}

function renderObject(node: ResultNode): string {
    const rows = (node.properties ?? [])
        .map(
            (p) =>
                `<tr><td>${escape(p.name)}<div class="type">${escape(p.typeName ?? '')}</div></td><td>${renderCell(
                    p.node,
                    p.value,
                )}</td></tr>`,
        )
        .join('');
    return `<div class="type">${escape(node.typeName ?? '')}</div><table class="kv">${rows}</table>`;
}

function renderTable(node: ResultNode): string {
    const head = (node.columns ?? []).map((c) => `<th>${escape(c)}</th>`).join('');
    const rows = (node.rows ?? [])
        .map((row, rowIndex) => `<tr>${row.map((cell, columnIndex) =>
            `<td>${renderCell(node.cells?.[rowIndex]?.[columnIndex], cell)}</td>`).join('')}</tr>`)
        .join('');
    const truncated = node.truncated
        ? `<div class="truncated">Results truncated at ${node.rowCount} rows.</div>`
        : '';
    return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
<div class="type">${escape(node.typeName ?? '')} · ${node.rowCount ?? 0} row(s)</div>${truncated}`;
}

function renderCell(node: ResultNode | undefined, fallback: string | null | undefined): string {
    if (!node) {
        return escape(fallback ?? 'null');
    }

    if (node.kind === 'null') {
        return `<span class="null">null</span>`;
    }
    if (node.kind === 'scalar') {
        return `<span>${escape(node.text ?? '')}</span><span class="cell-type">${escape(node.typeName ?? '')}</span>`;
    }

    const summary = node.kind === 'table'
        ? `[${node.rowCount ?? 0} item(s)]`
        : `{ ${node.typeName ?? 'object'} }`;
    return `<details class="nested"><summary>${escape(summary)}</summary>${renderNode(node)}</details>`;
}

function renderDiagnostics(result: ExecuteResult): string {
    const items = (result.diagnostics ?? [])
        .map(
            (d) =>
                `<li><span class="diag">${escape(d.severity)} ${escape(d.id)}</span> (line ${d.line + 1}, col ${
                    d.character + 1
                }): ${escape(d.message)}</li>`,
        )
        .join('');
    return `<div class="error">Compilation failed:</div><ul>${items}</ul>`;
}

function renderError(result: ExecuteResult): string {
    const err = result.error;
    if (!err) {
        return `<div class="error">Unknown error.</div>`;
    }
    const inner = err.inner
        ? `<div class="type">Inner: ${escape(err.inner.type)}: ${escape(err.inner.message)}</div>`
        : '';
    return `<div class="error"><strong>${escape(err.type)}</strong>: ${escape(err.message)}</div>${inner}
<pre class="error">${escape(err.stack ?? '')}</pre>`;
}

function escape(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
