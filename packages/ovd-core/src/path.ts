/**
 * SVG path data, normalised to absolute M / L / C / Q / Z. Relative commands, H / V / S / T and
 * arcs (converted to cubics) are all reduced to those five, so resizing and editing only ever deal
 * with points.
 */
import { fmtNum } from './xml';

export type PathCmd =
    | { c: 'M'; x: number; y: number }
    | { c: 'L'; x: number; y: number }
    | { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { c: 'Q'; x1: number; y1: number; x: number; y: number }
    | { c: 'Z' };

const ARG_COUNT: Record<string, number> = {
    M: 2,
    L: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    T: 2,
    A: 7,
    Z: 0,
};

function tokenize(d: string): (string | number)[] {
    const out: (string | number)[] = [];
    const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(d))) out.push(m[1] ?? parseFloat(m[2]!));
    return out;
}

export function parsePath(d: string): PathCmd[] {
    const tokens = tokenize(d);
    const out: PathCmd[] = [];
    let i = 0;
    let cmd = '';
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    // Last control point, for S / T reflection.
    let lcx = 0;
    let lcy = 0;
    let lastType = '';

    const num = () => {
        const t = tokens[i++];
        if (typeof t !== 'number') throw new Error(`Bad path data near token ${i}: ${d}`);
        return t;
    };

    while (i < tokens.length) {
        const t = tokens[i];
        if (typeof t === 'string') {
            cmd = t;
            i++;
        } else if (!cmd) {
            throw new Error(`Path data must start with a command: ${d}`);
        } else if (cmd === 'M') {
            cmd = 'L';
        } else if (cmd === 'm') {
            cmd = 'l';
        }
        const upper = cmd.toUpperCase();
        const rel = cmd !== upper;
        if (upper === 'Z') {
            out.push({ c: 'Z' });
            cx = sx;
            cy = sy;
            lastType = 'Z';
            continue;
        }
        if (typeof tokens[i] !== 'number' && ARG_COUNT[upper]! > 0) continue;
        const ox = rel ? cx : 0;
        const oy = rel ? cy : 0;
        switch (upper) {
            case 'M': {
                cx = ox + num();
                cy = oy + num();
                sx = cx;
                sy = cy;
                out.push({ c: 'M', x: cx, y: cy });
                break;
            }
            case 'L':
            case 'H':
            case 'V': {
                if (upper === 'L') {
                    cx = ox + num();
                    cy = oy + num();
                } else if (upper === 'H') {
                    cx = ox + num();
                } else {
                    cy = oy + num();
                }
                out.push({ c: 'L', x: cx, y: cy });
                break;
            }
            case 'C':
            case 'S': {
                let x1: number;
                let y1: number;
                if (upper === 'C') {
                    x1 = ox + num();
                    y1 = oy + num();
                } else {
                    const reflect = lastType === 'C';
                    x1 = reflect ? 2 * cx - lcx : cx;
                    y1 = reflect ? 2 * cy - lcy : cy;
                }
                const x2 = ox + num();
                const y2 = oy + num();
                cx = ox + num();
                cy = oy + num();
                out.push({ c: 'C', x1, y1, x2, y2, x: cx, y: cy });
                lcx = x2;
                lcy = y2;
                lastType = 'C';
                continue;
            }
            case 'Q':
            case 'T': {
                let x1: number;
                let y1: number;
                if (upper === 'Q') {
                    x1 = ox + num();
                    y1 = oy + num();
                } else {
                    const reflect = lastType === 'Q';
                    x1 = reflect ? 2 * cx - lcx : cx;
                    y1 = reflect ? 2 * cy - lcy : cy;
                }
                cx = ox + num();
                cy = oy + num();
                out.push({ c: 'Q', x1, y1, x: cx, y: cy });
                lcx = x1;
                lcy = y1;
                lastType = 'Q';
                continue;
            }
            case 'A': {
                const rx = num();
                const ry = num();
                const rot = num();
                const large = num() !== 0;
                const sweep = num() !== 0;
                const x = ox + num();
                const y = oy + num();
                out.push(...arcToCubics(cx, cy, rx, ry, rot, large, sweep, x, y));
                cx = x;
                cy = y;
                break;
            }
        }
        lastType = upper === 'A' ? 'C0' : upper;
    }
    return out;
}

