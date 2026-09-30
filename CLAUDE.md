# CLAUDE.md — Open Vector Design (open source)

## Project Identity

- **What:** the OVD file format (an open, SVG-based format for UI design — see
  [`OVD-spec-v0.1.md`](OVD-spec-v0.1.md)), its format library and CLI, and — being extracted into
  this repo (an epic in the private app repository) — the **free, standalone OVD Editor**.
- **License:** Apache-2.0. Everything in this repo is open source.
- **Not here:** sign-in, projects on a server, sharing, comments, history hosting, GitHub/Figma
  connections. Those belong to the private app (private), which _embeds_ the editor.
  Never add server, auth or network code to this repo's editor; it gets I/O from its host.
- **Stack:** TypeScript 5.9, React 19, Vite 6, Tailwind 4, shadcn/ui; pnpm 10.4 + Turbo; Node ≥ 22.13.

## Workflow

Issue first → branch `type/<issue#>-slug` from `dev` → Conventional Commits → PR into `dev` →
**merge commit, never squash**. See [`CONTRIBUTING.md`](CONTRIBUTING.md). There is no CI; the gate is

```bash
pnpm test && pnpm typecheck && pnpm lint
```

## Workspace Map

| Workspace                                              | Package               | Purpose                                                                                                                      |
| ------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/ovd-core`                                    | `@workspace/ovd-core` | Format library: model, XML, SVG read/write, text, tokens, components, validate, export, diff, Sketch/Figma import, `ovd` CLI |
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
