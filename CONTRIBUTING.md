# Contributing

Thanks for helping improve dsh-nl2sql! Bug reports, documentation fixes, new IM adapters and features are all welcome. Issues and pull requests may be written in English or Chinese.

## Before you start

- **Bugs:** search [existing issues](https://github.com/hedeqiang/dsh-nl2sql/issues) first, then open one with the bug template. Include the Harness and plugin versions (**Data Q&A → Manage → Settings → About**), the database type and version, and steps to reproduce. Never paste passwords, tokens or real business data.
- **Features:** open an issue describing the use case before writing a large change, so we can agree on the approach.
- **Security issues:** do not open a public issue — follow [SECURITY.md](SECURITY.md).

## Development setup

Requirements: DeepSeek Harness 0.2+, Node.js 24+, pnpm, and optionally local MySQL / PostgreSQL / Elasticsearch for the integration tests.

```bash
git clone https://github.com/hedeqiang/dsh-nl2sql.git
cd dsh-nl2sql
pnpm install --ignore-scripts
npm test
```

Install the checkout in Harness with **Plugins → Add plugin** and the absolute path of the directory. It is linked, so after editing code re-enable the plugin on the **Plugins** page to load the changes.

Read [docs/development.md](docs/development.md) for the project layout, how the browser bundle is built, and how tests are organised. IM adapters follow [docs/channels.md](docs/channels.md).

## Making changes

1. Create a branch from `main`.
2. Make the change:
   - Host logic lives in `service/*.js`, IM adapters in `channels/*.js`, agent tools and RPC registration in `index.js`.
   - The page lives in `client-src/**/*.js`. Run `node scripts/build-client.mjs` afterwards and commit the regenerated `lib/client.js`; never edit `lib/client.js` by hand.
   - Every user-facing string needs both Chinese and English entries in `client-src/core/locale.js`.
3. Add or update tests (`test/unit`, `test/integration`, `test/ui`). Security-related changes (SQL admission, access control, roles, row-level rules, bot authorization) must include a test that reproduces the issue.
4. Run `npm test` and make sure it passes.
5. Add an entry under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).

## Pull requests

- Keep each pull request focused on one change; describe what changed, why, and how you tested it.
- Use short imperative commit messages, e.g. `Fix row-level filter for aliased tables`.
- Do not commit credentials, connection strings or real data. Tests use local databases or the synthetic data in `eval/`.
- CI runs syntax checks, verifies `lib/client.js` is up to date, and runs the unit and UI tests.

## Releases

Maintainers release by bumping `version` in `package.json`, moving the **Unreleased** notes into a new version section of `CHANGELOG.md`, and pushing a `vX.Y.Z` tag. The `release` workflow publishes to npm with provenance and creates the GitHub release.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to uphold it.
