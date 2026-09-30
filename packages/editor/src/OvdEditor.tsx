import { TooltipProvider } from '@workspace/ui/components/tooltip';
import { useEffect } from 'react';
import { Canvas } from './canvas/Canvas';
import { FileMenu } from './editor/FileMenu';
import { Toolbar } from './editor/Toolbar';
import { TopBar } from './editor/TopBar';
import { type EditorHost, type HostTool, HostProvider } from './host';
import { useShortcuts } from './hooks/useShortcuts';
import { resetMeasureCache } from './lib/measure';
import { LeftPanel } from './panels/LeftPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { useEditor } from './state/store';

// A constant, not `?? []`: a fresh array each render would re-bind every shortcut listener.
const NO_TOOLS: HostTool[] = [];

/**
 * The OVD editor: canvas, tools and panels for the project in the store. It saves nothing and
 * fetches nothing — the host loads a project with `editor().loadProject(...)`, watches changes with
 * `useEditor.subscribe(...)`, and plugs its own features in through `host` (see host.tsx).
 */
export function OvdEditor({ host = {} }: { host?: EditorHost }) {
    const project = useEditor((s) => s.project);
    useShortcuts(host.commands, host.tools ?? NO_TOOLS);

    useEffect(() => {
        // Text measured before web fonts arrived used fallback metrics.
        document.fonts?.ready.then(resetMeasureCache).catch(() => {});
    }, []);

    if (!project) return null;
    return (
        <HostProvider value={host}>
            <TooltipProvider delayDuration={400}>
                <div className="flex h-full flex-col">
                    {host.overlays}
                    <TopBar
                        left={
                            <>
                                <FileMenu />
                                <Toolbar />
                            </>
                        }
                    />
                    <div className="flex min-h-0 flex-1">
                        <aside className="bg-background w-60 shrink-0 border-r" aria-label="Layers">
                            <LeftPanel />
                        </aside>
                        <main className="min-w-0 flex-1">
                            <Canvas />
                        </main>
                        <aside
                            className="bg-background w-64 shrink-0 border-l"
                            aria-label="Properties"
                        >
                            <PropertiesPanel />
                        </aside>
                    </div>
                </div>
            </TooltipProvider>
        </HostProvider>
    );
}
