import { describe, expect, it } from 'vitest';
import { exportPageSvg } from './export';
import { importFigma } from './import-figma';
import { findNode } from './model';
import { readProject, writeProject } from './project';
import { validateProject } from './validate';

const rgb = (r: number, g: number, b: number, a = 1) => ({ r, g, b, a });
const solid = (c: ReturnType<typeof rgb>, variable?: string) => ({
    type: 'SOLID',
    color: c,
    ...(variable ? { boundVariables: { color: { type: 'VARIABLE_ALIAS', id: variable } } } : {}),
});
const bbox = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

const labelText = (id: string, x: number) => ({
    id,
    type: 'TEXT',
    name: 'Label',
    characters: 'Button',
    absoluteBoundingBox: bbox(x, 12, 50, 18),
    style: {
        fontFamily: 'Inter',
        fontWeight: 600,
        fontSize: 15,
        lineHeightPx: 18,
        textAlignHorizontal: 'LEFT',
    },
    textAutoResize: 'WIDTH_AND_HEIGHT',
    fills: [solid(rgb(1, 1, 1))],
    componentPropertyReferences: { characters: 'Label#1:2' },
});

const variant = (id: string, name: string, x: number, color: ReturnType<typeof rgb>) => ({
    id,
    type: 'COMPONENT',
    name,
    absoluteBoundingBox: bbox(x, 0, 160, 44),
    fills: [solid(color)],
    cornerRadius: 8,
    layoutMode: 'HORIZONTAL',
    itemSpacing: 0,
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 16,
    paddingRight: 16,
    primaryAxisAlignItems: 'CENTER',
    counterAxisAlignItems: 'CENTER',
    children: [labelText(`${id}t`, x + 55)],
});

const file = {
    name: 'Mobile App',
    document: {
        id: '0:0',
        type: 'DOCUMENT',
        children: [
            {
                id: '0:1',
                type: 'CANVAS',
                name: 'Screens',
                children: [
                    {
                        id: '10:1',
                        type: 'FRAME',
                        name: 'Home / Mobile',
                        absoluteBoundingBox: bbox(0, 0, 375, 812),
                        fills: [solid(rgb(1, 1, 1), 'VariableID:surface')],
                        clipsContent: true,
                        layoutMode: 'VERTICAL',
                        itemSpacing: 16,
                        paddingTop: 24,
                        paddingRight: 24,
                        paddingBottom: 24,
                        paddingLeft: 24,
                        boundVariables: {
                            itemSpacing: { type: 'VARIABLE_ALIAS', id: 'VariableID:space-md' },
                        },
                        children: [
                            {
                                id: '10:2',
                                type: 'TEXT',
                                name: 'Title',
                                characters: 'Welcome',
                                absoluteBoundingBox: bbox(24, 24, 327, 38),
                                style: {
                                    fontFamily: 'Inter',
                                    fontWeight: 700,
                                    fontSize: 32,
                                    lineHeightPx: 38.4,
                                },
                                textAutoResize: 'HEIGHT',
                                layoutSizingHorizontal: 'FILL',
                                layoutSizingVertical: 'HUG',
                                fills: [solid(rgb(0.07, 0.07, 0.1))],
                            },
                            {
                                id: '10:3',
                                type: 'INSTANCE',
                                name: 'CTA',
                                componentId: '1:10',
                                absoluteBoundingBox: bbox(24, 78, 160, 44),
                                componentProperties: {
                                    'Label#1:2': { type: 'TEXT', value: 'Continue' },
                                },
                                children: [],
                            },
                            {
                                id: '10:4',
                                type: 'RECTANGLE',
                                name: 'Hero',
                                absoluteBoundingBox: bbox(24, 138, 327, 200),
                                fills: [{ type: 'IMAGE', imageRef: 'abc123', scaleMode: 'FILL' }],
                            },
                            {
                                id: '10:5',
                                type: 'VECTOR',
                                name: 'Check',
                                absoluteBoundingBox: bbox(24, 354, 24, 24),
                                fills: [solid(rgb(0.2, 0.7, 0.3))],
                                fillGeometry: [{ path: 'M0 12L9 21L24 3', windingRule: 'NONZERO' }],
                                layoutPositioning: 'ABSOLUTE',
                            },
                            {
                                id: '10:6',
                                type: 'INSTANCE',
                                name: 'Library badge',
                                componentId: '99:1',
                                absoluteBoundingBox: bbox(24, 400, 80, 24),
                                fills: [solid(rgb(1, 0.8, 0))],
                                children: [],
                            },
                            {
                                id: '10:7',
                                type: 'SLICE',
                                name: 'Export area',
                                absoluteBoundingBox: bbox(0, 0, 10, 10),
                            },
                        ],
                    },
                    {
                        id: '11:1',
                        type: 'ELLIPSE',
                        name: 'Tilted',
                        // A 100×50 ellipse turned 90°: its bounding box is 50×100, centred on (450, 100).
                        size: { x: 100, y: 50 },
                        relativeTransform: [
                            [0, -1, 425],
                            [1, 0, 50],
                        ],
                        absoluteBoundingBox: bbox(425, 50, 50, 100),
                        fills: [solid(rgb(1, 0, 0.5))],
                    },
                ],
            },
            {
                id: '0:2',
                type: 'CANVAS',
                name: 'Components',
                children: [
                    {
                        id: '1:1',
                        type: 'COMPONENT_SET',
                        name: 'Button',
                        absoluteBoundingBox: bbox(0, 0, 360, 44),
                        componentPropertyDefinitions: {
                            Variant: {
                                type: 'VARIANT',
                                defaultValue: 'Primary',
                                variantOptions: ['Primary', 'Secondary'],
                            },
                            'Label#1:2': { type: 'TEXT', defaultValue: 'Button' },
                        },
                        children: [
                            variant('1:10', 'Variant=Primary', 0, rgb(0.31, 0.27, 0.9)),
                            variant('1:20', 'Variant=Secondary', 200, rgb(0.9, 0.9, 0.95)),
                        ],
                    },
                ],
            },
        ],
    },
};

