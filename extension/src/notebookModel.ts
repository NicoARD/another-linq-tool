import { randomUUID } from 'crypto';
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import type { ExecuteResult } from './runnerClient';

export interface StatefulCell {
    id: string;
    language: 'csharp' | 'markdown';
    source: string;
    result?: ExecuteResult;
    executionOrder?: number;
}

export interface StatefulDocument {
    profile: string;
    cells: StatefulCell[];
}

export function createNotebook(): StatefulDocument {
    return { profile: '', cells: [
        { id: randomUUID(), language: 'csharp', source: '@namespace System.Text' },
        { id: randomUUID(), language: 'csharp', source: 'var numbers = Enumerable.Range(1, 5).ToList();' },
        { id: randomUUID(), language: 'csharp', source: 'numbers.Select(number => new { Number = number, Square = number * number })' },
    ] };
}

export function writeNotebook(notebook: StatefulDocument): string {
    const xml = new XMLBuilder({ ignoreAttributes: false, format: true }).build({
        Notebook: {
            '@_version': '1', '@_profile': notebook.profile,
            Cell: notebook.cells.map(cell => ({
                '@_id': cell.id, '@_language': cell.language,
                ...(cell.executionOrder !== undefined ? { '@_executionOrder': String(cell.executionOrder) } : {}),
                Source: cell.source,
                ...(cell.result ? { Output: JSON.stringify(cell.result) } : {}),
            })),
        },
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xml.replace(/\r/g, '&#13;')}`;
}

export function parseNotebook(xml: string): StatefulDocument {
    const valid = XMLValidator.validate(xml);
    if (valid !== true) { throw new Error(`Invalid notebook XML at line ${valid.err.line}: ${valid.err.msg}`); }
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) { throw new Error('Notebook XML cannot contain DTDs or entity declarations.'); }
    const root = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false,
        htmlEntities: true, isArray: name => name === 'Cell' }).parse(xml).Notebook;
    if (!root || root['@_version'] !== '1') { throw new Error('Expected a Notebook root with version="1". Reopen as XML to repair it.'); }
    const ids = new Set<string>();
    const cells = (root.Cell ?? []).map((raw: Record<string, unknown>): StatefulCell => {
        const id = raw['@_id'];
        const language = raw['@_language'];
        if (typeof id !== 'string' || !id || ids.has(id) || (language !== 'csharp' && language !== 'markdown')) {
            throw new Error('Each notebook cell needs a unique id and a csharp or markdown language.');
        }
        ids.add(id);
        if (raw.Source !== undefined && typeof raw.Source !== 'string') { throw new Error('Cell source must be text.'); }
        const cell: StatefulCell = { id, language, source: raw.Source as string ?? '' };
        if (raw.Output !== undefined) {
            const result = JSON.parse(String(raw.Output));
            if (!result || !['success', 'compileError', 'runtimeError', 'infrastructureError', 'cancelled'].includes(result.status)
                || typeof result.elapsedMs !== 'number') { throw new Error('Invalid saved notebook output.'); }
            cell.result = result;
        }
        if (raw['@_executionOrder'] !== undefined) {
            const order = Number(raw['@_executionOrder']);
            if (!Number.isSafeInteger(order) || order < 1) { throw new Error('Execution order must be a positive integer.'); }
            cell.executionOrder = order;
        }
        return cell;
    });
    return { profile: root['@_profile'] ?? '', cells };
}