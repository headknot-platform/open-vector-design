/** Component commands (spec §5): create, insert, override, detach, variants. */
import {
    type ComponentFile,
    type ComponentNode,
    type ComponentSet,
    type FrameNode,
    type InstanceNode,
    type Override,
    type SceneNode,
    collectIds,
    createInstance,
    findNode,
    formatVariant,
    hrefFor,
    instanceContent,
    locate,
    newId,
    parseVariant,
} from '@workspace/ovd-core';
import { current, type Draft, isDraft } from 'immer';
import { docRoots, findComponentFile } from '../lib/doc';
import { canvasMeasure } from '../lib/measure';
import type { Point } from '../lib/geometry';
import { viewportCenter } from '../lib/viewport';
import { cloneWithNewIds, frameSelection } from './actions';
import { DEFAULT_VIEWPORT, editor, tokenSetFor } from './store';

function slug(name: string): string {
    return (
        name
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/[\s_/]+/g, '-') || 'component'
    );
}

function plain<T>(v: T): T {
    return structuredClone(isDraft(v) ? current(v) : v);
}

// ---------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------

/** ⌥⌘K — the selected frame (or the selection wrapped in one) becomes a component in its own
 *  file under components/, and is replaced by an instance of it. */
export function createComponentFromSelection(): void {
    const s = editor();
    if (!s.project || !s.doc || s.doc.kind !== 'page' || !s.selection.length) return;
    const roots = docRoots(s.project, s.doc);
    const single = s.selection.length === 1 ? findNode(roots, s.selection[0]!) : undefined;
    if (!single || single.type !== 'frame') frameSelection();
    const id = editor().selection[0];
    const page = editor().doc!.file;
    if (!id) return;
    let instanceId = '';
    editor().update((d) => {
        const rs = docRoots(d, editor().doc);
        const loc = locate(rs, id);
        const frame = loc?.list[loc.index];
        if (!loc || !frame || frame.type !== 'frame') return;
        const name = frame.name === 'Frame' ? 'Component' : frame.name;
        const taken = new Set([...d.components.map((c) => c.file), ...Object.keys(d.other)]);
        let file = `components/${slug(name)}.svg`;
        for (let i = 2; taken.has(file); i++) file = `components/${slug(name)}-${i}.svg`;
        const symbolId = `c_${file.slice('components/'.length, -'.svg'.length).replace(/-/g, '_')}`;
        const src = plain(frame) as FrameNode;
        const variant: ComponentNode = {
            ...src,
            type: 'component',
            id: symbolId,
            name,
            x: 0,
            y: 0,
            rotation: 0,
            link: undefined,
        };
        const set: ComponentSet = {
            id: symbolId,
            name,
            isSet: false,
            props: {},
            variants: [variant],
            extra: {},
        };
        const componentFile: ComponentFile = {
            file,
            name,
            sets: [set],
            extra: {},
            extraChildren: [],
        };
        d.components.push(componentFile);
        const inst = createInstance(newId('i', collectIds(rs)), hrefFor(page, file, symbolId), {
            name,
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            rotation: frame.rotation,
            sizing: frame.sizing,
            constraints: frame.constraints,
            position: frame.position,
            link: frame.link,
        });
        instanceId = inst.id;
        loc.list.splice(loc.index, 1, inst);
    });
    if (instanceId) editor().select([instanceId]);
}