const variables = {
    meta: {
        variableCollections: {
            'VariableCollectionId:theme': {
                name: 'Theme',
                defaultModeId: 'm:light',
                modes: [
                    { modeId: 'm:light', name: 'Light' },
                    { modeId: 'm:dark', name: 'Dark' },
                ],
            },
            'VariableCollectionId:space': {
                name: 'Space',
                defaultModeId: 'm:one',
                modes: [{ modeId: 'm:one', name: 'Value' }],
            },
        },
        variables: {
            'VariableID:surface': {
                name: 'color/surface',
                resolvedType: 'COLOR',
                scopes: ['ALL_SCOPES'],
                variableCollectionId: 'VariableCollectionId:theme',
                valuesByMode: { 'm:light': rgb(1, 1, 1), 'm:dark': rgb(0.07, 0.07, 0.1) },
            },
            'VariableID:space-md': {
                name: 'spacing/md',
                resolvedType: 'FLOAT',
                scopes: ['GAP'],
                variableCollectionId: 'VariableCollectionId:space',
                valuesByMode: { 'm:one': 16 },
            },
        },
    },
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const run = () =>
    importFigma(
        { file, variables, images: { abc123: { bytes: PNG, ext: 'png' } } },
        { name: 'App' },
    );

describe('Figma import (spec §11)', () => {
    it('imports auto layout as flex frames, with variable bindings as tokens', () => {
        const { project } = run();
        const page = project.pages.find((p) => p.name === 'Screens')!;
        const home = page.children[0]!;
        expect(home).toMatchObject({
            type: 'frame',
            name: 'Home / Mobile',
            width: 375,
            height: 812,
            clip: true,
            fill: { color: '#ffffff', token: '{color.surface}' },
            layout: {
                mode: 'flex',
                direction: 'column',
                gap: { value: 16, token: '{spacing.md}' },
                padding: [{ value: 24 }, { value: 24 }, { value: 24 }, { value: 24 }],
            },
        });
        const title = findNode(page.children, 't_10_2')!;
        expect(title).toMatchObject({
            type: 'text',
            content: 'Welcome',
            fontWeight: 700,
            box: 'fixed-width',
            sizing: { h: 'fill', v: 'hug' },
            x: 24,
            y: 24,
        });
        expect(findNode(page.children, 'p_10_5')).toMatchObject({
            type: 'shape',
            kind: 'path',
            d: 'M0 12L9 21L24 3',
            position: 'absolute',
        });
    });

    it('imports a component set with variant axes and a text prop', () => {
        const { project } = run();
        const [set] = project.components[0]!.sets;
        expect(project.components[0]!.file).toBe('components/figma.svg');
        expect(set).toMatchObject({
            id: 'c_button',
            name: 'Button',
            isSet: true,
            props: { variant: ['Primary', 'Secondary'], label: 'text' },
            defaultVariant: 'variant=Primary',
        });
        expect(set!.variants.map((v) => [v.id, v.variant])).toEqual([
            ['c_button__primary', 'variant=Primary'],
            ['c_button__secondary', 'variant=Secondary'],
        ]);
        expect(set!.variants[0]!.layout).toMatchObject({
            mode: 'flex',
            direction: 'row',
            justify: 'center',
            align: 'center',
        });
        const label = set!.variants[0]!.children[0]!;
        expect(label).toMatchObject({ type: 'text', prop: 'label', x: 55, y: 12 });
        // Canvases holding only components become the component file, not a page.
        expect(project.pages.map((p) => p.name)).toEqual(['Screens']);
    });

    it('imports instances with their variant and text overrides', () => {
        const { project } = run();
        const page = project.pages[0]!;
        const cta = findNode(page.children, 'i_10_3')!;
        const label = project.components[0]!.sets[0]!.variants[0]!.children[0]!;
        expect(cta).toMatchObject({
            type: 'instance',
            href: '../components/figma.svg#c_button',
            variant: 'variant=Primary',
            overrides: [{ target: label.id, text: 'Continue' }],
        });
        // End to end: the flattened export renders the overridden label.
        expect(exportPageSvg(project, page)).toContain('Continue');
    });

    it('keeps images, rotation and what it could not map — with warnings', () => {
        const { project, warnings } = run();
        const page = project.pages[0]!;
        const hero = findNode(page.children, 'img_10_4')!;
        expect(hero).toMatchObject({
            type: 'image',
            href: '../assets/images/figma-abc123.png',
            fit: 'cover',
        });
        expect(project.assets['assets/images/figma-abc123.png']).toEqual(PNG);
        expect(findNode(page.children, 'e_11_1')).toMatchObject({
            width: 100,
            height: 50,
            rotation: 90,
            x: 400, // centre (450, 100) minus half the unrotated size
            y: 75,
        });
        expect(findNode(page.children, 'f_10_6')).toMatchObject({
            type: 'frame',
            name: 'Library badge',
        });
        expect(warnings.join('\n')).toMatch(/library component/);
        expect(warnings.join('\n')).toMatch(/slice/);
    });

    it('turns variables into tokens, with modes as themes', () => {
        const { project } = run();
        expect(project.manifest.tokens).toEqual(['tokens/figma.tokens.json']);
        expect(project.manifest.themes).toEqual({
            light: ['tokens/themes/light.tokens.json'],
            dark: ['tokens/themes/dark.tokens.json'],
        });
        const base = project.tokens['tokens/figma.tokens.json'] as Record<
            string,
            Record<string, unknown>
        >;
        expect(base['spacing']!['md']).toEqual({
            $type: 'dimension',
            $value: { value: 16, unit: 'px' },
        });
        const dark = project.tokens['tokens/themes/dark.tokens.json'] as Record<
            string,
            Record<string, Record<string, unknown>>
        >;
        expect(dark['color']!['surface']!['$value']).toMatchObject({ hex: '#12121a' });
        const { project: plain, warnings } = importFigma({ file, variables: null });
        expect(plain.manifest.tokens).toEqual([]);
        expect(warnings[0]).toMatch(/variables were not available/);
    });

    it('produces a valid project that round-trips', () => {
        const { project } = run();
        expect(validateProject(project).filter((i) => i.severity === 'error')).toEqual([]);
        const files = writeProject(project);
        expect(writeProject(readProject(files))).toEqual(files);
        expect(project.manifest).toMatchObject({ name: 'App', id: 'urn:figma:mobile-app' });
    });
});
