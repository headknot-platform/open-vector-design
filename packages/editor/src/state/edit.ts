/** Property edits from the inspector. `live` edits belong to an ongoing gesture (label scrub). */
import {
    type AnyNode,
    type FrameNode,
    type Page,
    applyConstraints,
    findNode,
    resizeNode,
} from '@workspace/ovd-core';
import type { Draft } from 'immer';
import { docRoots } from '../lib/doc';
import { canvasMeasure } from '../lib/measure';
import { editor, tokenSetFor } from './store';

export function editNodes(ids: string[], fn: (n: Draft<AnyNode>) => void, live = false): void {
    editor().update(
        (d) => {
            const roots = docRoots(d, editor().doc);
            for (const id of ids) {
                const n = findNode(roots, id);
                if (n) fn(n as Draft<AnyNode>);
            }
        },
        { history: !live },
    );
}

export function setSize(
    ids: string[],
    size: { width?: number; height?: number },
    live = false,
): void {
    const s = editor();
    const ctx = {
        tokens: s.project ? tokenSetFor(s.project, s.previewTheme) : undefined,
        measure: canvasMeasure,
    };
    editNodes(
        ids,
        (n) => {
            const oldW = n.width;
            const oldH = n.height;
            if (n.type === 'text') {
                if (size.width !== undefined && n.box === 'auto-width') n.box = 'fixed-width';
                if (size.height !== undefined) n.box = 'fixed';
            }
            resizeNode(n as AnyNode, size.width ?? n.width, size.height ?? n.height, ctx);
            // A manual size on a hugging axis turns it fixed, as in Figma.
            if (n.sizing) {
                if (size.width !== undefined && n.sizing.h === 'hug') n.sizing.h = 'fixed';
                if (size.height !== undefined && n.sizing.v === 'hug') n.sizing.v = 'fixed';
            }
            if (n.type === 'frame' || n.type === 'component') {
                applyConstraints(n as FrameNode, oldW, oldH, ctx);
            }
        },
        live,
    );
}

// ---------------------------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------------------------

function slug(name: string): string {
    return (
        name
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/[\s_]+/g, '-') || 'page'
    );
}

export function addPage(name = 'Untitled'): void {
    const s = editor();
    if (!s.project) return;
    const taken = new Set([...s.project.pages.map((p) => p.file), ...Object.keys(s.project.other)]);
    const base = `pages/${slug(name)}`;
    let file = `${base}.svg`;
    for (let i = 2; taken.has(file); i++) file = `${base}-${i}.svg`;
    const page: Page = { file, name, children: [], extra: {}, extraChildren: [] };
    s.update((d) => {
        d.pages.push(page);
    });
    s.openDoc({ kind: 'page', file });
}

export function renamePage(file: string, name: string): void {
    editor().update((d) => {
        const p = d.pages.find((x) => x.file === file);
        if (p) p.name = name;
    });
}

export function deletePage(file: string): void {
    const s = editor();
    if (!s.project || s.project.pages.length <= 1) return;
    const index = s.project.pages.findIndex((p) => p.file === file);
    s.update((d) => {
        d.pages.splice(index, 1);
    });
    if (s.doc?.file === file) {
        const next = editor().project!.pages[Math.max(0, index - 1)]!;
        editor().openDoc({ kind: 'page', file: next.file });
    }
}
