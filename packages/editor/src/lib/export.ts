/**
 * Export in the browser (#68), for hosts without a server. These return data — the host decides
 * where it goes (a download, a folder). The SVG and the tokens come from the same ovd-core
 * functions the server's export routes call, so the bytes match; PNG is the browser's own render.
 */
import {
    type Page,
    type Project,
    basename,
    exportPageSvg,
    tokensCss,
    tokensJson,
} from '@workspace/ovd-core';
import { editor } from '../state/store';

/** A font for PNG export. `src` must be a `data:` URL: an SVG drawn as an image loads nothing. */
export interface FontSource {
    family: string;
    weight: number;
    style?: 'normal' | 'italic';
    src: string;
}

/** The open page (the first page while a component is open) and the previewed theme. */
function current(): { project: Project; page: Page; theme: string | undefined } | null {
    const { project, doc, previewTheme } = editor();
    const page = project?.pages.find((p) => p.file === doc?.file) ?? project?.pages[0];
    return project && page ? { project, page, theme: previewTheme } : null;
}

/** The open page as a flattened SVG in the previewed theme — what `/export/pages/<name>.svg` serves. */
export function pageSvg(): { name: string; svg: string } | null {
    const cur = current();
    if (!cur) return null;
    return {
        name: basename(cur.page.file),
        svg: exportPageSvg(cur.project, cur.page, { theme: cur.theme }),
    };
}

/** Embeds `fonts` as `@font-face` rules, so a rasterised SVG draws with them. */
export function withFonts(svg: string, fonts: FontSource[]): string {
    if (!fonts.length) return svg;
    const faces = fonts
        .map(
            (f) =>
                `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:${f.style ?? 'normal'};src:url(${f.src})}`,
        )
        .join('');
    return svg.replace(/<svg\b[^>]*>/, (open) => `${open}<style>${faces}</style>`);
}

/** Renders an SVG to a PNG at `scale` times its viewBox size. */
export async function svgToPng(svg: string, scale = 2): Promise<Blob> {
    const box =
        /viewBox="([^"]+)"/
            .exec(svg)?.[1]
            ?.split(/[\s,]+/)
            .map(Number) ?? [];
    const [w, h] = [box[2] ?? 1000, box[3] ?? 1000];
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
        if (!blob) throw new Error('The browser could not encode the PNG');
        return blob;
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** The previewed theme's tokens — DTCG JSON as `/export/tokens.json` serves it, or CSS variables. */
export function tokensFile(format: 'json' | 'css'): { name: string; text: string } | null {
    const cur = current();
    if (!cur) return null;
    const suffix = cur.theme ? `-${cur.theme}` : '';
    return format === 'json'
        ? { name: `tokens${suffix}.json`, text: JSON.stringify(tokensJson(cur.project, cur.theme)) }
        : { name: `tokens${suffix}.css`, text: tokensCss(cur.project, cur.theme) };
}