/** Places an instance of a component (at a point, or the viewport centre). */
export function insertInstance(file: string, setId: string, at?: Point): void {
    const s = editor();
    if (!s.project || !s.doc) return;
    const comp = findComponentFile(s.project, file);
    const set = comp?.sets.find((x) => x.id === setId);
    const v = set?.variants[0];
    if (!set || !v) return;
    if (s.doc.kind === 'component' && s.doc.file === file) return; // no self-reference
    const p = at ?? viewportCenter(s.viewports[s.doc.file] ?? DEFAULT_VIEWPORT);
    let id = '';
    s.update((d) => {
        const rs = docRoots(d, s.doc);
        // A library component is referenced as `name:components/file.svg#id` (spec §5).
        const href = /^[\w-]+:(?!\/\/)/.test(file)
            ? `${file}#${setId}`
            : hrefFor(s.doc!.file, file, setId);
        const inst = createInstance(newId('i', collectIds(rs)), href, {
            name: set.name,
            x: Math.round(p.x - v.width / 2),
            y: Math.round(p.y - v.height / 2),
            width: v.width,
            height: v.height,
        });
        id = inst.id;
        const target = s.doc!.kind === 'component' ? (rs[0] as ComponentNode) : null;
        if (target) target.children.push(inst);
        else (rs as SceneNode[]).push(inst);
    });
    editor().select([id]);
}

// ---------------------------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------------------------

function withInstance(id: string, fn: (n: Draft<InstanceNode>) => void) {
    editor().update((d) => {
        const n = findNode(docRoots(d, editor().doc), id);
        if (n?.type === 'instance') fn(n as Draft<InstanceNode>);
    });
}

export function setInstanceVariant(id: string, axis: string, value: string): void {
    withInstance(id, (n) => {
        const s = editor();
        const content = instanceContent(s.project!, s.doc!.file, n as InstanceNode);
        const props = { ...parseVariant(content?.variant.variant), ...parseVariant(n.variant) };
        props[axis] = value;
        n.variant = formatVariant(props);
        // A variant with a different natural size takes that size, like Figma's instance swap.
        const next =
            content &&
            instanceContent(s.project!, s.doc!.file, {
                ...(n as InstanceNode),
                variant: n.variant,
            });
        if (content && next && next.variant.id !== content.variant.id) {
            if (n.width === content.variant.width) n.width = next.variant.width;
            if (n.height === content.variant.height) n.height = next.variant.height;
        }
    });
}

/** Sets (or clears, with `undefined` values) override fields on one target layer. */
export function setOverride(
    id: string,
    target: string,
    patch: Partial<Omit<Override, 'target' | 'extra'>>,
): void {
    withInstance(id, (n) => {
        let o = n.overrides.find((x) => x.target === target);
        if (!o) {
            o = { target, extra: {} };
            n.overrides.push(o);
        }
        Object.assign(o, patch);
        for (const k of Object.keys(patch) as (keyof typeof patch)[])
            if (patch[k] === undefined) delete o[k];
        if (
            Object.keys(o).every((k) => k === 'target' || k === 'extra') &&
            !Object.keys(o.extra).length
        ) {
            n.overrides.splice(n.overrides.indexOf(o), 1);
        }
    });
}

export function resetOverrides(id: string): void {
    withInstance(id, (n) => {
        n.overrides = [];
    });
}

/** Replaces an instance with an editable copy of what it shows (spec §5: records ovd:detached-from). */
export function detachInstance(id: string): void {
    const s = editor();
    if (!s.project || !s.doc) return;
    const roots = docRoots(s.project, s.doc);
    const inst = findNode(roots, id);
    if (inst?.type !== 'instance') return;
    const content = instanceContent(s.project, s.doc.file, inst, {
        tokens: tokenSetFor(s.project, s.previewTheme),
        measure: canvasMeasure,
    });
    if (!content) return;
    let frameId = '';
    s.update((d) => {
        const rs = docRoots(d, s.doc);
        const loc = locate(rs, id);
        if (!loc) return;
        const taken = collectIds(rs);
        const root = content.root;
        const frame: FrameNode = {
            ...root,
            type: 'frame',
            id: newId('f', taken),
            name: inst.name,
            x: inst.x,
            y: inst.y,
            rotation: inst.rotation,
            sizing: inst.sizing,
            constraints: inst.constraints,
            position: inst.position,
            link: inst.link,
            extra: { ...root.extra, 'ovd:detached-from': inst.href },
            children: root.children.map((c) => cloneWithNewIds(c, taken)),
        };
        // A frame has no variant; drop the one copied from the component root.
        delete (frame as { variant?: string }).variant;
        frameId = frame.id;
        loc.list.splice(loc.index, 1, frame);
    });
    if (frameId) editor().select([frameId]);
}

