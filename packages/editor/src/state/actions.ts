/**
 * Editing operations shared by keyboard shortcuts, the canvas, menus and panels. Each goes through
 * `update`, so each is one undo step.
 */
import {
    type AnyNode,
    ID_PREFIX,
    type Project,
    type SceneNode,
    type XmlElement,
    OVD_NS,
    SVG_NS,
    childrenOf,
    collectIds,
    createFrame,
    createGroup,
    el,
    findNode,
    locate,
    newId,
    parseXml,
    readNode,
    readPage,
    serializeXml,
    writeNode,
} from '@workspace/ovd-core';
import { type Draft, current, isDraft } from 'immer';
import { docRoots } from '../lib/doc';
import { absOrigin, absRect, unionRects } from '../lib/geometry';
import { fitRect, viewportCenter, zoomAround, canvasSize } from '../lib/viewport';
import { DEFAULT_VIEWPORT, editor } from './store';

type Roots = AnyNode[];

const rootsOf = (d: Draft<Project>) => docRoots(d as Project, editor().doc) as Roots;

function idPrefix(n: SceneNode): string {
    if (n.type === 'shape') return ID_PREFIX[n.kind] ?? 's';
    return ID_PREFIX[n.type] ?? 'n';
}

/** A deep copy with fresh ids for the node and every descendant (spec §4: unique within the file). */
export function cloneWithNewIds(node: SceneNode, taken: Set<string>): SceneNode {
    // Drafts are Proxies, which structuredClone rejects (DataCloneError).
    const copy = structuredClone(isDraft(node) ? current(node) : node);
    const visit = (n: SceneNode) => {
        n.id = newId(idPrefix(n), taken);
        const kids = childrenOf(n);
        if (kids) kids.forEach(visit);
    };
    visit(copy);
    return copy;
}

/** Top-level-most selected nodes (a selected child of a selected parent is dropped). */
function selectedRoots(roots: Roots, selection: string[]): string[] {
    const sel = new Set(selection);
    return selection.filter((id) => {
        const loc = locate(roots, id);
        if (!loc) return false;
        let parent = loc.parent;
        while (parent) {
            if (sel.has(parent.id)) return false;
            parent = locate(roots, parent.id)?.parent ?? null;
        }
        return true;
    });
}

function isComponentDoc(): boolean {
    return editor().doc?.kind === 'component';
}

// ---------------------------------------------------------------------------------------------
// Basic edits
// ---------------------------------------------------------------------------------------------

export function deleteSelection(): void {
    const { selection } = editor();
    if (!selection.length) return;
    editor().update((d) => {
        const roots = rootsOf(d);
        for (const id of selection) {
            const loc = locate(roots, id);
            // Variants of a component are removed from the assets panel, not with Delete.
            if (!loc || loc.list[loc.index]!.type === 'component') continue;
            loc.list.splice(loc.index, 1);
        }
    });
    editor().select([]);
}

export function nudge(dx: number, dy: number): void {
    const { selection } = editor();
    if (!selection.length) return;
    editor().update((d) => {
        const roots = rootsOf(d);
        for (const id of selectedRoots(roots, selection)) {
            const n = findNode(roots, id);
            if (!n || n.locked || n.type === 'component') continue;
            n.x += dx;
            n.y += dy;
        }
    });
}

export function duplicateSelection(offset = 16): void {
    const { selection, project } = editor();
    if (!selection.length || !project) return;
    const created: string[] = [];
    editor().update((d) => {
        const roots = rootsOf(d);
        const taken = collectIds(roots);
        for (const id of selectedRoots(roots, selection)) {
            const loc = locate(roots, id);
            if (!loc) continue;
            const src = loc.list[loc.index]!;
            if (src.type === 'component') continue;
            const copy = cloneWithNewIds(src as SceneNode, taken);
            copy.x += offset;
            copy.y += offset;
            copy.name = src.name;
            loc.list.splice(loc.index + 1, 0, copy);
            created.push(copy.id);
        }
    });
    editor().select(created);
}

export function selectAll(): void {
    const { project, doc } = editor();
    if (!project) return;
    const roots = docRoots(project, doc);
    // Inside a single selected frame, select its children; otherwise every top-level layer.
    const sel = editor().selection;
    if (sel.length === 1) {
        const loc = locate(roots, sel[0]!);
        if (loc?.parent) {
            const kids = childrenOf(loc.parent) ?? [];
            editor().select(kids.filter((k) => !k.locked && !k.hidden).map((k) => k.id));
            return;
        }
    }
    editor().select(roots.filter((n) => !n.locked && !n.hidden).map((n) => n.id));
}

export function setHidden(ids: string[], hidden?: boolean): void {
    editor().update((d) => {
        const roots = rootsOf(d);
        const nodes = ids.map((id) => findNode(roots, id)).filter(Boolean) as AnyNode[];
        const value = hidden ?? !nodes.every((n) => n.hidden);
        for (const n of nodes) n.hidden = value;
    });
}

