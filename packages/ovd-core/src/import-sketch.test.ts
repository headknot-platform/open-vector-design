import { describe, expect, it } from 'vitest';
import { exportPageSvg } from './export';
import { importSketch } from './import-sketch';
import { findNode } from './model';
import { readProject, writeProject } from './project';
import { validateProject } from './validate';

const color = (r: number, g: number, b: number, a = 1) => ({
    _class: 'color',
    red: r,
    green: g,
    blue: b,
    alpha: a,
});
const fill = (c: ReturnType<typeof color> & { swatchID?: string }, extra = {}) => ({
    style: { fills: [{ isEnabled: true, fillType: 0, color: c, ...extra }] },
});
const frame = (x: number, y: number, width: number, height: number) => ({
    _class: 'rect',
    x,
    y,
    width,
    height,
});

const master = {
    _class: 'symbolMaster',
    do_objectID: 'AAAA0000-0000-0000-0000-000000000001',
    symbolID: 'SYM-BUTTON',
    name: 'Button',
    frame: frame(0, 0, 120, 40),
    hasBackgroundColor: true,
    backgroundColor: color(0.31, 0.27, 0.9),
    layers: [
        {
            _class: 'text',
            do_objectID: 'BBBB0000-0000-0000-0000-000000000002',
            name: 'Label',
            frame: frame(10, 10, 100, 20),
            textBehaviour: 0,
            attributedString: {
                string: 'Button',
                attributes: [
                    {
                        attributes: {
                            MSAttributedStringFontAttribute: {
                                attributes: { name: 'Inter-SemiBold', size: 15 },
                            },
                            MSAttributedStringColorAttribute: color(1, 1, 1),
                            paragraphStyle: { alignment: 2 },
                        },
                    },
                ],
            },
        },
    ],
};

const page = {
    _class: 'page',
    name: 'Home',
    layers: [
        {
            _class: 'artboard',
            do_objectID: 'CCCC0000-0000-0000-0000-000000000003',
            name: 'Home / Mobile',
            frame: frame(0, 0, 375, 812),
            hasBackgroundColor: false,
            layers: [
                {
                    _class: 'rectangle',
                    do_objectID: 'DDDD0001',
                    name: 'Card',
                    frame: frame(16, 16, 343, 200),
                    fixedRadius: 12,
                    ...fill({ ...color(0.95, 0.95, 0.97), swatchID: 'SWATCH-1' }),
                },
                {
                    _class: 'oval',
                    do_objectID: 'DDDD0002',
                    name: 'Avatar',
                    frame: frame(24, 24, 48, 48),
                    rotation: 90,
                    ...fill(color(1, 0, 0.5)),
                },
                {
                    _class: 'shapePath',
                    do_objectID: 'DDDD0003',
                    name: 'Triangle',
                    frame: frame(100, 100, 40, 40),
                    isClosed: true,
                    points: [{ point: '{0.5, 0}' }, { point: '{1, 1}' }, { point: '{0, 1}' }],
                    style: { borders: [{ isEnabled: true, color: color(0, 0, 0), thickness: 2 }] },
                },
                {
                    _class: 'group',
                    do_objectID: 'DDDD0004',
                    name: 'Group',
                    frame: frame(200, 200, 100, 100),
                    layers: [
                        {
                            _class: 'bitmap',
                            do_objectID: 'DDDD0005',
                            name: 'Photo',
                            frame: frame(0, 0, 100, 100),
                            image: { _ref: 'images/abc123' },
                        },
                    ],
                },
                {
                    _class: 'symbolInstance',
                    do_objectID: 'DDDD0006',
                    name: 'CTA',
                    symbolID: 'SYM-BUTTON',
                    frame: frame(16, 740, 343, 48),
                    overrideValues: [
                        {
                            overrideName: 'BBBB0000-0000-0000-0000-000000000002_stringValue',
                            value: 'Continue',
                        },
                    ],
                },
                {
                    _class: 'slice',
                    do_objectID: 'DDDD0007',
                    name: 'Export slice',
                    frame: frame(0, 0, 10, 10),
                },
            ],
        },
    ],
};

const files = {
    'document.json': JSON.stringify({
        do_objectID: 'DOC-1',
        pages: [{ _ref: 'pages/p1' }, { _ref: 'pages/p2' }],
        sharedSwatches: {
            objects: [
                { do_objectID: 'SWATCH-1', name: 'Surface Muted', value: color(0.95, 0.95, 0.97) },
            ],
        },
    }),
    'meta.json': '{}',
    'pages/p1.json': JSON.stringify(page),
    'pages/p2.json': JSON.stringify({ _class: 'page', name: 'Symbols', layers: [master] }),
    'images/abc123.png': new Uint8Array([137, 80, 78, 71]),
};

describe('Sketch import (spec §11)', () => {
    const { project, warnings } = importSketch(files, { name: 'Demo' });
    const roots = project.pages[0]!.children;

    it('maps pages, artboards and shapes', () => {
        expect(project.manifest.name).toBe('Demo');
        expect(project.pages.map((p) => p.file)).toEqual(['pages/home.svg']);
        expect(roots[0]).toMatchObject({
            type: 'frame',
            name: 'Home / Mobile',
            width: 375,
            height: 812,
            clip: true,
        });
        expect(findNode(roots, 'r_dddd0001')).toMatchObject({
            kind: 'rect',
            radius: 12,
            fill: { color: '#f2f2f7', token: '{color.surface_muted}' },
        });
        expect(findNode(roots, 'e_dddd0002')).toMatchObject({
            kind: 'ellipse',
            rotation: -90,
            fill: { color: '#ff0080' },
        });
        expect(findNode(roots, 'p_dddd0003')).toMatchObject({
            kind: 'path',
            d: 'M20 0L40 40L0 40L20 0Z',
            stroke: { width: 2 },
        });
    });

    it('stores bitmaps as assets referenced by relative path', () => {
        expect(Object.keys(project.assets)).toEqual(['assets/images/abc123.png']);
        expect(findNode(roots, 'img_dddd0005')).toMatchObject({
            href: '../assets/images/abc123.png',
        });
    });

    it('turns symbols into components and instances with text overrides', () => {
        expect(project.components[0]!.file).toBe('components/sketch-symbols.svg');
        const inst = findNode(roots, 'i_dddd0006');
        expect(inst).toMatchObject({
            type: 'instance',
            href: '../components/sketch-symbols.svg#c_aaaa0000',
            overrides: [{ target: 't_bbbb0000', text: 'Continue' }],
        });
        expect(exportPageSvg(project, project.pages[0]!)).toContain('>Continue</tspan>');
    });

    it('turns shared swatches into DTCG tokens', () => {
        expect(project.tokens['tokens/sketch.tokens.json']).toEqual({
            color: { $type: 'color', surface_muted: { $value: '#f2f2f7' } },
        });
    });

    it('reports what it could not map', () => {
        expect(warnings).toEqual(['skipped unsupported layer "Export slice" (slice)']);
    });

    it('produces a valid project that round-trips', () => {
        const written = writeProject(project);
        const back = readProject(written);
        expect(writeProject(back)).toEqual(written);
        expect(validateProject(back).filter((i) => i.severity === 'error')).toEqual([]);
    });
});
