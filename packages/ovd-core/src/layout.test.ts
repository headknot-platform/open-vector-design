import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { instanceContent } from './components';
import { applyConstraints, layoutNode } from './layout';
import { type FrameNode, createFrame, createShape, defaultLayout, type TextNode } from './model';
import { readProject } from './project';
import { type Measure } from './text';
import { layerTokens, resolveTokens } from './tokens';

const box = (id: string, w: number, h: number, extra = {}) =>
    createShape(id, 'rect', { width: w, height: h, ...extra });

function flex(init: Partial<FrameNode['layout']> = {}, frame: Partial<FrameNode> = {}): FrameNode {
    return createFrame('f', {
        width: 200,
        height: 100,
        layout: { ...defaultLayout(), mode: 'flex', direction: 'row', ...init },
        ...frame,
    });
}

const pad = (n: number) =>
    [{ value: n }, { value: n }, { value: n }, { value: n }] as FrameNode['layout']['padding'];

describe('flex layout (spec §6)', () => {
    it('places children in a row with gap and padding', () => {
        const f = flex(
            { gap: { value: 10 }, padding: pad(5) },
            { children: [box('a', 20, 10), box('b', 30, 10)] },
        );
        layoutNode(f);
        expect(f.children.map((c) => [c.x, c.y])).toEqual([
            [5, 5],
            [35, 5],
        ]);
    });

    it('centres on both axes', () => {
        const f = flex(
            { justify: 'center', align: 'center' },
            { children: [box('a', 20, 10), box('b', 20, 10)] },
        );
        layoutNode(f);
        expect(f.children.map((c) => [c.x, c.y])).toEqual([
            [80, 45],
            [100, 45],
        ]);
    });

    it('distributes space-between', () => {
        const f = flex(
            { justify: 'space-between' },
            { children: [box('a', 20, 10), box('b', 20, 10), box('c', 20, 10)] },
        );
        layoutNode(f);
        expect(f.children.map((c) => c.x)).toEqual([0, 90, 180]);
    });

    it('grows a hug frame when a child is added', () => {
        const f = flex(
            { gap: { value: 10 }, padding: pad(8) },
            { sizing: { h: 'hug', v: 'hug' }, children: [box('a', 20, 10)] },
        );
        layoutNode(f);
        expect([f.width, f.height]).toEqual([36, 26]);
        f.children.push(box('b', 40, 30));
        layoutNode(f);
        expect([f.width, f.height]).toEqual([86, 46]);
    });

    it('shares remaining space between fill children', () => {
        const f = flex(
            { gap: { value: 10 } },
            {
                children: [
                    box('a', 50, 10),
                    box('b', 0, 10, { sizing: { h: 'fill', v: 'fixed' } }),
                    box('c', 0, 10, { sizing: { h: 'fill', v: 'fixed' } }),
                ],
            },
        );
        layoutNode(f);
        expect(f.children.map((c) => [c.x, c.width])).toEqual([
            [0, 50],
            [60, 65],
            [135, 65],
        ]);
    });

    it('stretches on the cross axis', () => {
        const f = flex(
            { direction: 'column', align: 'stretch', padding: pad(10) },
            { children: [box('a', 20, 10)] },
        );
        layoutNode(f);
        expect(f.children[0]!.width).toBe(180);
    });

    it('wraps onto a new line', () => {
        const f = flex(
            { wrap: true, gap: { value: 10 } },
            { width: 100, children: [box('a', 60, 10), box('b', 60, 20), box('c', 20, 10)] },
        );
        layoutNode(f);
        expect(f.children.map((c) => [c.x, c.y])).toEqual([
            [0, 0],
            [0, 20],
            [70, 20],
        ]);
    });

    it('leaves absolute children out of the flow', () => {
        const f = flex(
            {},
            {
                children: [
                    box('abs', 10, 10, { position: 'absolute', x: 150, y: 50 }),
                    box('a', 20, 10),
                ],
            },
        );
        layoutNode(f);
        expect(f.children.map((c) => [c.x, c.y])).toEqual([
            [150, 50],
            [0, 0],
        ]);
    });

    it('resolves a token-bound gap', () => {
        const tokens = resolveTokens(
            layerTokens({ t: { gap: { $type: 'dimension', $value: { value: 12, unit: 'px' } } } }, [
                't',
            ]),
        );
        const f = flex(
            { gap: { value: 0, token: '{gap}' } },
            { children: [box('a', 20, 10), box('b', 20, 10)] },
        );
        layoutNode(f, { tokens });
        expect(f.children[1]!.x).toBe(32);
    });
});

describe('constraints (spec §6)', () => {
    it('moves, stretches, centres and scales children when the frame resizes', () => {
        const f = createFrame('f', {
            width: 100,
            height: 100,
            children: [
                box('r', 10, 10, { x: 80, constraints: { h: 'right', v: 'top' } }),
                box('lr', 80, 10, { x: 10, constraints: { h: 'left-right', v: 'top' } }),
                box('c', 20, 20, { x: 40, y: 40, constraints: { h: 'center', v: 'center' } }),
                box('s', 50, 50, { x: 50, y: 50, constraints: { h: 'scale', v: 'scale' } }),
            ],
        });
        f.width = 200;
        f.height = 200;
        applyConstraints(f, 100, 100);
        expect(f.children.map((c) => [c.x, c.y, c.width, c.height])).toEqual([
            [180, 0, 10, 10],
            [10, 0, 180, 10],
            [90, 90, 20, 20],
            [100, 100, 100, 100],
        ]);
    });
});

describe('instanceContent (spec §5)', () => {
    const root = join(__dirname, '../../../examples/starter');
    const files: Record<string, string> = {};
    const visit = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) visit(full);
            else files[relative(root, full).split('\\').join('/')] = readFileSync(full, 'utf8');
        }
    };
    visit(root);
    const project = readProject(files);
    const measure: Measure = (s) => s.length * 8;

    it('applies text overrides and re-lays the variant out at the instance size', () => {
        const content = instanceContent(
            project,
            'pages/onboarding.svg',
            {
                href: '../components/button.svg#c_button',
                variant: 'variant=primary,size=md',
                overrides: [{ target: 'label', text: 'Get started', extra: {} }],
                width: 342,
                height: 44,
            },
            { measure },
        )!;
        expect(content.variant.id).toBe('c_button__primary_md');
        const label = content.root.children[0] as TextNode;
        expect(label.content).toBe('Get started');
        expect(label.width).toBe(88);
        expect(label.x).toBe((342 - 88) / 2);
        // The source component is untouched.
        expect((content.variant.children[0] as TextNode).content).toBe('Button');
    });

    it('returns undefined for a missing component', () => {
        expect(
            instanceContent(project, 'pages/onboarding.svg', {
                href: '#nope',
                overrides: [],
                width: 1,
                height: 1,
            }),
        ).toBeUndefined();
    });
});