export function setLocked(ids: string[], locked?: boolean): void {
    editor().update((d) => {
        const roots = rootsOf(d);
        const nodes = ids.map((id) => findNode(roots, id)).filter(Boolean) as AnyNode[];
        const value = locked ?? !nodes.every((n) => n.locked);
        for (const n of nodes) n.locked = value;
    });
    if (locked ?? true) editor().select(editor().selection.filter((id) => !ids.includes(id)));
}

export function rename(id: string, name: string): void {
    editor().update((d) => {
        const n = findNode(rootsOf(d), id);
        if (n) n.name = name;
    });
}

// ---------------------------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------------------------

/** Moves nodes in document order (spec §4: layer order is document order; later = in front). */
export function reorder(where: 'forward' | 'backward' | 'front' | 'back'): void {
    const { selection } = editor();
    if (!selection.length) return;
    editor().update((d) => {
        const roots = rootsOf(d);
        const ids = selectedRoots(roots, selection);
        const ordered = where === 'forward' || where === 'front' ? [...ids].reverse() : ids;
        for (const id of ordered) {
            const loc = locate(roots, id);
            if (!loc) continue;
            const [node] = loc.list.splice(loc.index, 1);
            let to = loc.index;
            if (where === 'forward') to = Math.min(loc.list.length, loc.index + 1);
            if (where === 'backward') to = Math.max(0, loc.index - 1);
            if (where === 'front') to = loc.list.length;
            if (where === 'back') to = 0;
            loc.list.splice(to, 0, node!);
        }
    });
}

/** Moves a node to a new parent / index, keeping it visually in place. */
export function moveNode(id: string, parentId: string | null, index: number): void {
    editor().update((d) => {
        const roots = rootsOf(d);
        const loc = locate(roots, id);
        if (!loc || (parentId && (parentId === id || isDescendant(roots, id, parentId)))) return;
        const before = absOrigin(roots, id);
        const target = parentId ? findNode(roots, parentId) : null;
        const list = target ? childrenOf(target) : (roots as SceneNode[]);
        if (!list) return;
        const [node] = loc.list.splice(loc.index, 1);
        const after = parentId ? absOrigin(roots, parentId) : { x: 0, y: 0 };
        const parentOffset = target ? { x: target.x, y: target.y } : { x: 0, y: 0 };
        node!.x += before.x - after.x - parentOffset.x;
        node!.y += before.y - after.y - parentOffset.y;
        const at = list === loc.list && loc.index < index ? index - 1 : index;
        list.splice(Math.max(0, Math.min(list.length, at)), 0, node as SceneNode);
    });
}

function isDescendant(roots: Roots, ancestorId: string, id: string): boolean {
    const a = findNode(roots, ancestorId);
    if (!a) return false;
    const kids = childrenOf(a);
    return !!kids && !!findNode(kids, id);
}

function wrapSelection(make: (id: string) => SceneNode & { children: SceneNode[] }): void {
    const { selection } = editor();
    if (
        !selection.length ||
        (isComponentDoc() &&
            selection.some((id) =>
                docRoots(editor().project!, editor().doc).some((r) => r.id === id),
            ))
    )
        return;
    let createdId = '';
    editor().update((d) => {
        const roots = rootsOf(d);
        const ids = selectedRoots(roots, selection);
        const first = locate(roots, ids[0]!);
        if (!first) return;
        // Wrap only siblings of the first selected node, in document order.
        const siblings = ids
            .map((id) => ({ id, loc: locate(roots, id)! }))
            .filter((s) => s.loc && s.loc.list === first.list)
            .sort((a, b) => a.loc.index - b.loc.index);
        const nodes = siblings.map((s) => s.loc.list[s.loc.index] as SceneNode);
        const box = unionRects(
            nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
        )!;
        const wrapper = make(newId('w', collectIds(roots)));
        createdId = wrapper.id;
        wrapper.x = box.x;
        wrapper.y = box.y;
        wrapper.width = box.width;
        wrapper.height = box.height;
        const insertAt = siblings[siblings.length - 1]!.loc.index;
        for (const n of nodes) {
            n.x -= box.x;
            n.y -= box.y;
            wrapper.children.push(n);
        }
        for (const s of [...siblings].reverse()) first.list.splice(s.loc.index, 1);
        first.list.splice(insertAt - siblings.length + 1, 0, wrapper);
    });
    if (createdId) editor().select([createdId]);
}

export function groupSelection(): void {
    wrapSelection((id) => createGroup(id.replace(/^w_/, 'g_')));
}

export function frameSelection(): void {
    wrapSelection((id) => createFrame(id.replace(/^w_/, 'f_'), { fill: undefined, clip: false }));
}

export function ungroupSelection(): void {
    const { selection } = editor();
    const released: string[] = [];
    editor().update((d) => {
        const roots = rootsOf(d);
        for (const id of selection) {
            const loc = locate(roots, id);
            const node = loc?.list[loc.index];
            if (!loc || !node || (node.type !== 'group' && node.type !== 'frame')) continue;
            const kids = node.children;
            for (const k of kids) {
                k.x += node.x;
                k.y += node.y;
                released.push(k.id);
            }
            loc.list.splice(loc.index, 1, ...kids);
        }
    });
    if (released.length) editor().select(released);
}

