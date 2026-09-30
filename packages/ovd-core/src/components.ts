/** Component and variant resolution for instances (spec §5). */
import {
    type ComponentFile,
    type ComponentNode,
    type ComponentSet,
    type InstanceNode,
    type Override,
    type Project,
    type SceneNode,
    childrenOf,
    formatVariant,
    parseVariant,
} from './model';
import { type LayoutContext, applyConstraints, layoutNode } from './layout';
import { relativePath, resolveRelative } from './paths';
import { approxMeasure, relayoutText } from './text';

export interface HrefParts {
    /** Library name for `lib:path#id` references. */
    library?: string;
    /** Project-relative file, or undefined for a same-file reference. */
    file?: string;
    id: string;
}

/** Resolution order (spec §5): same file, relative path, then a manifest library. */
export function parseHref(fromFile: string, href: string): HrefParts {
    const hash = href.indexOf('#');
    const id = hash < 0 ? '' : href.slice(hash + 1);
    const path = hash < 0 ? href : href.slice(0, hash);
    if (!path) return { id };
    const lib = /^([\w-]+):(?!\/\/)(.+)$/.exec(path);
    if (lib) return { library: lib[1], file: lib[2], id };
    return { file: resolveRelative(fromFile, path), id };
}

export function hrefFor(fromFile: string, toFile: string, id: string): string {
    return fromFile === toFile ? `#${id}` : `${relativePath(fromFile, toFile)}#${id}`;
}

export interface ResolvedComponent {
    file: ComponentFile;
    set: ComponentSet;
    variant: ComponentNode;
}

/** `name:path` — a library-qualified file (spec §5 resolution order, last step). */
const LIB = /^([\w-]+):(?!\/\/)(.+)$/;

type Found = { file: ComponentFile; set: ComponentSet; direct?: ComponentNode };

/** A library's component file renamed `name:file`, so references made from inside it stay in it. */
const qualify = (hit: Found, library: string): Found => ({
    ...hit,
    file: { ...hit.file, file: `${library}:${hit.file.file}` },
});

export function findComponent(project: Project, fromFile: string, href: string): Found | undefined {
    // Inside a library component: resolve in that library.
    const scoped = LIB.exec(fromFile);
    if (scoped) {
        const lib = project.libraries?.[scoped[1]!];
        const hit = lib && findComponent(lib, scoped[2]!, href);
        return hit ? qualify(hit, scoped[1]!) : undefined;
    }
    const parts = parseHref(fromFile, href);
    if (parts.library) {
        // `core-ui:button.svg#c_button` — the path is the library's, with components/ implied.
        const lib = project.libraries?.[parts.library];
        if (!lib || !parts.file) return undefined;
        for (const file of [parts.file, `components/${parts.file}`]) {
            const hit = findComponent(lib, file, `#${parts.id}`);
            if (hit) return qualify(hit, parts.library);
        }
        return undefined;
    }
    const target = parts.file ?? fromFile;
    const file = project.components.find((c) => c.file === target);
    if (!file) return undefined;
    for (const set of file.sets) {
        if (set.id === parts.id) return { file, set };
        const direct = set.variants.find((v) => v.id === parts.id);
        if (direct) return { file, set, direct };
    }
    return undefined;
}

/** An asset referenced from `fromFile` — the project's, or a library's for library components. */
export function assetOf(project: Project, fromFile: string, href: string): Uint8Array | undefined {
    const scoped = LIB.exec(fromFile);
    if (scoped) {
        const lib = project.libraries?.[scoped[1]!];
        return lib ? assetOf(lib, scoped[2]!, href) : undefined;
    }
    return project.assets[resolveRelative(fromFile, href)];
}

/** The variant props an instance ends up with: the set default, then the href's own variant,
 *  then the instance's `ovd:variant`. A bare value (`ovd:variant="primary"`, as in the spec §4
 *  example) applies to the first enum axis. */