// ---------------------------------------------------------------------------------------------
// Variants (editing a component file)
// ---------------------------------------------------------------------------------------------

function setOf(file: Draft<ComponentFile>, variantId: string) {
    return file.sets.find((st) => st.variants.some((v) => v.id === variantId));
}

/** Adds a variant after `variantId`. A standalone component becomes a set with a `variant` axis. */
export function addVariant(variantId: string): void {
    const s = editor();
    if (!s.doc || s.doc.kind !== 'component') return;
    let createdId = '';
    s.update((d) => {
        const file = findComponentFile(d, s.doc!.file);
        if (!file) return;
        const set = setOf(file, variantId);
        const src = set?.variants.find((v) => v.id === variantId);
        if (!set || !src) return;
        const taken = new Set(file.sets.flatMap((st) => [st.id, ...st.variants.map((v) => v.id)]));
        if (!set.isSet) {
            // The existing symbol keeps its id (instances point at it); the set gets a new one.
            set.isSet = true;
            set.id = taken.has(`${src.id}_set`) ? newId(`${src.id}_set`, taken) : `${src.id}_set`;
            set.props = { variant: ['default'] };
            set.defaultVariant = 'variant=default';
            src.variant = 'variant=default';
            src.name = 'Default';
        }
        const axes = Object.entries(set.props).filter(([, def]) => Array.isArray(def)) as [
            string,
            string[],
        ][];
        const [axis, values] = axes[0] ?? ['variant', []];
        const n = values.length + 1;
        const value = `variant${n}`;
        set.props[axis] = [...values, value];
        const copy = plain(src) as ComponentNode;
        copy.id = newId(`${set.id.replace(/_set.*$/, '')}_`, taken);
        taken.add(copy.id);
        copy.name = value;
        copy.variant = formatVariant({ ...parseVariant(src.variant), [axis]: value });
        copy.x = src.x + src.width + 48;
        set.variants.splice(set.variants.indexOf(src) + 1, 0, copy);
        createdId = copy.id;
    });
    if (createdId) editor().select([createdId]);
}

/** Renames one axis value of a variant, keeping the set's prop list in step. */
export function setVariantValue(variantId: string, axis: string, value: string): void {
    const s = editor();
    if (!s.doc || s.doc.kind !== 'component' || !value.trim()) return;
    s.update((d) => {
        const file = findComponentFile(d, s.doc!.file);
        const set = file && setOf(file, variantId);
        const v = set?.variants.find((x) => x.id === variantId);
        if (!set || !v) return;
        const props = parseVariant(v.variant);
        const old = props[axis];
        props[axis] = value.trim();
        v.variant = formatVariant(props);
        const def = set.props[axis];
        const used = new Set(
            set.variants.map((x) => parseVariant(x.variant)[axis]).filter(Boolean) as string[],
        );
        if (Array.isArray(def))
            set.props[axis] = [
                ...def.filter((x) => x !== old || used.has(x)),
                ...(def.includes(value.trim()) ? [] : [value.trim()]),
            ];
    });
}

/** Marks a text layer inside a component as a `text` prop (spec §5 typed props). */
export function exposeTextProp(variantId: string, layerId: string, prop: string): void {
    const s = editor();
    if (!s.doc || s.doc.kind !== 'component') return;
    s.update((d) => {
        const file = findComponentFile(d, s.doc!.file);
        const set = file && setOf(file, variantId);
        if (!set) return;
        // The same layer id carries the prop in every variant.
        for (const v of set.variants) {
            const layer = findNode(v.children, layerId);
            if (layer) layer.prop = prop;
        }
        set.props[prop] = 'text';
    });
}