// ---------------------------------------------------------------------------------------------
// Clipboard — the payload is OVD/SVG text, so it pastes into other tools as real SVG
// ---------------------------------------------------------------------------------------------

export function selectionAsSvg(): string | null {
    const { project, doc, selection } = editor();
    if (!project || !selection.length) return null;
    const roots = docRoots(project, doc);
    const ids = selectedRoots(roots, selection);
    const nodes: XmlElement[] = [];
    for (const id of ids) {
        const n = findNode(roots, id);
        if (!n || n.type === 'component') continue;
        // Copy at document position so a paste into another file lands in the same place.
        const o = absOrigin(roots, id);
        nodes.push(writeNode({ ...n, x: n.x + o.x, y: n.y + o.y } as SceneNode));
    }
    if (!nodes.length) return null;
    return serializeXml(
        el('svg', { xmlns: SVG_NS, 'xmlns:ovd': OVD_NS, 'ovd:type': 'clipboard' }, nodes),
    );
}

function parseClipboard(text: string): SceneNode[] {
    const t = text.trim();
    if (!t.startsWith('<')) return [];
    try {
        const root = parseXml(t);
        if (root.name === 'svg') return readPage('clipboard.svg', root).children;
        const n = readNode(root);
        return n ? [n] : [];
    } catch {
        return [];
    }
}

export function pasteSvg(text: string): boolean {
    const nodes = parseClipboard(text);
    if (!nodes.length) return false;
    insertNodes(nodes, { keepPosition: true });
    return true;
}

/**
 * Inserts nodes (ids refreshed) into the selected frame, or at top level. With `keepPosition`
 * false they are centred in the viewport.
 */
export function insertNodes(
    nodes: SceneNode[],
    opts: { keepPosition?: boolean; history?: boolean } = {},
): void {
    const { project, doc, selection } = editor();
    if (!project || !doc) return;
    const created: string[] = [];
    editor().update(
        (d) => {
            const roots = rootsOf(d);
            const taken = collectIds(roots);
            // Paste into the selected container (frame, group or component variant), like Figma.
            let parent: AnyNode | null = null;
            if (selection.length === 1) {
                const s = findNode(roots, selection[0]!);
                if (s && (s.type === 'frame' || s.type === 'group' || s.type === 'component'))
                    parent = s;
                else if (s) parent = locate(roots, s.id)?.parent ?? null;
            }
            if (!parent && doc.kind === 'component') parent = roots[0] ?? null;
            const list = parent ? childrenOf(parent)! : (roots as SceneNode[]);
            const origin = parent ? absOrigin(roots, parent.id) : { x: 0, y: 0 };
            const px = parent ? parent.x + origin.x : 0;
            const py = parent ? parent.y + origin.y : 0;
            const box = unionRects(
                nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
            )!;
            const center = viewportCenter(editor().viewports[doc.file] ?? DEFAULT_VIEWPORT);
            const dx = opts.keepPosition ? 0 : center.x - (box.x + box.width / 2);
            const dy = opts.keepPosition ? 0 : center.y - (box.y + box.height / 2);
            for (const n of nodes) {
                const copy = cloneWithNewIds(n, taken);
                copy.x += dx - px;
                copy.y += dy - py;
                list.push(copy);
                created.push(copy.id);
            }
        },
        { history: opts.history ?? true },
    );
    editor().select(created);
}

// ---------------------------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------------------------

export function zoomBy(factor: number): void {
    const { doc, viewports, setViewport } = editor();
    if (!doc) return;
    const vp = viewports[doc.file] ?? DEFAULT_VIEWPORT;
    setViewport(
        zoomAround(vp, vp.zoom * factor, { x: canvasSize.width / 2, y: canvasSize.height / 2 }),
    );
}

export function zoomTo(zoom: number): void {
    const { doc, viewports, setViewport } = editor();
    if (!doc) return;
    const vp = viewports[doc.file] ?? DEFAULT_VIEWPORT;
    setViewport(zoomAround(vp, zoom, { x: canvasSize.width / 2, y: canvasSize.height / 2 }));
}

export function zoomToFit(): void {
    const { project, doc, setViewport } = editor();
    if (!project || !doc) return;
    const roots = docRoots(project, doc);
    const box = unionRects(roots.map((r) => absRect(roots, r.id)!).filter(Boolean));
    if (box) setViewport(fitRect(box, 64, 1));
}

export function zoomToSelection(): void {
    const { project, doc, selection, setViewport } = editor();
    if (!project || !doc || !selection.length) return zoomToFit();
    const roots = docRoots(project, doc);
    const box = unionRects(selection.map((id) => absRect(roots, id)!).filter(Boolean));
    if (box) setViewport(fitRect(box, 96, 4));
}
