/** Token references inside a scene: what a file uses, and keeping its fallbacks true (spec §4, §8). */
import {
    type ComponentFile,
    type ComponentNode,
    type Dim,
    type Paint,
    type SceneNode,
    childrenOf,
} from './model';
import { tokenPath } from './token-ref';
import { type TokenSet, tokenColor } from './tokens';

type AnyNode = SceneNode | ComponentNode;

function visitAll(nodes: AnyNode[], fn: (n: AnyNode) => void): void {
    for (const n of nodes) {
        fn(n);
        const kids = childrenOf(n);
        if (kids) visitAll(kids, fn);
    }
}

function paintsOf(n: AnyNode): Paint[] {
    const out: Paint[] = [];
    if ('fill' in n && n.fill) out.push(n.fill);
    if ('stroke' in n && n.stroke) out.push(n.stroke.paint);
    if (n.type === 'instance') {
        for (const o of n.overrides) {
            if (o.fill) out.push(o.fill);
            if (o.stroke) out.push(o.stroke);
        }
    }
    return out;
}

function dimsOf(n: AnyNode): Dim[] {
    if (n.type === 'frame' || n.type === 'component') return [n.layout.gap, ...n.layout.padding];
    return [];
}

/** Every token path the nodes reference. */
export function collectTokenRefs(nodes: AnyNode[]): Set<string> {
    const refs = new Set<string>();
    visitAll(nodes, (n) => {
        for (const p of paintsOf(n)) if (p.token) refs.add(tokenPath(p.token));
        for (const d of dimsOf(n)) if (d.token) refs.add(tokenPath(d.token));
        if (n.type === 'text' && n.textStyle) refs.add(tokenPath(n.textStyle));
        if (n.type !== 'component' && n.link?.duration?.startsWith('{')) {
            refs.add(tokenPath(n.link.duration));
        }
    });
    return refs;
}

export function componentFileNodes(file: ComponentFile): ComponentNode[] {
    return file.sets.flatMap((s) => s.variants);
}

/** Sets each token-bound paint's fallback colour to the token's resolved value. Mutates. */
export function refreshFallbacks(nodes: AnyNode[], set: TokenSet): void {
    visitAll(nodes, (n) => {
        for (const p of paintsOf(n)) {
            const css = p.token ? tokenColor(set, p.token) : undefined;
            if (css) p.color = css;
        }
    });
}
