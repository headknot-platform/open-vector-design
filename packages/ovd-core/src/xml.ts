/**
 * A small, dependency-free XML reader and the canonical writer from spec §10.
 *
 * Why not DOMParser/XMLSerializer: neither guarantees attribute order, and neither exists in Node,
 * where the future server and the `ovd` CLI run. The reader covers what SVG files contain —
 * elements, attributes, text, CDATA, comments and entities — and skips the prolog and DOCTYPE.
 */

export interface XmlElement {
    kind: 'element';
    name: string;
    /** Insertion-ordered. The serialiser imposes canonical order on write. */
    attrs: Record<string, string>;
    children: XmlNode[];
}

export interface XmlText {
    kind: 'text';
    text: string;
}

export interface XmlComment {
    kind: 'comment';
    text: string;
}

export type XmlNode = XmlElement | XmlText | XmlComment;

export class XmlError extends Error {
    constructor(message: string, src?: string, index?: number) {
        super(
            src !== undefined && index !== undefined
                ? `${message} at ${lineCol(src, index)}`
                : message,
        );
        this.name = 'XmlError';
    }
}

function lineCol(src: string, index: number): string {
    const before = src.slice(0, index);
    const line = before.split('\n').length;
    const col = index - before.lastIndexOf('\n');
    return `${line}:${col}`;
}

export function el(
    name: string,
    attrs: Record<string, string | undefined> = {},
    children: XmlNode[] = [],
): XmlElement {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) clean[k] = v;
    return { kind: 'element', name, attrs: clean, children };
}

export function text(value: string): XmlText {
    return { kind: 'text', text: value };
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
    lt: '<',
    gt: '>',
    amp: '&',
    quot: '"',
    apos: "'",
    nbsp: ' ',
};

export function decodeEntities(s: string): string {
    if (!s.includes('&')) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
        if (body[0] === '#') {
            const code =
                body[1] === 'x' || body[1] === 'X'
                    ? parseInt(body.slice(2), 16)
                    : parseInt(body.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        }
        return NAMED_ENTITIES[body] ?? whole;
    });
}

const NAME_END = /[\s/>=]/;

export function parseXml(input: string): XmlElement {
    const src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
    const n = src.length;
    const stack: XmlElement[] = [];
    let root: XmlElement | null = null;
    let i = 0;

    const append = (node: XmlNode) => {
        const parent = stack[stack.length - 1];
        if (parent) parent.children.push(node);
    };

    while (i < n) {
        if (src.startsWith('<!--', i)) {
            const end = src.indexOf('-->', i + 4);
            if (end < 0) throw new XmlError('Unterminated comment', src, i);
            append({ kind: 'comment', text: src.slice(i + 4, end) });
            i = end + 3;
        } else if (src.startsWith('<![CDATA[', i)) {
            const end = src.indexOf(']]>', i + 9);
            if (end < 0) throw new XmlError('Unterminated CDATA', src, i);
            append({ kind: 'text', text: src.slice(i + 9, end) });
            i = end + 3;
        } else if (src.startsWith('<?', i)) {
            const end = src.indexOf('?>', i + 2);
            if (end < 0) throw new XmlError('Unterminated processing instruction', src, i);
            i = end + 2;
        } else if (src.startsWith('<!', i)) {
            // DOCTYPE, possibly with an internal subset in [ ].
            let depth = 0;
            let j = i + 2;
            for (; j < n; j++) {
                if (src[j] === '[') depth++;
                else if (src[j] === ']') depth--;
                else if (src[j] === '>' && depth <= 0) break;
            }
            i = j + 1;
        } else if (src[i] === '<' && src[i + 1] === '/') {
            const end = src.indexOf('>', i);
            if (end < 0) throw new XmlError('Unterminated closing tag', src, i);
            const name = src.slice(i + 2, end).trim();
            const open = stack.pop();
            if (!open || open.name !== name) {
                throw new XmlError(`Unexpected </${name}>`, src, i);
            }
            i = end + 1;
        } else if (src[i] === '<') {
            let j = i + 1;
            while (j < n && !NAME_END.test(src[j]!)) j++;
            const name = src.slice(i + 1, j);
            if (!name) throw new XmlError('Empty tag name', src, i);
            const node: XmlElement = { kind: 'element', name, attrs: {}, children: [] };
            let selfClosing = false;
            for (;;) {
                while (j < n && /\s/.test(src[j]!)) j++;
                if (j >= n) throw new XmlError(`Unterminated <${name}>`, src, i);
                if (src[j] === '/' && src[j + 1] === '>') {
                    selfClosing = true;
                    j += 2;
                    break;
                }
                if (src[j] === '>') {
                    j += 1;
                    break;
                }
                const nameStart = j;
                while (j < n && !NAME_END.test(src[j]!)) j++;
                const attrName = src.slice(nameStart, j);
                while (j < n && /\s/.test(src[j]!)) j++;
                if (src[j] !== '=') {
                    throw new XmlError(`Attribute ${attrName} has no value`, src, j);
                }
                j++;
                while (j < n && /\s/.test(src[j]!)) j++;
                const quote = src[j];
                if (quote !== '"' && quote !== "'") {
                    throw new XmlError(`Attribute ${attrName} is not quoted`, src, j);
                }
                const valueEnd = src.indexOf(quote, j + 1);
                if (valueEnd < 0) throw new XmlError(`Unterminated attribute ${attrName}`, src, j);
                node.attrs[attrName] = decodeEntities(src.slice(j + 1, valueEnd));
                j = valueEnd + 1;
            }
            if (stack.length === 0) {
                if (root) throw new XmlError('More than one root element', src, i);
                root = node;
            } else {
                append(node);
            }
            if (!selfClosing) stack.push(node);
            i = j;
        } else {
            const end = src.indexOf('<', i);
            const stop = end < 0 ? n : end;
            if (stack.length > 0)
                append({ kind: 'text', text: decodeEntities(src.slice(i, stop)) });
            i = stop;
        }
    }

    if (stack.length > 0) throw new XmlError(`Unclosed <${stack[stack.length - 1]!.name}>`);
    if (!root) throw new XmlError('No root element');
    return root;
}

