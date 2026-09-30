/**
 * The free, standalone OVD Editor (#69): the editor plus local files. No account, no server, no
 * network — projects live in folders on disk, in `.tar.gz` archives, and in this browser.
 */
import { useEditor, useUiTheme } from '@workspace/editor';
import { Toaster } from '@workspace/ui/components/sonner';
import { StartScreen } from './StartScreen';
import { Workspace } from './Workspace';

export default function App() {
    const open = useEditor((s) => !!s.project);
    const ui = useUiTheme();
    return (
        <>
            {open ? <Workspace /> : <StartScreen />}
            <Toaster position="bottom-center" theme={ui} />
        </>
    );
}
