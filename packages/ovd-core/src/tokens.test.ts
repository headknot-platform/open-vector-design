import { describe, expect, it } from 'vitest';
import { createFrame, createShape, type Project } from './model';
import { writeProject } from './project';
import {
    deleteToken,
    flattenTokens,
    layerTokens,
    resolveTokens,
    setToken,
    tokenToCss,
    tokenTypography,
    tokensToCss,
} from './tokens';

const base = {
    color: {
        $type: 'color',
        neutral: {
            '0': { $value: '#ffffff' },
            '900': { $value: { colorSpace: 'srgb', components: [0, 0, 0], hex: '#000000' } },
        },
        primary: {
            $value: { colorSpace: 'srgb', components: [0.31, 0.275, 0.898], hex: '#4f46e5' },
        },
        surface: { $value: '{color.neutral.0}' },
        link: { $value: '{color.surface}' },
    },
    font: { sans: { $type: 'fontFamily', $value: ['Inter', 'sans-serif'] } },
    type: {
        body: {
            $type: 'typography',
            $value: {
                fontFamily: '{font.sans}',
                fontSize: { value: 16, unit: 'px' },
                fontWeight: 'bold',
                lineHeight: 1.5,
            },
        },
    },
};
const dark = { color: { surface: { $value: '{color.neutral.900}' } } };

const resolve = (...docs: Record<string, unknown>[]) =>
    resolveTokens(
        layerTokens(
            Object.fromEntries(docs.map((d, i) => [`f${i}`, d])),
            docs.map((_, i) => `f${i}`),
        ),
    );

describe('flattenTokens', () => {
    it('inherits $type from groups and skips $-metadata', () => {
        const flat = flattenTokens(base, 'base');
        expect(flat.get('color.neutral.0')).toMatchObject({ type: 'color', value: '#ffffff' });
        expect(flat.has('color.$type')).toBe(false);
    });
});

describe('resolveTokens', () => {
    it('follows alias chains and keeps the type', () => {
        const { tokens, errors } = resolve(base);
        expect(errors).toEqual([]);
        expect(tokens.get('color.link')).toMatchObject({
            type: 'color',
            css: '#ffffff',
            aliasOf: 'color.surface',
        });
    });

    it('resolves aliases nested inside composite values', () => {
        const set = resolve(base);
        expect(tokenTypography(set, '{type.body}')).toEqual({
            fontFamily: 'Inter, sans-serif',
            fontSize: 16,
            fontWeight: 700,
            lineHeight: 1.5,
            letterSpacing: 0,
        });
        expect(set.tokens.get('type.body')!.css).toBe('700 16px/1.5 Inter, sans-serif');
    });

    it('reports a cycle instead of looping', () => {
        const { errors } = resolve({ a: { $type: 'number', $value: '{b}' }, b: { $value: '{a}' } });
        expect(errors.some((e) => /cycle/.test(e.message))).toBe(true);
    });

    it('reports an alias to a missing token', () => {
        const { errors } = resolve({ a: { $type: 'color', $value: '{nope}' } });
        expect(errors).toEqual([
            { path: 'a', source: 'f0', message: 'refers to {nope}, which does not exist' },
        ]);
    });

    it('layers theme files over the base; later wins, and aliases follow', () => {
        expect(resolve(base).tokens.get('color.link')!.css).toBe('#ffffff');
        expect(resolve(base, dark).tokens.get('color.link')!.css).toBe('#000000');
    });
});

