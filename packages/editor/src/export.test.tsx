import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createImage, exportPageSvg, tokensJson } from '@workspace/ovd-core';
import { describe, expect, it } from 'vitest';
import { pageSvg, tokensFile, withFonts } from './lib/export';
import { OvdEditor } from './OvdEditor';
import { editor } from './state/store';
import { openStarter } from './test/starter';

describe('export and validation in the browser (#68)', () => {
    it('exports the open page and tokens exactly as the server does, in the previewed theme', () => {
        openStarter();
        act(() => editor().setPreviewTheme('dark'));
        const { project, doc } = editor();
        const page = project!.pages.find((p) => p.file === doc!.file)!;

        expect(pageSvg()).toEqual({
            name: 'onboarding.svg',
            svg: exportPageSvg(project!, page, { theme: 'dark' }),
        });
        expect(tokensFile('json')).toEqual({
            name: 'tokens-dark.json',
            text: JSON.stringify(tokensJson(project!, 'dark')),
        });
        expect(tokensFile('css')!.text.startsWith(':root {')).toBe(true);
    });

    it('embeds fonts as @font-face rules for PNG rendering', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text/></svg>';
        const out = withFonts(svg, [
            { family: 'Inter', weight: 600, src: 'data:font/woff2;base64,AA' },
        ]);
        expect(out).toBe(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>@font-face{font-family:\'Inter\';font-weight:600;font-style:normal;src:url(data:font/woff2;base64,AA)}</style><text/></svg>',
        );
        expect(withFonts(svg, [])).toBe(svg);
    });

    it('validates from the File menu and jumps to the problem', async () => {
        const user = userEvent.setup();
        openStarter();
        // An inline data: image is an error outside exports (spec §9).
        act(() =>
            editor().update((d) => {
                d.pages[1]!.children.push(createImage('i_inline', 'data:image/png;base64,AA'));
            }),
        );
        render(<OvdEditor />);
        await user.click(screen.getByRole('button', { name: 'File menu' }));
        await user.click(await screen.findByRole('menuitem', { name: /Validate project/ }));
        const dialog = await screen.findByRole('dialog', { name: 'Validation' });
        expect(dialog).toHaveTextContent(/1 error\(s\)/);
        const problems = within(dialog).getByRole('list', { name: 'Problems' });
        await user.click(within(problems).getByText(/data: URIs/));
        expect(editor().doc).toEqual({ kind: 'page', file: 'pages/dashboard.svg' });
        expect(editor().selection).toEqual(['i_inline']);
        expect(screen.queryByRole('dialog', { name: 'Validation' })).toBeNull();
    });
});