/** Endpoint → centre parameterisation (SVG 1.1 implementation notes F.6.5), then ≤90° cubics. */
function arcToCubics(
    x1: number,
    y1: number,
    rxIn: number,
    ryIn: number,
    angle: number,
    large: boolean,
    sweep: boolean,
    x2: number,
    y2: number,
): PathCmd[] {
    let rx = Math.abs(rxIn);
    let ry = Math.abs(ryIn);
    if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [{ c: 'L', x: x2, y: y2 }];
    const phi = (angle * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (x1 - x2) / 2;
    const dy = (y1 - y2) / 2;
    const x1p = cos * dx + sin * dy;
    const y1p = -sin * dx + cos * dy;
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
        rx *= Math.sqrt(lambda);
        ry *= Math.sqrt(lambda);
    }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let coef = Math.sqrt(Math.max(0, num / den));
    if (large === sweep) coef = -coef;
    const cxp = (coef * rx * y1p) / ry;
    const cyp = (-coef * ry * x1p) / rx;
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
    const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
    const vecAngle = (ux: number, uy: number, vx: number, vy: number) => {
        const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
        return a;
    };
    const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let delta = vecAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && delta > 0) delta -= 2 * Math.PI;
    else if (sweep && delta < 0) delta += 2 * Math.PI;

    const segments = Math.ceil(Math.abs(delta) / (Math.PI / 2));
    const step = delta / segments;
    const k = (4 / 3) * Math.tan(step / 4);
    const out: PathCmd[] = [];
    let t = theta1;
    const point = (a: number) => {
        const ex = rx * Math.cos(a);
        const ey = ry * Math.sin(a);
        return [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy] as const;
    };
    const deriv = (a: number) => {
        const ex = -rx * Math.sin(a);
        const ey = ry * Math.cos(a);
        return [cos * ex - sin * ey, sin * ex + cos * ey] as const;
    };
    for (let s = 0; s < segments; s++) {
        const t2 = t + step;
        const [px1, py1] = point(t);
        const [px2, py2] = point(t2);
        const [d1x, d1y] = deriv(t);
        const [d2x, d2y] = deriv(t2);
        out.push({
            c: 'C',
            x1: px1 + k * d1x,
            y1: py1 + k * d1y,
            x2: px2 - k * d2x,
            y2: py2 - k * d2y,
            x: s === segments - 1 ? x2 : px2,
            y: s === segments - 1 ? y2 : py2,
        });
        t = t2;
    }
    return out;
}

export function serializePath(cmds: PathCmd[]): string {
    return cmds
        .map((p) => {
            switch (p.c) {
                case 'M':
                case 'L':
                    return `${p.c}${fmtNum(p.x)} ${fmtNum(p.y)}`;
                case 'C':
                    return `C${[p.x1, p.y1, p.x2, p.y2, p.x, p.y].map(fmtNum).join(' ')}`;
                case 'Q':
                    return `Q${[p.x1, p.y1, p.x, p.y].map(fmtNum).join(' ')}`;
                case 'Z':
                    return 'Z';
            }
        })
        .join('');
}

export function mapPath(
    cmds: PathCmd[],
    fn: (x: number, y: number) => [number, number],
): PathCmd[] {
    return cmds.map((p) => {
        switch (p.c) {
            case 'M':
            case 'L': {
                const [x, y] = fn(p.x, p.y);
                return { c: p.c, x, y };
            }
            case 'C': {
                const [x1, y1] = fn(p.x1, p.y1);
                const [x2, y2] = fn(p.x2, p.y2);
                const [x, y] = fn(p.x, p.y);
                return { c: 'C', x1, y1, x2, y2, x, y };
            }
            case 'Q': {
                const [x1, y1] = fn(p.x1, p.y1);
                const [x, y] = fn(p.x, p.y);
                return { c: 'Q', x1, y1, x, y };
            }
            case 'Z':
                return p;
        }
    });
}

export interface Bounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Tight-enough bounds: curve segments are sampled. */
export function pathBounds(cmds: PathCmd[]): Bounds {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const add = (x: number, y: number) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    };
    let px = 0;
    let py = 0;
    for (const p of cmds) {
        if (p.c === 'Z') continue;
        if (p.c === 'C') {
            for (let i = 1; i <= 16; i++) {
                const t = i / 16;
                const mt = 1 - t;
                add(
                    mt ** 3 * px + 3 * mt * mt * t * p.x1 + 3 * mt * t * t * p.x2 + t ** 3 * p.x,
                    mt ** 3 * py + 3 * mt * mt * t * p.y1 + 3 * mt * t * t * p.y2 + t ** 3 * p.y,
                );
            }
        } else if (p.c === 'Q') {
            for (let i = 1; i <= 16; i++) {
                const t = i / 16;
                const mt = 1 - t;
                add(
                    mt * mt * px + 2 * mt * t * p.x1 + t * t * p.x,
                    mt * mt * py + 2 * mt * t * p.y1 + t * t * p.y,
                );
            }
        } else {
            add(p.x, p.y);
        }
        px = p.x;
        py = p.y;
    }
    if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Rescales path data from one box size to another (used when a path layer is resized). */
export function scalePath(d: string, from: { w: number; h: number }, to: { w: number; h: number }) {
    const sx = from.w === 0 ? 1 : to.w / from.w;
    const sy = from.h === 0 ? 1 : to.h / from.h;
    return serializePath(mapPath(parsePath(d), (x, y) => [x * sx, y * sy]));
}
