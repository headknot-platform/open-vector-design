# Contributing

Thanks for helping with OVD.

## License of contributions

This project is licensed under [Apache-2.0](LICENSE). By submitting a contribution you agree that
it is licensed under the same terms (Apache-2.0 §5, "inbound = outbound").

## How changes land

1. **Open an issue first** — what is wrong or wanted, and acceptance criteria.
2. **Branch from `dev`** as `type/<issue#>-short-description` (`feat/`, `fix/`, `chore/`, `docs/`).
3. **Commit** with [Conventional Commits](https://www.conventionalcommits.org):
   `type(scope): imperative description`. The body says _why_.
4. **Run the gate locally** — there is no CI:

    ```bash
    pnpm test && pnpm typecheck && pnpm lint && pnpm --filter @ovd/standalone build
    ```

5. **Open a PR into `dev`** and say what you verified and what you did not.
6. PRs are merged with a **merge commit, never squash**. `main` only receives releases from `dev`.

## Format changes

Where the spec is silent or ambiguous, choose, implement, and add a numbered note to
[`docs/spec-notes.md`](docs/spec-notes.md). `examples/starter` changes only through `ovd fmt`: the
round-trip test compares it byte for byte.