export function effectiveVariant(
    set: ComponentSet,
    direct: ComponentNode | undefined,
    variant?: string,
) {
    const props: Record<string, string> = { ...parseVariant(set.defaultVariant) };
    Object.assign(props, parseVariant(direct?.variant));
    if (variant) {
        if (variant.includes('=')) Object.assign(props, parseVariant(variant));
        else {
            const firstAxis = Object.entries(set.props).find(([, def]) => Array.isArray(def))?.[0];
            if (firstAxis) props[firstAxis] = variant;
        }
    }
    return props;
}

export function pickVariant(set: ComponentSet, props: Record<string, string>): ComponentNode {
    const scored = set.variants.map((v) => {
        const vp = parseVariant(v.variant);
        let score = 0;
        for (const [k, val] of Object.entries(props)) if (vp[k] === val) score++;
        return { v, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0]!.v;
}

export function resolveInstance(
    project: Project,
    fromFile: string,
    node: Pick<InstanceNode, 'href' | 'variant'>,
): ResolvedComponent | undefined {
    const hit = findComponent(project, fromFile, node.href);
    if (!hit || hit.set.variants.length === 0) return undefined;
    const props = effectiveVariant(hit.set, hit.direct, node.variant);
    const variant = hit.set.isSet ? pickVariant(hit.set, props) : hit.set.variants[0]!;
    return { file: hit.file, set: hit.set, variant };
}

export { formatVariant };

// ---------------------------------------------------------------------------------------------
// Instance content — what an instance actually shows (canvas and flattened export share this)
// ---------------------------------------------------------------------------------------------

export interface InstanceContent extends ResolvedComponent {
    /** A private copy of the variant with overrides applied, laid out at the instance's size. */
    root: ComponentNode;
}

function applyOverrides(root: ComponentNode, overrides: Override[], ctx: LayoutContext): void {
    if (!overrides.length) return;
    const byId = new Map(overrides.map((o) => [o.target, o]));
    const visit = (nodes: SceneNode[]) => {
        for (const n of nodes) {
            const o = byId.get(n.id);
            if (o) {
                if (o.hidden !== undefined) n.hidden = o.hidden;
                if (o.fill && 'fill' in n) {
                    n.fill = {
                        color: o.fill.color || n.fill?.color || '#000000',
                        token: o.fill.token,
                    };
                }
                if (o.stroke && 'stroke' in n) {
                    const base = n.stroke ?? { paint: { color: '#000000' }, width: 1 };
                    n.stroke = {
                        ...base,
                        paint: { color: o.stroke.color || base.paint.color, token: o.stroke.token },
                    };
                }
                if (o.text !== undefined && n.type === 'text') {
                    n.content = o.text;
                    relayoutText(n, ctx.measure ?? approxMeasure);
                }
                if (o.swap !== undefined && n.type === 'instance') n.href = o.swap;
            }
            const kids = childrenOf(n);
            if (kids) visit(kids);
        }
    };
    visit(root.children);
}

/**
 * Resolves an instance to its content: the chosen variant, overrides applied (spec §5), laid out
 * at the instance's size — so a 160px button placed 342px wide centres its label instead of
 * stretching it. Returns undefined when the component cannot be found.
 */
export function instanceContent(
    project: Project,
    fromFile: string,
    inst: Pick<InstanceNode, 'href' | 'variant' | 'overrides' | 'width' | 'height'>,
    ctx: LayoutContext = {},
): InstanceContent | undefined {
    const resolved = resolveInstance(project, fromFile, inst);
    if (!resolved) return undefined;
    const root = structuredClone(resolved.variant);
    applyOverrides(root, inst.overrides, ctx);
    const oldW = root.width;
    const oldH = root.height;
    root.width = inst.width || oldW;
    root.height = inst.height || oldH;
    if (root.layout.mode === 'flex') layoutNode(root, ctx);
    else applyConstraints(root, oldW, oldH, ctx);
    return { ...resolved, root };
}
