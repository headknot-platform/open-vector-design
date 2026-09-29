import { describe, expect, it } from 'vitest';
import {
    XmlError,
    canonicalNumbers,
    el,
    fmtNum,
    orderAttrs,
    parseXml,
    serializeXml,
    text,
} from './xml';

describe('fmtNum (spec §10 numbers)', () => {
    it.each([
        [1, '1'],
        [1.5, '1.5'],
        [1.23456, '1.235'],
        [2.0004, '2'],
        [-0.0001, '0'],
        [-0, '0'],
        [1e-7, '0'],
        [123456789, '123456789'],
        [1e21, '1000000000000000000000'],
    ])('%s → %s', (n, s) => {
        expect(fmtNum(n)).toBe(s);
    });
});

describe('canonicalNumbers', () => {
    it('rounds numbers in lists and transforms', () => {
        expect(canonicalNumbers('translate(10.00001 20.5555)')).toBe('translate(10 20.556)');
        expect(canonicalNumbers('M0 0L1.23456 2e2')).toBe('M0 0L1.235 200');
    });

    it('leaves token references alone', () => {
        expect(canonicalNumbers('{spacing.2xl} 8.0001')).toBe('{spacing.2xl} 8');
    });
});

describe('attribute order (spec §10)', () => {
    it('is id, ovd:type, ovd:name, other ovd:* A–Z, then the rest A–Z', () => {
        const order = orderAttrs({
            y: '1',
            'ovd:width': '1',
            fill: 'red',
            'ovd:name': 'n',
            id: 'a',
            'ovd:clip': 'true',
            'ovd:type': 'frame',
            x: '0',
        }).map(([k]) => k);
        expect(order).toEqual([
            'id',
            'ovd:type',
            'ovd:name',
            'ovd:clip',
            'ovd:width',
            'fill',
            'x',
            'y',
        ]);
    });

    it('puts namespace declarations first', () => {
        const order = orderAttrs({ viewBox: '0 0 1 1', 'xmlns:ovd': 'o', xmlns: 's' }).map(
            ([k]) => k,
        );
        expect(order).toEqual(['xmlns', 'xmlns:ovd', 'viewBox']);
    });
});

describe('serializeXml', () => {
    it('writes one element per line with 2-space indent and a trailing newline', () => {
        const out = serializeXml(
            el('svg', { xmlns: 'http://www.w3.org/2000/svg' }, [
                el('g', { id: 'g1' }, [el('rect', { width: '10.00049', height: '5' })]),
                el('title', {}, [text('A & B')]),
            ]),
        );
        expect(out).toBe(
            [
                '<svg xmlns="http://www.w3.org/2000/svg">',
                '  <g id="g1">',
                '    <rect height="5" width="10"/>',
                '  </g>',
                '  <title>A &amp; B</title>',
                '</svg>',
                '',
            ].join('\n'),
        );
    });

    it('does not touch hex colours even though they look like exponents', () => {
        const out = serializeXml(el('rect', { fill: '#4f46e5', x: '1e1' }));
        expect(out).toBe('<rect fill="#4f46e5" x="10"/>\n');
    });

    it('single-quotes JSON-valued attributes, as spec §5 does', () => {
        const out = serializeXml(el('symbol', { 'ovd:props': '{"size":["md","sm"]}' }));
        expect(out).toBe(`<symbol ovd:props='{"size":["md","sm"]}'/>\n`);
    });

    it('escapes newlines inside attributes so each element stays on one line', () => {
        const out = serializeXml(el('text', { 'ovd:content': 'a\nb' }));
        expect(out).toBe('<text ovd:content="a&#10;b"/>\n');
        expect(parseXml(out).attrs['ovd:content']).toBe('a\nb');
    });
});

describe('parseXml', () => {
    it('decodes entities and keeps comments', () => {
        const root = parseXml(
            '<?xml version="1.0"?><!DOCTYPE svg><a x="&lt;&#65;&#x42;">t&amp;u<!-- c --></a>',
        );
        expect(root.attrs['x']).toBe('<AB');
        expect(root.children).toEqual([
            { kind: 'text', text: 't&u' },
            { kind: 'comment', text: ' c ' },
        ]);
    });

    it('reads CDATA as text', () => {
        const root = parseXml('<style><![CDATA[a > b { }]]></style>');
        expect(root.children[0]).toEqual({ kind: 'text', text: 'a > b { }' });
    });

    it('reports malformed input with a position', () => {
        expect(() => parseXml('<a>\n<b></a>')).toThrow(XmlError);
        expect(() => parseXml('<a>\n<b></a>')).toThrow(/2:4/);
        expect(() => parseXml('<a x=1/>')).toThrow(/not quoted/);
    });
});
