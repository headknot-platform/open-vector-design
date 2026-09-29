import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type FileMap, readProject, writeProject } from './project';
import { readPage } from './read';
import { writePage } from './write';

const STARTER = join(__dirname, '../../../examples/starter');

function loadDir(root: string): FileMap {
    const out: FileMap = {};
    const visit = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) visit(full);
            else out[relative(root, full).split('\\').join('/')] = readFileSync(full, 'utf8');
        }
    };
    visit(root);
    return out;
}

describe('starter project round-trip', () => {
    const files = loadDir(STARTER);

    it('reproduces every canonical file byte-for-byte', () => {
        const out = writeProject(readProject(files));
        for (const [path, content] of Object.entries(files)) {
            expect(out[path], path).toBe(content);
        }
        expect(Object.keys(out).sort()).toEqual(Object.keys(files).sort());
    });

    it('is stable across repeated parse → serialise cycles', () => {
        const once = writeProject(readProject(files));
        const twice = writeProject(readProject(once));
        expect(twice).toEqual(once);
    });

    it('reads the model the files describe', () => {
        const project = readProject(files);
        expect(project.pages.map((p) => p.name)).toEqual(['Onboarding', 'Dashboard']);
        const welcome = project.pages[0]!.children[0]!;
        expect(welcome).toMatchObject({
            type: 'frame',
            id: 'f_welcome',
            width: 390,
            height: 844,
            clip: true,
            title: 'Welcome screen',
            fill: { color: '#ffffff', token: '{color.surface}' },
        });
        const button = project.components.find((c) => c.file === 'components/button.svg')!;
        expect(button.sets[0]!.variants.map((v) => v.variant)).toEqual([
            'variant=primary,size=md',
            'variant=secondary,size=md',
            'variant=primary,size=sm',
            'variant=secondary,size=sm',
        ]);
        expect(button.sets[0]!.props).toEqual({
            variant: ['primary', 'secondary'],
            size: ['md', 'sm'],
            label: 'text',
        });
    });
});

describe('unknown data is preserved (principle 6)', () => {
    const source = [
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:foo="https://example.com/foo" xmlns:ovd="https://ovd.dev/ns/0.1" ovd:type="page" ovd:name="P" ovd:version="0.1" foo:root="1" viewBox="0 0 1 1">',
        '  <defs>',
        '    <linearGradient id="lg">',
        '      <stop offset="0"/>',
        '    </linearGradient>',
        '  </defs>',
        '  <rect id="r1" ovd:name="R" foo:bar="baz" fill="url(#lg)" height="10" width="10" x="0" y="0"/>',
        '  <foreignObject id="fo" height="10" width="10">',
        '    <!-- kept -->',
        '    <div xmlns="http://www.w3.org/1999/xhtml">hi</div>',
        '  </foreignObject>',
        '</svg>',
    ].join('\n');

    it('keeps foreign attributes, elements and comments', () => {
        const out = writePage(readPage('pages/p.svg', source));
        expect(out).toContain('foo:bar="baz"');
        expect(out).toContain('foo:root="1"');
        expect(out).toContain('xmlns:foo="https://example.com/foo"');
        expect(out).toContain('<linearGradient id="lg">');
        expect(out).toContain('<!-- kept -->');
        expect(out).toContain('<div xmlns="http://www.w3.org/1999/xhtml">hi</div>');
    });

    it('keeps an unknown element in its z-order position', () => {
        const page = readPage('pages/p.svg', source);
        expect(page.children.map((c) => c.type)).toEqual(['shape', 'raw']);
    });
});
