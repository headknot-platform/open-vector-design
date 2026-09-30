/** Auto layout commands (spec §6). */
import {
    type AnyNode,
    type FrameNode,
    type Layout,
    type SceneNode,
    findNode,
    locate,
} from '@workspace/ovd-core';
import type { Draft } from 'immer';
import { docRoots } from '../lib/doc';
import { frameSelection } from './actions';
import { editor } from './store';

type Flexible = Draft<FrameNode> | Draft<Extract<AnyNode, { type: 'component' }>>;

/** Direction, gap and padding that reproduce the children's current arrangement, like Figma. */
export function inferLayout(
    frame: Pick<FrameNode, 'width' | 'height' | 'children'>,
): Partial<Layout> {
    const kids = frame.children.filter((k) => !k.hidden && k.type !== 'raw');
    if (!kids.length) {
        const p = { value: 16 };
        return { direction: 'column', gap: { value: 8 }, padding: [p, p, p, p] };
    }
    const xs = kids.map((k) => k.x);
    const ys = kids.map((k) => k.y);
    const spreadX = Math.max(...xs) - Math.min(...xs);
    const spreadY = Math.max(...ys) - Math.min(...ys);
    const direction = spreadX > spreadY ? 'row' : 'column';
    const sorted = [...kids].sort((a, b) => (direction === 'row' ? a.x - b.x : a.y - b.y));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!;
        const cur = sorted[i]!;
        gaps.push(
            direction === 'row' ? cur.x - (prev.x + prev.width) : cur.y - (prev.y + prev.height),
        );
    }
    const gap = gaps.length
        ? Math.max(0, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length))
        : 0;
    const left = Math.max(0, Math.round(Math.min(...xs)));
    const top = Math.max(0, Math.round(Math.min(...ys)));
    const right = Math.max(
        0,
        Math.round(frame.width - Math.max(...kids.map((k) => k.x + k.width))),
    );
    const bottom = Math.max(
        0,
        Math.round(frame.height - Math.max(...kids.map((k) => k.y + k.height))),
    );
    return {
        direction,
        gap: { value: gap },
        padding: [{ value: top }, { value: right }, { value: bottom }, { value: left }],
    };
}

function ordered(frame: Flexible, direction: 'row' | 'column') {
    // Flow order follows position, so switching to flex keeps the visual order.
    const key = (n: SceneNode) => (direction === 'row' ? n.x : n.y);
    frame.children.sort((a, b) => key(a as SceneNode) - key(b as SceneNode));
}

/** ⇧A — add auto layout to the selected frame, or wrap the selection in a new flex frame. */
export function addAutoLayout(): void {
    const s = editor();
    if (!s.project || !s.selection.length) return;
    const roots = docRoots(s.project, s.doc);
    const single = s.selection.length === 1 ? findNode(roots, s.selection[0]!) : undefined;
    if (!single || (single.type !== 'frame' && single.type !== 'component')) {
        frameSelection();
    }
    const id = editor().selection[0];
    if (!id) return;
    editor().update((d) => {
        const n = findNode(docRoots(d, editor().doc), id) as Flexible | undefined;
        if (!n || (n.type !== 'frame' && n.type !== 'component')) return;
        if (n.layout.mode === 'flex') return;
        const inferred = inferLayout(n as FrameNode);
        ordered(n, inferred.direction ?? 'column');
        Object.assign(n.layout, inferred, { mode: 'flex', align: 'start', justify: 'start' });
        n.sizing = { h: 'hug', v: 'hug' };
    });
}

export function removeAutoLayout(ids: string[]): void {
    editor().update((d) => {
        const roots = docRoots(d, editor().doc);
        for (const id of ids) {
            const n = findNode(roots, id) as Flexible | undefined;
            if (n && (n.type === 'frame' || n.type === 'component')) {
                n.layout.mode = 'none';
                // Hug has no meaning without a layout.
                if (n.sizing) n.sizing = { h: 'fixed', v: 'fixed' };
            }
        }
    });
}

/** The flex parent shared by all ids, if there is one. */
export function flexParentOf(roots: AnyNode[], ids: string[]): FrameNode | null {
    let parent: AnyNode | null | undefined;
    for (const id of ids) {
        const p = locate(roots, id)?.parent ?? null;
        if (parent === undefined) parent = p;
        else if (parent !== p) return null;
    }
    if (!parent || (parent.type !== 'frame' && parent.type !== 'component')) return null;
    return parent.layout.mode === 'flex' ? (parent as FrameNode) : null;
}
