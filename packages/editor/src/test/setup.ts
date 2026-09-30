import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { useEditor } from '../state/store';

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(() => {
    cleanup();
    useEditor.setState({
        project: null,
        savedProject: null,
        source: null,
        doc: null,
        selection: [],
        past: [],
        future: [],
        tool: 'move',
    });
});

// The editor makes no requests; one here is a bug, so it fails loudly instead of reaching a network.
globalThis.fetch = () => {
    throw new Error('The editor made a network request');
};

// jsdom lacks these browser APIs; sonner reads matchMedia and the canvas observes its own size.
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

// jsdom has no PointerEvent: fireEvent.pointerDown made a plain Event (no button, clientX or
// pointerId), so the canvas saw a non-left click. A MouseEvent with a pointerId is what it reads.
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
