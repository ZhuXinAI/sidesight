# SideSight release flow

SideSight publishes the package from GitHub Actions when an annotated tag exactly matches the version in `package.json`:

```text
v0.1.0  ->  package.json version 0.1.0  ->  npm sidesight@0.1.0
```

The workflow is `.github/workflows/publish.yml`. It runs the full offline validation and uses npm OIDC trusted publishing. It does not use `NPM_TOKEN` or `NODE_AUTH_TOKEN`.

## First local publish

The first package publication must be authenticated locally because npm cannot configure a trusted publisher until the package exists:

```bash
npm login
npm whoami
pnpm install --frozen-lockfile
pnpm test:pack
npm publish --access public
```

The current package version is `0.1.0`. A published version cannot be overwritten, so update `package.json` and use a new `vX.Y.Z` tag for every subsequent release.

## Configure the npm trusted publisher

After `sidesight@0.1.0` exists on npm:

1. Open the package's npm settings.
2. Add a GitHub Actions trusted publisher.
3. Enter the exact GitHub owner and repository containing this checkout.
4. Set the workflow filename to `.github/workflows/publish.yml`.
5. Leave the environment empty; this workflow does not declare a GitHub environment.

The publisher must match the repository and workflow filename exactly. The workflow already grants `id-token: write`, installs npm `11.5.1` for trusted publishing, checks the `v*` tag against `package.json`, and publishes with OIDC provenance.

## Subsequent releases

After changing the version and updating the changelog or release notes:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
pnpm test:acceptance
pnpm test:pack

release_version="$(node -p "require('./package.json').version")"
git tag -a "v${release_version}" -m "Release v${release_version}"
git push origin "v${release_version}"
```

The tag push starts the workflow. A mismatched tag fails before any npm publish attempt.
