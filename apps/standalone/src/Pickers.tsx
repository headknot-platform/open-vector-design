/** Hidden file inputs for the pickers both screens offer: a folder upload, an archive, a .sketch. */
import { useRef } from 'react';
import { importSketchFile, openArchive, openUpload } from './lib/local';

export function usePickers() {
    const folder = useRef<HTMLInputElement>(null);
    const archive = useRef<HTMLInputElement>(null);
    const sketch = useRef<HTMLInputElement>(null);
    const take = (e: React.ChangeEvent<HTMLInputElement>, fn: (files: FileList) => unknown) => {
        const files = e.target.files;
        if (files?.length) void fn(files);
        e.target.value = '';
    };
    return {
        pickUpload: () => folder.current?.click(),
        pickArchive: () => archive.current?.click(),
        pickSketch: () => sketch.current?.click(),
        inputs: (
            <>
                <input
                    ref={folder}
                    type="file"
                    hidden
                    aria-label="Package folder"
                    {...{ webkitdirectory: '' }}
                    onChange={(e) => take(e, openUpload)}
                />
                <input
                    ref={archive}
                    type="file"
                    hidden
                    aria-label="Package archive"
                    accept=".gz,.tgz,application/gzip"
                    onChange={(e) => take(e, (f) => openArchive(f[0]!))}
                />
                <input
                    ref={sketch}
                    type="file"
                    hidden
                    aria-label="Sketch file"
                    accept=".sketch"
                    onChange={(e) => take(e, (f) => importSketchFile(f[0]!))}
                />
            </>
        ),
    };
}
