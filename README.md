# Open Vector Design (OVD)

An open, SVG-based format for UI design — and a free editor for it.

OVD is built on standards that already exist and are maintained in the open: **SVG** (W3C) for
drawings, **DTCG** design tokens for colours, type and spacing, and **Git** for history. A project is
a plain folder of files that diff, review and merge like code.

|                                            |                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [`OVD-spec-v0.1.md`](OVD-spec-v0.1.md)     | The draft format specification                                                                                            |
| [`docs/spec-notes.md`](docs/spec-notes.md) | Decisions where the draft is silent or ambiguous                                                                          |
| [`packages/ovd-core`](packages/ovd-core)   | Format library: read, write, validate, export, diff, Sketch/Figma import — no DOM, no runtime dependencies; the `ovd` CLI |
| [`packages/editor`](packages/editor)       | The editor as an embeddable React component — it does no I/O; its host plugs in files, a server, accounts                 |
| [`apps/standalone`](apps/standalone)       | **The OVD Editor**: the editor with local folders, `.tar.gz`, browser autosave and export — no account, no server         |
| [`packages/ui`](packages/ui)               | UI primitives (shadcn/ui) shared by the editor                                                                            |
| [`examples/starter`](examples/starter)     | A starter project in canonical form                                                                                       |

## The OVD Editor

A free editor you can run anywhere, with no account and no server. It makes no network requests at
all — your files stay on your computer.

- **Open and save a package folder** in place (Chrome, Edge). Other browsers open a folder as a copy
  and save by downloading a `.tar.gz`.
- **Autosave in the browser**: a closed tab or a crash loses nothing; recent folders reopen.
- **Import** Sketch files; **export** pages as SVG or PNG, tokens as DTCG JSON or CSS variables.
- **Validate** a project against the spec, and jump to each problem.

```bash
pnpm install
pnpm dev:standalone        # http://localhost:5174
pnpm build:standalone      # static files in apps/standalone/dist — host them anywhere
```

## Embedding the editor

`packages/editor` is the editor on its own. It renders and edits a project and does no I/O: the
host decides where projects come from and go to, and can add menu entries, tools, canvas layers and
panels through `EditorHost` (`packages/editor/src/host.tsx`).

```tsx
import { OvdEditor, editor, useEditor } from '@workspace/editor';

editor().loadProject(project, { kind: 'local', name: 'My design' }); // a Project from ovd-core
useEditor.subscribe((s) => s.project !== s.savedProject && save(s.project)); // your storage
// … once stored: editor().markSaved()

<OvdEditor host={{ fileMenu: { sections: [[{ label: 'Save', onSelect: save }]] } }} />;
```

`apps/standalone` is a complete host (local files); a host with a server can add sign-in, sharing,
history and comments the same way.

## A project is a folder

```
my-design/
  manifest.json      # name, pages, themes, libraries
  pages/*.svg        # one SVG per page
  components/*.svg   # components and their variants
  tokens/*.json      # DTCG tokens, one file per theme
  assets/            # images, fonts
  exports/           # flattened SVGs any browser can open
```

## Develop

Requires Node ≥ 22.13 and pnpm (pinned in `package.json`).

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

The `ovd` CLI (spec §10):

```bash
pnpm --filter @workspace/ovd-core ovd fmt examples/starter        # rewrite in canonical form
pnpm --filter @workspace/ovd-core ovd validate examples/starter
pnpm --filter @workspace/ovd-core ovd export examples/starter     # write exports/
pnpm --filter @workspace/ovd-core ovd diff <old> <new>
```

## License

[Apache-2.0](LICENSE) — the code, the specification and the examples. See [`NOTICE`](NOTICE).
Contributions are accepted under the same license; see [`CONTRIBUTING.md`](CONTRIBUTING.md).
