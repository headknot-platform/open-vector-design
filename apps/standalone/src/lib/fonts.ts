/**
 * Inter for PNG export (#68). An SVG drawn as an image cannot use the page's fonts, so the export
 * embeds these as data: URLs. Loaded lazily — only the first PNG export pays for them.
 */
import type { FontSource } from '@workspace/editor';
import w300 from '@fontsource/inter/files/inter-latin-300-normal.woff2?inline';
import w400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?inline';
import w500 from '@fontsource/inter/files/inter-latin-500-normal.woff2?inline';
import w600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?inline';
import w700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?inline';
import w800 from '@fontsource/inter/files/inter-latin-800-normal.woff2?inline';

export const INTER: FontSource[] = [
    [300, w300],
    [400, w400],
    [500, w500],
    [600, w600],
    [700, w700],
    [800, w800],
].map(([weight, src]) => ({ family: 'Inter', weight: weight as number, src: src as string }));
