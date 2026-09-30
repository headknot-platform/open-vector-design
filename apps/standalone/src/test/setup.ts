import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { cleanup } from '@testing-library/react';
import { useEditor } from '@workspace/editor';
import { afterEach } from 'vitest';

afterEach(() => {
    cleanup();
    useEditor.setState({
        project: null,
        savedProject: null,
        source: null,
        doc: null,
        past: [],
        future: [],
    });
});

/** Every attempted request, so a test can assert the editor made none. */
export const requests: string[] = [];
globalThis.fetch = (input: RequestInfo | URL) => {
    requests.push(String(input));
    throw new Error('The standalone editor made a network request');
};

// jsdom's Blob / File lack arrayBuffer() in places; Node's are what a browser would give.
Object.assign(globalThis, { Blob: NodeBlob, File: NodeFile });

// jsdom has no object URLs; downloads are observed through spies on these.
URL.createObjectURL ??= () => 'blob:test';
URL.revokeObjectURL ??= () => {};

window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
})) as typeof window.matchMedia;

globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
if (typeof globalThis.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
        pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 1;
        }
    }
    globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}
Element.prototype.setPointerCapture ??= function setPointerCapture() {};
Element.prototype.releasePointerCapture ??= function releasePointerCapture() {};
