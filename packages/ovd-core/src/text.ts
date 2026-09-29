/**
 * Text layout (spec §7). Wrapping depends on font metrics, so it runs in the editor with a real
 * `measure` and its result is stored as `TextNode.lines`; the writer emits stored lines and never
 * re-measures. That keeps `ovd fmt` deterministic on machines with different fonts.
 */
import type { TextNode } from './model';

export interface FontSpec {
    family: string;
    size: number;
    weight: number;
    letterSpacing: number;
}

export type Measure = (text: string, font: FontSpec) => number;

/** A metric-free fallback (average glyph ≈ 0.55 em). Real editors pass a canvas-based measure. */
export const approxMeasure: Measure = (s, f) =>
    s.length * f.size * 0.55 + Math.max(0, s.length - 1) * f.letterSpacing;

/** Ascent used to place baselines: a convention shared by canvas, file and export. */
export const ASCENT = 0.8;

export function lineBox(node: Pick<TextNode, 'fontSize' | 'lineHeight'>): number {
    return node.fontSize * node.lineHeight;
}

export function baselineY(node: Pick<TextNode, 'fontSize' | 'lineHeight'>, index: number): number {
    const lh = lineBox(node);
    return index * lh + (lh - node.fontSize) / 2 + node.fontSize * ASCENT;
}

export function anchorX(node: Pick<TextNode, 'align' | 'width'>): number {
    return node.align === 'middle' ? node.width / 2 : node.align === 'end' ? node.width : 0;
}

export function fontOf(node: TextNode): FontSpec {
    return {
        family: node.fontFamily,
        size: node.fontSize,
        weight: node.fontWeight,
        letterSpacing: node.letterSpacing,
    };
}

/** Explicit newlines always break; otherwise break at spaces, and hard-break over-long words. */
export function wrapLines(
    content: string,
    maxWidth: number,
    font: FontSpec,
    measure: Measure,
): string[] {
    const out: string[] = [];
    for (const paragraph of content.split('\n')) {
        const words = paragraph.split(/(\s+)/).filter((w) => w.length > 0);
        let line = '';
        for (const word of words) {
            const candidate = line + word;
            if (line === '' || measure(candidate.trimEnd(), font) <= maxWidth) {
                line = candidate;
            } else {
                out.push(line.trimEnd());
                line = word.trimStart();
            }
            // A single word wider than the box: break it by characters.
            while (line && measure(line.trimEnd(), font) > maxWidth && line.trimEnd().length > 1) {
                let cut = line.length - 1;
                while (cut > 1 && measure(line.slice(0, cut), font) > maxWidth) cut--;
                out.push(line.slice(0, cut));
                line = line.slice(cut);
            }
        }
        out.push(line.trimEnd());
    }
    return out;
}

/** Recomputes lines and box size after a content, font or width change. Mutates `node`. */
export function relayoutText(node: TextNode, measure: Measure = approxMeasure): void {
    const font = fontOf(node);
    if (node.box === 'auto-width') {
        node.lines = node.content.split('\n');
        node.width = Math.max(1, ...node.lines.map((l) => measure(l, font)));
        node.height = node.lines.length * lineBox(node);
        return;
    }
    node.lines = wrapLines(node.content, Math.max(1, node.width), font, measure);
    if (node.box === 'fixed-width') node.height = node.lines.length * lineBox(node);
}
