import { Button } from '@workspace/ui/components/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@workspace/ui/components/select';
import { listThemes } from '@workspace/ovd-core';
import { ArrowLeft, Minus, Moon, Plus, Sun } from 'lucide-react';
import { useHost } from '../host';
import { setUiTheme, useUiTheme } from '../lib/ui-theme';
import { docName } from '../lib/doc';
import { zoomBy, zoomToFit } from '../state/actions';
import { editor, useEditor, useViewport } from '../state/store';

/** The editor's own controls, with the host's status, actions and account menu in their slots. */
export function TopBar({ left }: { left?: React.ReactNode }) {
    const { topBar } = useHost();
    const project = useEditor((s) => s.project);
    const doc = useEditor((s) => s.doc);
    const vp = useViewport();
    const ui = useUiTheme();
    const themes = project ? listThemes(project.manifest) : [];
    const previewTheme = useEditor((s) => s.previewTheme);
    return (
        <header className="bg-background flex h-11 shrink-0 items-center gap-2 border-b px-2">
            <div className="flex items-center gap-1">{left}</div>
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-xs">
                {doc?.kind === 'component' && project && (
                    <button
                        className="hover:bg-accent text-muted-foreground mr-1 flex items-center gap-1 rounded px-1.5 py-0.5"
                        onClick={() => {
                            const back = editor().lastPage ?? project.pages[0]?.file;
                            if (back) editor().openDoc({ kind: 'page', file: back });
                        }}
                        title="Back to the page"
                    >
                        <ArrowLeft className="size-3.5" /> Back
                    </button>
                )}
                <span className="text-muted-foreground truncate">{project?.manifest.name}</span>
                <span className="text-muted-foreground">/</span>
                <span className="truncate font-medium">{project ? docName(project, doc) : ''}</span>
                {topBar?.status}
            </div>
            <div className="flex items-center gap-1">
                {topBar?.actions}
                {themes.length > 0 && (
                    <Select value={previewTheme} onValueChange={(v) => editor().setPreviewTheme(v)}>
                        <SelectTrigger
                            size="sm"
                            className="h-7 w-28 text-xs"
                            aria-label="Preview theme"
                            title="Token theme to preview"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {themes.map((t) => (
                                <SelectItem key={t} value={t} className="text-xs capitalize">
                                    {t}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => setUiTheme(ui === 'dark' ? 'light' : 'dark')}
                    aria-label={ui === 'dark' ? 'Light interface' : 'Dark interface'}
                    title="Editor light / dark"
                >
                    {ui === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => zoomBy(0.8)}
                    aria-label="Zoom out"
                >
                    <Minus className="size-3.5" />
                </Button>
                <button
                    className="hover:bg-accent w-12 rounded px-1 py-1 text-center text-xs tabular-nums"
                    onClick={() => zoomToFit()}
                    title="Zoom to fit (⇧1)"
                >
                    {Math.round(vp.zoom * 100)}%
                </button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => zoomBy(1.25)}
                    aria-label="Zoom in"
                >
                    <Plus className="size-3.5" />
                </Button>
                {topBar?.end}
            </div>
        </header>
    );
}
