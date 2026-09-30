/** Image import: bytes live under assets/images/, layers reference them by relative path (spec §9). */
import { createImage, relativePath } from '@workspace/ovd-core';
import { editor } from '../state/store';
import { insertNodes } from '../state/actions';
import type { Point } from './geometry';

const MAX_SIDE = 800;

function assetPath(name: string, taken: Set<string>): string {
    const dot = name.lastIndexOf('.');
    const ext = (dot > 0 ? name.slice(dot + 1) : 'png').toLowerCase().replace('jpeg', 'jpg');
    const base =
        (dot > 0 ? name.slice(0, dot) : name)
            .toLowerCase()
            .replace(/[^\w-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'image';
    let path = `assets/images/${base}.${ext}`;
    for (let i = 2; taken.has(path); i++) path = `assets/images/${base}-${i}.${ext}`;
    return path;
}

async function naturalSize(file: Blob): Promise<{ width: number; height: number }> {
    try {
        const bmp = await createImageBitmap(file);
        const size = { width: bmp.width, height: bmp.height };
        bmp.close();
        return size;
    } catch {
        return { width: 400, height: 300 };
    }
}

/** Adds image files to the project and places them (at `at`, or the viewport centre). */
export async function insertImageFiles(files: File[], at?: Point): Promise<void> {
    const images = files.filter((f) => f.type.startsWith('image/'));
    const s = editor();
    if (!images.length || !s.project || !s.doc) return;
    const taken = new Set(Object.keys(s.project.assets));
    const nodes = [];
    const assets: Record<string, Uint8Array> = {};
    let offset = 0;
    for (const file of images) {
        const path = assetPath(file.name || 'pasted.png', taken);
        taken.add(path);
        assets[path] = new Uint8Array(await file.arrayBuffer());
        const { width, height } = await naturalSize(file);
        const k = Math.min(1, MAX_SIDE / Math.max(width, height));
        const node = createImage('img', relativePath(s.doc.file, path), {
            name: file.name || 'Image',
            width: Math.round(width * k),
            height: Math.round(height * k),
            x: (at?.x ?? 0) + offset - (at ? Math.round((width * k) / 2) : 0),
            y: (at?.y ?? 0) + offset - (at ? Math.round((height * k) / 2) : 0),
        });
        nodes.push(node);
        offset += 24;
    }
    // Assets are part of the project; adding them and the layers is one undo step.
    editor().checkpoint();
    editor().update(
        (d) => {
            Object.assign(d.assets, assets);
        },
        { history: false },
    );
    insertNodes(nodes, { keepPosition: !!at, history: false });
}
