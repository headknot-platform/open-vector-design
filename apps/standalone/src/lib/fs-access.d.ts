// The File System Access API's entry points are not in TypeScript's DOM lib yet (Chromium only).
interface Window {
    showDirectoryPicker?(options?: {
        mode?: 'read' | 'readwrite';
        id?: string;
    }): Promise<FileSystemDirectoryHandle>;
}

interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
    queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