describe('tokenToCss', () => {
    it.each<[Parameters<typeof tokenToCss>[0], unknown, string]>([
        [
            'color',
            { colorSpace: 'srgb', components: [1, 0, 0], hex: '#ff0000', alpha: 0.5 },
            '#ff000080',
        ],
        ['color', { colorSpace: 'srgb', components: [1, 0, 0] }, '#ff0000'],
        [
            'color',
            { colorSpace: 'display-p3', components: [1, 0.5, 0] },
            'color(display-p3 1 0.5 0)',
        ],
        [
            'color',
            { colorSpace: 'oklch', components: [0.7, 0.1, 250], alpha: 0.5 },
            'oklch(0.7 0.1 250 / 0.5)',
        ],
        ['dimension', { value: 1.5, unit: 'rem' }, '1.5rem'],
        ['fontFamily', ['Source Sans 3', 'sans-serif'], '"Source Sans 3", sans-serif'],
        ['fontWeight', 'semi-bold', '600'],
        ['number', 1.25, '1.25'],
        ['duration', { value: 150, unit: 'ms' }, '150ms'],
        ['cubicBezier', [0.4, 0, 0.2, 1], 'cubic-bezier(0.4, 0, 0.2, 1)'],
        [
            'shadow',
            {
                color: '#0003',
                offsetX: { value: 0, unit: 'px' },
                offsetY: { value: 2, unit: 'px' },
                blur: { value: 4, unit: 'px' },
                spread: { value: 0, unit: 'px' },
            },
            '0px 2px 4px 0px #0003',
        ],
        [
            'border',
            { color: '#000', width: { value: 1, unit: 'px' }, style: 'dashed' },
            '1px dashed #000',
        ],
        ['strokeStyle', 'dotted', 'dotted'],
        [
            'gradient',
            [
                { color: '#000', position: 0 },
                { color: '#fff', position: 1 },
            ],
            'linear-gradient(90deg, #000 0%, #fff 100%)',
        ],
    ])('%s %j → %s', (type, value, css) => {
        expect(tokenToCss(type, value)).toBe(css);
    });
});

describe('editing token documents', () => {
    it('sets a token, creating groups as needed', () => {
        const doc: Record<string, unknown> = {};
        setToken(doc, 'color.brand.main', { $value: '#123456', $type: 'color' });
        expect(doc).toEqual({ color: { brand: { main: { $value: '#123456', $type: 'color' } } } });
    });

    it('deletes a token and prunes groups left empty', () => {
        const doc = structuredClone(base) as Record<string, unknown>;
        expect(deleteToken(doc, 'font.sans')).toBe(true);
        expect('font' in doc).toBe(false);
        expect(deleteToken(doc, 'font.sans')).toBe(false);
    });
});

describe('generated token <style> (spec §8)', () => {
    const project: Project = {
        manifest: {
            version: '0.1',
            name: 't',
            id: '',
            exports: 'exports/',
            tokens: ['tokens/base.tokens.json'],
            themes: { dark: ['tokens/dark.tokens.json'], light: [] },
            pages: [{ file: 'pages/p.svg', name: 'P' }],
        },
        pages: [
            {
                file: 'pages/p.svg',
                name: 'P',
                extra: {},
                extraChildren: [],
                children: [
                    createFrame('f_1', {
                        // A stale fallback: the writer must replace it with the resolved value.
                        fill: { color: '#999999', token: '{color.surface}' },
                        children: [
                            createShape('r_1', 'rect', {
                                fill: { color: '#4f46e5', token: '{color.primary}' },
                            }),
                        ],
                    }),
                ],
            },
        ],
        components: [],
        tokens: { 'tokens/base.tokens.json': base, 'tokens/dark.tokens.json': dark },
        assets: {},
        comments: {},
        other: {},
    };

    it('lists only the tokens the file uses, from the default theme, and refreshes fallbacks', () => {
        const svg = writeProject(project)['pages/p.svg'] as string;
        expect(svg).toContain('<style ovd:generated="tokens">');
        expect(svg).toContain('--color-primary: #4f46e5;');
        expect(svg).toContain('--color-surface: #ffffff;');
        expect(svg).not.toContain('--color-link');
        expect(svg).toContain('fill="var(--color-surface, #ffffff)"');
        // The caller's model is untouched.
        expect(project.pages[0]!.children[0]).toMatchObject({ fill: { color: '#999999' } });
    });

    it('uses another theme only when asked', () => {
        const svg = writeProject(project, { theme: 'dark' })['pages/p.svg'] as string;
        expect(svg).toContain('--color-surface: #000000;');
    });

    it('produces css one declaration per line', () => {
        expect(tokensToCss(resolve(base), ['color.primary', 'color.surface'])).toBe(
            '\n:root {\n  --color-primary: #4f46e5;\n  --color-surface: #ffffff;\n}\n',
        );
    });
});
