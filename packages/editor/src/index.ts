/**
 * @workspace/editor — the OVD editor as an embeddable React component (epic #64).
 *
 * A host renders `<OvdEditor host={...} />`, loads a project with `editor().loadProject(...)`,
 * watches edits with `useEditor.subscribe(...)` and confirms a save with `editor().markSaved()`.
 * Everything that reaches outside the page — files, a server, accounts — is the host's.
 */
export { OvdEditor } from './OvdEditor';
export type {
    EditorHost,
    HostCommands,
    HostTool,
    LibraryStatus,
    MenuItem,
    ToolPointerEvent,
} from './host';
export {
    type EditorState,
    type Tool,
    type Viewport,
    editor,
    useEditor,
    useViewport,
} from './state/store';
export { type DocRef, docName, docRoots } from './lib/doc';
export { type Point, type Rect, absRect } from './lib/geometry';
export { toScreen } from './lib/viewport';
export { setUiTheme, useUiTheme } from './lib/ui-theme';
export { resetMeasureCache } from './lib/measure';
