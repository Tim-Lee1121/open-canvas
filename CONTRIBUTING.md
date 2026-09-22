# Contributing to Open Canvas

Open an issue before large behavior or schema changes. Keep generated-page requests separate from host changes: pages live in `generated-pages/` and are published with the Board CLI. Host maintenance may modify `src/`, `scripts/`, and configuration in this source repository.

Use Node.js 20+ and pnpm 10.12.1. Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` before a pull request. Add focused tests and describe any Figma Desktop manual checks. Never commit `data/board-state.json`, private pages, credentials, or screenshots containing user content.

Contributions are submitted under Apache-2.0. You must have the right to submit all code and assets you contribute. Do not add third-party material without its license and required attribution.
