import { editor } from '@workspace/editor';
import { exportPageSvg, tokensCss, tokensJson } from '@workspace/ovd-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requests } from '../test/setup';
import { exportSvg, exportTokens } from './exports';
import { newProject } from './local';

let downloads: { blob: Blob; name: string }[] = [];
beforeEach(() => {
    downloads = [];
    let last: Blob;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((last = b as Blob), 'blob:x'));
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
    ) {
        downloads.push({ blob: last, name: this.download });
    });
});

describe('standalone export (#68)', () => {
    it('downloads the page SVG and tokens exactly as the server serves them', async () => {
        newProject();
        editor().setPreviewTheme('dark');
        const { project, doc } = editor();
        const page = project!.pages.find((p) => p.file === doc!.file)!;

        exportSvg();
        exportTokens('json');
        exportTokens('css');
        expect(downloads.map((d) => d.name)).toEqual([
            'onboarding.svg',
            'tokens-dark.json',
            'tokens-dark.css',
        ]);
        const [svg, json, css] = await Promise.all(downloads.map((d) => d.blob.text()));
        expect(svg).toBe(exportPageSvg(project!, page, { theme: 'dark' }));
        expect(json).toBe(JSON.stringify(tokensJson(project!, 'dark')));
        expect(css).toBe(tokensCss(project!, 'dark'));
        expect(requests).toEqual([]);
    });
});
