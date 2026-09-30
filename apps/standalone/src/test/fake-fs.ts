/** An in-memory folder with the File System Access API surface lib/local.ts uses. */
type Node = FakeDir | FakeFile;

class FakeFile {
    readonly kind = 'file';
    constructor(
        readonly name: string,
        public data: Uint8Array = new Uint8Array(),
    ) {}
    async getFile() {
        return new File([this.data as BlobPart], this.name);
    }
    async createWritable() {
        const chunks: Uint8Array[] = [];
        return {
            write: async (d: string | Blob) =>
                void chunks.push(
                    typeof d === 'string'
                        ? new TextEncoder().encode(d)
                        : new Uint8Array(await d.arrayBuffer()),
                ),
            close: async () => {
                this.data = new Uint8Array(chunks.flatMap((c) => [...c]));
            },
        };
    }
}

export class FakeDir {
    readonly kind = 'directory';
    readonly children = new Map<string, Node>();
    permission: PermissionState = 'granted';
    constructor(readonly name: string) {}

    async *entries(): AsyncIterableIterator<[string, Node]> {
        yield* this.children.entries();
    }
    async getDirectoryHandle(name: string, opts: { create?: boolean } = {}) {
        let d = this.children.get(name);
        if (!d && opts.create) this.children.set(name, (d = new FakeDir(name)));
        if (!(d instanceof FakeDir)) throw new DOMException(name, 'NotFoundError');
        return d;
    }
    async getFileHandle(name: string, opts: { create?: boolean } = {}) {
        let f = this.children.get(name);
        if (!f && opts.create) this.children.set(name, (f = new FakeFile(name)));
        if (!(f instanceof FakeFile)) throw new DOMException(name, 'NotFoundError');
        return f;
    }
    async removeEntry(name: string) {
        if (!this.children.delete(name)) throw new DOMException(name, 'NotFoundError');
    }
    async queryPermission() {
        return this.permission;
    }
    async requestPermission() {
        return this.permission;
    }
    async isSameEntry(other: unknown) {
        return other === this;
    }

    /** Every file as path → text, for assertions. */
    files(prefix = ''): Record<string, string> {
        const out: Record<string, string> = {};
        for (const [name, n] of this.children)
            if (n instanceof FakeDir) Object.assign(out, n.files(`${prefix}${name}/`));
            else out[prefix + name] = new TextDecoder().decode(n.data);
        return out;
    }

    static from(files: Record<string, string | Uint8Array>, name = 'my-design'): FakeDir {
        const root = new FakeDir(name);
        for (const [path, text] of Object.entries(files)) {
            const parts = path.split('/');
            let dir = root;
            for (const p of parts.slice(0, -1)) {
                if (!dir.children.has(p)) dir.children.set(p, new FakeDir(p));
                dir = dir.children.get(p) as FakeDir;
            }
            dir.children.set(
                parts.at(-1)!,
                new FakeFile(
                    parts.at(-1)!,
                    typeof text === 'string' ? new TextEncoder().encode(text) : text,
                ),
            );
        }
        return root;
    }
}

export const asHandle = (d: FakeDir) => d as unknown as FileSystemDirectoryHandle;
