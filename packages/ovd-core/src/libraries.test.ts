import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInstance } from './components';
import { exportPageSvg } from './export';
import { readDir } from './node';
import { type FileMap, readProject, writeProject } from './project';
import { validateProject } from './validate';

const STARTER = join(__dirname, '../../../examples/starter');

/** The starter with its buttons taken from a `core-ui` library instead of its own file. */
function host(): FileMap {
    const files = readDir(STARTER) as Record<string, string>;
    const out: FileMap = { ...files };
    delete out['components/button.svg'];
    out['pages/onboarding.svg'] = files['pages/onboarding.svg']!.replaceAll(
        'href="../components/button.svg#c_button"',
        'href="core-ui:button.svg#c_button"',
    );
    const manifest = JSON.parse(files['manifest.json']!);
    manifest.libraries = [
        { name: 'core-ui', url: 'https://github.com/acme/core-ui-ovd', ref: 'v1.2.0' },
    ];
    out['manifest.json'] = JSON.stringify(manifest);
    return out;
}
const library = () => readProject(readDir(STARTER));

describe('manifest libraries (#42, spec §3/§5)', () => {
    it('warns when a library is not loaded, and renders nothing for it', () => {
        const project = readProject(host());
        const page = project.pages[0]!;
        const issues = validateProject(project).filter((i) => i.id === 'i_cta');
        expect(issues).toEqual([
            expect.objectContaining({
                severity: 'warning',
                message: expect.stringMatching(/not loaded/),
            }),
        ]);
        expect(exportPageSvg(project, page)).not.toContain('Get started');
    });

    it('resolves library instances once the library is loaded — in exports and validation', () => {
        const project = { ...readProject(host()), libraries: { 'core-ui': library() } };
        const page = project.pages[0]!;
        const cta = page.children
            .flatMap((f) => ('children' in f ? f.children : []))
            .find((n) => n.id === 'i_cta')!;
        const resolved = resolveInstance(project, page.file, cta as never);
        expect(resolved?.set.id).toBe('c_button');
        expect(resolved?.file.file).toBe('core-ui:components/button.svg');
        const svg = exportPageSvg(project, page);
        expect(svg).toContain('Get started');
        expect(svg).toContain('Sign in');
        expect(validateProject(project).filter((i) => i.id === 'i_cta')).toEqual([]);
    });

    it('accepts the explicit components/ path, and reports ids a loaded library lacks', () => {
        const files = host();
        files['pages/onboarding.svg'] = (files['pages/onboarding.svg'] as string)
            .replace(
                'href="core-ui:button.svg#c_button"',
                'href="core-ui:components/button.svg#c_button"',
            )
            .replace('href="core-ui:button.svg#c_button"', 'href="core-ui:button.svg#c_nope"');
        const project = { ...readProject(files), libraries: { 'core-ui': library() } };
        const issues = validateProject(project).filter((i) => i.file === 'pages/onboarding.svg');
        expect(issues).toEqual([
            expect.objectContaining({
                severity: 'error',
                message: expect.stringMatching(/not in library core-ui/),
            }),
        ]);
    });

    it('never writes loaded libraries into the package', () => {
        const plain = readProject(host());
        expect(writeProject({ ...plain, libraries: { 'core-ui': library() } })).toEqual(
            writeProject(plain),
        );
    });
});
