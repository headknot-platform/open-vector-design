/** Export in the standalone editor (#68): the editor's browser export, downloaded. */
import { pageSvg, svgToPng, tokensFile, withFonts } from '@workspace/editor';
import { toast } from 'sonner';
import { download } from './local';

export function exportSvg(): void {
    const page = pageSvg();
    if (page) download(page.svg, page.name, 'image/svg+xml');
}

export async function exportPng(scale: number): Promise<void> {
    const page = pageSvg();
    if (!page) return;
    try {
        const { INTER } = await import('./fonts');
        const png = await svgToPng(withFonts(page.svg, INTER), scale);
        const name = page.name.replace(/\.svg$/, scale === 1 ? '.png' : `@${scale}x.png`);
        download(new Uint8Array(await png.arrayBuffer()), name, 'image/png');
    } catch (e) {
        toast.error('PNG export failed', { description: (e as Error)?.message ?? String(e) });
    }
}

export function exportTokens(format: 'json' | 'css'): void {
    const file = tokensFile(format);
    if (file) download(file.text, file.name, format === 'json' ? 'application/json' : 'text/css');
}
