# CLAUDE.md — Open Vector Design (open source)

## Project Identity

- **What:** the OVD file format (an open, SVG-based format for UI design — see
  [`OVD-spec-v0.1.md`](OVD-spec-v0.1.md)), its format library and CLI, the editor as an embeddable
  component (`packages/editor`), and the **free, standalone OVD Editor** (`apps/standalone`).
- **License:** Apache-2.0. Everything in this repo is open source.
- **Not here:** sign-in, projects on a server, sharing, comments, history hosting, GitHub/Figma
  connections. Those belong to hosts that _embed_ the editor (ours is private). Never add server,
  auth or network code here: `packages/editor` gets all I/O from its host, and the standalone editor
  touches local files only. Both lint configs reject `fetch` / XHR / WebSocket, and their tests make
  any request fail.
- **Stack:** TypeScript 5.9, React 19, Vite 6, Tailwind 4, shadcn/ui; pnpm 10.4 + Turbo; Node ≥ 22.13.

## Workflow

Issue first → branch `type/<issue#>-slug` from `dev` → Conventional Commits → PR into `dev` →
**merge commit, never squash**. See [`CONTRIBUTING.md`](CONTRIBUTING.md). There is no CI; the gate is

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm --filter @ovd/standalone build
```

## Workspace Map

| Workspace                                              | Package               | Purpose                                                                                                                      |
| ------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/ovd-core`                                    | `@workspace/ovd-core` | Format library: model, XML, SVG read/write, text, tokens, components, validate, export, diff, Sketch/Figma import, `ovd` CLI |
| `packages/editor`                                      | `@workspace/editor`   | The editor as an embeddable component: `OvdEditor`, `EditorHost` (`src/host.tsx`), browser export and validation             |
| `apps/standalone`                                      | `@ovd/standalone`     | The free OVD Editor: the editor + local folders, `.tar.gz`, IndexedDB autosave, Sketch import, export                        |
| `packages/ui`                                          | `@workspace/ui`       | shadcn/ui primitives and the global stylesheet                                                                               |
| `packages/eslint-config`, `packages/typescript-config` |                       | Shared lint/TS config                                                                                                        |
| `examples/starter`                                     |                       | The starter project — canonical, round-trip tested byte for byte                                                             |

## Key Conventions

- **The format library stays DOM-free.** `ovd-core` has no runtime dependencies and its tests run in
  plain Node. It has its own XML reader/writer — do not reach for `DOMParser`/`XMLSerializer`.
- **Stored results.** Text `lines` and laid-out geometry are stored in the model and re-computed by
  the editor with real font metrics; the writer never re-measures, which keeps `ovd fmt` byte-stable.
- **`examples/starter` changes only through `ovd fmt`.**
- **Spec gaps go in `docs/spec-notes.md`** as a numbered note (what was open, what we did, wording).
- **A project is a package folder** (`manifest.json` at the root); there is no single-file container.
- **Formatting:** Prettier at the root (4 spaces, single quotes). OVD files under `examples/` are the
  serialiser's, not Prettier's (spec §10: 2-space indent, fixed attribute order).

## The editor (`packages/editor`)

- **One mutation path.** Every document change goes through `editor().update(recipe)` (immer; it
  re-runs layout for the open document), so undo covers everything. A gesture calls `checkpoint()`
  once, then `update(…, { history: false })` per frame.
- **The host.** A host renders `<OvdEditor host={…} />`, loads with `editor().loadProject`, watches
  with `useEditor.subscribe`, confirms with `editor().markSaved()`, and adds File-menu sections,
  top-bar slots, tools, canvas layers, a library resolver, commands and overlays through
  `EditorHost`. Hosts import only from `@workspace/editor` (`src/index.ts`).
- **Exports match a server byte for byte** because both call the same `ovd-core` functions
  (`exportPageSvg`, `tokensJson`, `packageFiles`). Do not re-implement them in a host.

### Pitfalls already hit

- The editor must provide what its own primitives need (Radix `TooltipProvider`); a host must never
  have to know them. Package tests render `<OvdEditor />` with no host for this reason.
- A zustand selector that returns a fresh value (`s.x ?? []`) re-renders forever; fall back to a
  module-level constant.
- A host loads a project _before_ `<OvdEditor>` mounts: anything it starts from the editor (the
  standalone autosave) must act on the current state once, not only on the next change.
- An SVG drawn as an image loads no fonts; PNG export embeds them as `data:` URLs (`withFonts`).
- `packageFiles()` drops stale files in the exports folder, while `readProject` keeps other unknown
  files in `other` so they survive a save.
- `structuredClone` of an immer draft throws `DataCloneError` — unwrap with `current()` first.
