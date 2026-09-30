import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportAll, exportPageSvg, packageFiles, toBase64 } from './export';
import { createImage } from './model';
import { readProject } from './project';
import { parseXml } from './xml';

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

describe('flattened export (spec §5, §11 level 1)', () => {
    const project = readProject(files);
    const page = project.pages[0]!;

    it('leaves no OVD markup, no <use> and no var() behind', () => {
        const svg = exportPageSvg(project, page);
        expect(svg).not.toMatch(/ovd:/);
        expect(svg).not.toContain('<use');
        expect(svg).not.toContain('var(');
        expect(() => parseXml(svg)).not.toThrow();
    });

    it('inlines component content with overrides applied', () => {
        const svg = exportPageSvg(project, page);
        expect(svg).toContain('>Get started</tspan>');
        expect(svg).toContain('>I already have an account</tspan>');
        expect(svg).not.toContain('>Button</tspan>');
    });

    it('resolves tokens for the requested theme', () => {
        expect(exportPageSvg(project, page)).toContain('fill="#4f46e5"');
        expect(exportPageSvg(project, page, { theme: 'dark' })).toContain('fill="#818cf8"');
    });

    it('names top-level frames for assistive tech and viewers', () => {
        expect(exportPageSvg(project, page)).toContain('aria-label="Welcome / Mobile"');
    });

    it('keeps prototype links as plain SVG links', () => {
        expect(exportPageSvg(project, page)).toContain('<a href="#f_signin">');
    });

    it('inlines images as data URIs (only allowed in exports, spec §9)', () => {
        const withImage = {
            ...project,
            assets: { 'assets/images/dot.png': new Uint8Array([137, 80, 78, 71]) },
            pages: [
                {
                    ...page,
                    children: [
                        createImage('img_1', '../assets/images/dot.png', { width: 1, height: 1 }),
                    ],
                },
            ],
        };
        expect(exportPageSvg(withImage, withImage.pages[0]!)).toContain(
            'href="data:image/png;base64,iVBORw=="',
        );
    });

    it('names exports after their pages in the manifest exports folder', () => {
        expect(Object.keys(exportAll(project))).toEqual([
            'exports/onboarding.svg',
            'exports/dashboard.svg',
        ]);
    });

    it('drops exports no page produces any more, and keeps other files it does not know', () => {
        const p = readProject({ ...files, 'exports/deleted.svg': '<svg/>', 'README.md': '# Hi' });
        const out = packageFiles(p);
        expect(out['exports/deleted.svg']).toBeUndefined();
        expect(out['README.md']).toBe('# Hi');
        expect(
            Object.keys(out)
                .filter((k) => k.startsWith('exports/'))
                .sort(),
        ).toEqual(Object.keys(exportAll(p)).sort());
    });
});

describe('toBase64', () => {
    it.each([
        ['', ''],
        ['f', 'Zg=='],
        ['fo', 'Zm8='],
        ['foo', 'Zm9v'],
        ['foob', 'Zm9vYg=='],
    ])('%j → %s', (s, b64) => {
        expect(toBase64(new TextEncoder().encode(s))).toBe(b64);
    });
});
