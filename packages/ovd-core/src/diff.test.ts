import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffProjects, formatDiff } from './diff';
import { type TextNode, findNode } from './model';
import { readProject, writeProject } from './project';

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

describe('ovd diff (spec §10)', () => {
    it('reports nothing for a re-formatted copy', () => {
        const a = readProject(files);
        expect(diffProjects(a, readProject(writeProject(a)))).toEqual([]);
    });

    it('describes element changes by id, in words', () => {
        const a = readProject(files);
        const b = readProject(files);
        const page = b.pages[0]!.children;
        const hero = findNode(page, 'r_hero')!;
        hero.x = 40;
        (hero as { fill?: { color: string; token?: string } }).fill = {
            color: '#ffffff',
            token: '{color.surface}',
        };
        (findNode(page, 't_heading') as TextNode).content = 'Hello';
        const cta = findNode(page, 'i_cta')!;
        if (cta.type === 'instance') cta.overrides[0]!.text = 'Go';
        const out = formatDiff(diffProjects(a, b));
        expect(out).toContain('M pages/onboarding.svg');
        expect(out).toContain(
            '~ Hero (r_hero): moved 24,96 → 40,96, fill {color.surface-muted} → {color.surface}',
        );
        expect(out).toContain('~ Heading (t_heading): text "Welcome to OVD" → "Hello"');
        expect(out).toContain('~ Get started (i_cta): label text "Get started" → "Go"');
    });

    it('reports added and removed layers, files and token changes', () => {
        const a = readProject(files);
        const b = readProject(files);
        b.pages[0]!.children.pop();
        b.pages.splice(1, 1);
        (b.tokens['tokens/base.tokens.json'] as { color: { primary: unknown } }).color.primary = {
            $value: '#000000',
        };
        const out = formatDiff(diffProjects(a, b));
        expect(out).toContain('- Sign in / Mobile (f_signin): frame');
        expect(out).toContain('D pages/dashboard.svg');
        expect(out).toMatch(/~ color\.primary: .*#4f46e5.* → #000000/);
        expect(out).toContain('M manifest.json');
    });
});
