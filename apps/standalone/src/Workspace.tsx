/** The editor with the standalone host: local files, browser autosave, no server. */
import { type EditorHost, OvdEditor, useEditor } from '@workspace/editor';
import { useEffect, useMemo } from 'react';
import { startAutosave } from './lib/autosave';
import { exportPng, exportSvg, exportTokens } from './lib/exports';
import {
    canOpenFolders,
    closeProject,
    downloadArchive,
    newProject,
    openFolder,
    openFolderHandle,
    save,
    saveAsFolder,
    useLocal,
} from './lib/local';
import { usePickers } from './Pickers';

function SaveState() {
    const folder = useLocal((s) => s.folder);
    const saving = useLocal((s) => s.saving);
    const dirty = useEditor((s) => s.project !== s.savedProject);
    const text = saving
        ? 'Saving…'
        : folder
          ? dirty
              ? `Unsaved — ⌘S saves to ${folder}`
              : `Saved to ${folder}`
          : dirty
            ? 'Kept in this browser — ⌘S downloads a .tar.gz'
            : 'Downloaded';
    return (
        <span role="status" className="text-muted-foreground ml-1 truncate text-[11px]">
            {text}
        </span>
    );
}

export function Workspace() {
    const pickers = usePickers();
    const folder = useLocal((s) => s.folder);

    useEffect(() => startAutosave(openFolderHandle), []);

    const commands = useMemo(
        () => ({
            save: () => void save(),
            open: canOpenFolders ? () => void openFolder() : () => void closeProject(),
            exportPage: exportSvg,
        }),
        [],
    );

    const host: EditorHost = {
        commands,
        fileMenu: {
            logo: '/favicon.svg',
            sections: [
                [
                    { label: 'New project', onSelect: newProject },
                    canOpenFolders
                        ? {
                              label: 'Open folder…',
                              shortcut: '⌘O',
                              onSelect: () => void openFolder(),
                          }
                        : { label: 'Open folder (copy)…', onSelect: pickers.pickUpload },
                    { label: 'Open .tar.gz…', onSelect: pickers.pickArchive },
                    { label: 'Import Sketch file…', onSelect: pickers.pickSketch },
                ],
                [
                    {
                        label: folder ? `Save to ${folder}` : 'Save (download .tar.gz)',
                        shortcut: '⌘S',
                        onSelect: () => void save(),
                    },
                    ...(canOpenFolders
                        ? [{ label: 'Save to folder…', onSelect: () => void saveAsFolder() }]
                        : []),
                    { label: 'Download .tar.gz', onSelect: downloadArchive },
                ],
                [
                    { label: 'Export page as SVG', shortcut: '⇧⌘E', onSelect: exportSvg },
                    { label: 'Export page as PNG (1×)', onSelect: () => void exportPng(1) },
                    { label: 'Export page as PNG (2×)', onSelect: () => void exportPng(2) },
                    { label: 'Export tokens (JSON)', onSelect: () => exportTokens('json') },
                    { label: 'Export tokens (CSS)', onSelect: () => exportTokens('css') },
                ],
                [{ label: 'Close project', onSelect: () => void closeProject() }],
            ],
        },
        topBar: { status: <SaveState /> },
        overlays: pickers.inputs,
    };

    return <OvdEditor host={host} />;
}
