import { randomUUID } from 'crypto';
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import type { ExecuteResult } from './runnerClient';

export interface CollectionCell {
    id: string;
    role: 'prelude' | 'script';
    source: string;
    result?: ExecuteResult;
    inputHash?: string;
}

export interface ScriptCollection {
    profile: string;
    namespaces: string[];
    outputLocation: 'inline' | 'panel';
    cells: CollectionCell[];
}

export function createCollection(): ScriptCollection {
    return {
        profile: '', namespaces: [], outputLocation: 'inline',
        cells: [
            { id: randomUUID(), role: 'prelude', source: '' },
            { id: randomUUID(), role: 'script', source: 'Enumerable.Range(1, 10)' },
        ],
    };
}

export function parseCollection(xml: string): ScriptCollection {
    const validation = XMLValidator.validate(xml);
    if (validation !== true) {
        throw new Error(`Invalid collection XML: ${validation.err.msg} (line ${validation.err.line}). Open as XML to repair it.`);
    }
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
        throw new Error('Collection XML cannot contain DTDs or entity declarations.');
    }
    const parsed = new XMLParser({
        ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false,
        trimValues: false, htmlEntities: true, isArray: (name) => name === 'Cell' || name === 'Namespace',
    }).parse(xml);
    const root = parsed.Collection;
    if (!root || root['@_version'] !== '1') {
        throw new Error('Expected a Collection root with version="1". Open as XML to repair it.');
    }
    const outputLocation = root['@_outputLocation'] ?? 'inline';
    if (outputLocation !== 'inline' && outputLocation !== 'panel') {
        throw new Error('Collection outputLocation must be inline or panel.');
    }
    const ids = new Set<string>();
    const cells: CollectionCell[] = (root.Cell ?? []).map((raw: Record<string, unknown>) => {
        const id = raw['@_id'];
        const role = raw['@_role'];
        if (typeof id !== 'string' || !id || ids.has(id) || (role !== 'prelude' && role !== 'script')) {
            throw new Error('Every collection cell needs a unique id and a prelude or script role.');
        }
        ids.add(id);
        if (raw.Source !== undefined && typeof raw.Source !== 'string') {
            throw new Error('Cell Source must contain text, not XML elements.');
        }
        const cell: CollectionCell = { id, role, source: (raw.Source as string) ?? '' };
        if (raw.Output !== undefined) {
            const output = JSON.parse(String(raw.Output));
            if (!output || !['success', 'compileError', 'runtimeError', 'infrastructureError', 'cancelled'].includes(output.status)
                || typeof output.elapsedMs !== 'number') {
                throw new Error(`Invalid saved output in cell ${id}.`);
            }
            cell.result = output;
            if (typeof raw['@_inputHash'] === 'string') {
                cell.inputHash = raw['@_inputHash'];
            }
        }
        return cell;
    });
    if (!cells.length || cells[0].role !== 'prelude' || cells.slice(1).some(cell => cell.role !== 'script')) {
        throw new Error('A collection must start with exactly one prelude cell, followed by script cells.');
    }
    const namespaces = root.Namespaces?.Namespace ?? [];
    if (!namespaces.every((value: unknown) => typeof value === 'string')) {
        throw new Error('Namespaces must contain Namespace text elements.');
    }
    return { profile: root['@_profile'] ?? '', namespaces, outputLocation, cells };
}

export function writeCollection(collection: ScriptCollection): string {
    const xml = new XMLBuilder({ ignoreAttributes: false, format: true, suppressEmptyNode: false }).build({
        Collection: {
            '@_version': '1', '@_profile': collection.profile, '@_outputLocation': collection.outputLocation,
            Namespaces: { Namespace: collection.namespaces },
            Cell: collection.cells.map(cell => ({
                '@_id': cell.id, '@_role': cell.role,
                ...(cell.result && cell.inputHash ? { '@_inputHash': cell.inputHash } : {}),
                Source: cell.source,
                ...(cell.result ? { Output: JSON.stringify(cell.result) } : {}),
            })),
        },
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xml.replace(/\r/g, '&#13;')}`;
}