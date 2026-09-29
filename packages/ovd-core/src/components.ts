/** Component and variant resolution for instances (spec §5). */
import {
    type ComponentFile,
    type ComponentNode,
    type ComponentSet,
    type InstanceNode,
    type Project,
    formatVariant,
    parseVariant,
} from './model';
import { relativePath, resolveRelative } from './paths';

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

export function findComponent(
    project: Project,
    fromFile: string,
    href: string,
): { file: ComponentFile; set: ComponentSet; direct?: ComponentNode } | undefined {
    const parts = parseHref(fromFile, href);
    if (parts.library) return undefined; // libraries are fetched by a host; not available offline
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