// ---------------------------------------------------------------------------------------------
// Numbers (spec §10: 3 decimal places, no trailing zeros, no exponent)
// ---------------------------------------------------------------------------------------------

export function fmtNum(value: number): string {
    if (!Number.isFinite(value)) return '0';
    let r = Math.round(value * 1000) / 1000;
    if (Object.is(r, -0)) r = 0;
    const s = String(r);
    if (!/e/i.test(s)) return s;
    // Only reachable for |r| >= 1e21, where toFixed also switches to exponent form. Such values
    // are integral, and BigInt prints them positionally.
    return BigInt(Math.round(r)).toString();
}

const NUMBER_RE = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** Rounds every number in a value, leaving `{token.refs}` untouched. */
export function canonicalNumbers(value: string): string {
    return value
        .split(/(\{[^}]*\})/)
        .map((part) =>
            part.startsWith('{') ? part : part.replace(NUMBER_RE, (m) => fmtNum(parseFloat(m))),
        )
        .join('');
}

/**
 * Attributes whose values are numbers or number lists. Only these are rounded: a blanket rule
 * would rewrite hex colours such as `#4f46e5`, where `46e5` parses as an exponent.
 */
export const NUMERIC_ATTRS = new Set([
    'x',
    'y',
    'width',
    'height',
    'rx',
    'ry',
    'cx',
    'cy',
    'r',
    'x1',
    'y1',
    'x2',
    'y2',
    'd',
    'points',
    'transform',
    'viewBox',
    'font-size',
    'font-weight',
    'stroke-width',
    'opacity',
    'fill-opacity',
    'stroke-opacity',
    'letter-spacing',
    'ovd:width',
    'ovd:height',
    'ovd:gap',
    'ovd:padding',
    'ovd:radius',
    'ovd:min-width',
    'ovd:max-width',
    'ovd:min-height',
    'ovd:max-height',
    'ovd:line-height',
]);

// ---------------------------------------------------------------------------------------------
// Writing (canonical form)
// ---------------------------------------------------------------------------------------------

function attrRank(name: string): number {
    if (name === 'xmlns') return 0;
    if (name.startsWith('xmlns:')) return 1;
    if (name === 'id') return 2;
    if (name === 'ovd:type') return 3;
    if (name === 'ovd:name') return 4;
    if (name.startsWith('ovd:')) return 5;
    return 6;
}

/** Spec §10 order: id, ovd:type, ovd:name, other ovd:* A–Z, then SVG attributes A–Z. */
export function orderAttrs(attrs: Record<string, string>): [string, string][] {
    return Object.entries(attrs).sort(([a], [b]) => {
        const ra = attrRank(a);
        const rb = attrRank(b);
        if (ra !== rb) return ra - rb;
        return a < b ? -1 : a > b ? 1 : 0;
    });
}

function escapeText(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string, quote: '"' | "'"): string {
    const out = s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/\n/g, '&#10;')
        .replace(/\t/g, '&#9;');
    return quote === '"' ? out.replace(/"/g, '&quot;') : out.replace(/'/g, '&apos;');
}

function writeAttrs(attrs: Record<string, string>): string {
    return orderAttrs(attrs)
        .map(([k, raw]) => {
            const v = NUMERIC_ATTRS.has(k) ? canonicalNumbers(raw) : raw;
            // JSON-valued attributes (ovd:props) read far better single-quoted, as the spec's own
            // §5 example writes them. Deterministic: the choice depends only on the value.
            if (v.includes('"') && !v.includes("'")) return ` ${k}='${escapeAttr(v, "'")}'`;
            return ` ${k}="${escapeAttr(v, '"')}"`;
        })
        .join('');
}

function isBlank(node: XmlNode): boolean {
    return node.kind === 'text' && node.text.trim() === '';
}

function writeElement(node: XmlElement, depth: number, out: string[]): void {
    const pad = '  '.repeat(depth);
    const open = `${pad}<${node.name}${writeAttrs(node.attrs)}`;
    const children = node.children.filter((c) => !isBlank(c));

    if (children.length === 0) {
        out.push(`${open}/>`);
        return;
    }
    if (children.every((c) => c.kind === 'text')) {
        const body = children.map((c) => (c as XmlText).text).join('');
        out.push(`${open}>${escapeText(body)}</${node.name}>`);
        return;
    }
    out.push(`${open}>`);
    for (const child of children) {
        if (child.kind === 'element') writeElement(child, depth + 1, out);
        else if (child.kind === 'comment') out.push(`${pad}  <!--${child.text}-->`);
        else out.push(`${pad}  ${escapeText(child.text.trim())}`);
    }
    out.push(`${pad}</${node.name}>`);
}

/** Serialises in canonical form: 2-space indent, one element per line, LF, trailing newline. */
export function serializeXml(root: XmlElement): string {
    const out: string[] = [];
    writeElement(root, 0, out);
    return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------------------------

export function childElements(node: XmlElement, name?: string): XmlElement[] {
    return node.children.filter(
        (c): c is XmlElement => c.kind === 'element' && (name === undefined || c.name === name),
    );
}

export function textContent(node: XmlNode): string {
    if (node.kind === 'text') return node.text;
    if (node.kind === 'comment') return '';
    return node.children.map(textContent).join('');
}
