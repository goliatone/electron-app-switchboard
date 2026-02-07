# Packaging and Release Runbook (macOS)

This runbook describes local packaging and CI release operations (D4).

Primary sources:

- `package.json` scripts
- `electron-builder.json`
- `scripts/notarize.js`
- `.github/workflows/release-macos.yml`
- `docs/macos-notarization-setup.md`

## Scope

- Platform: macOS only (v1)
- Artifact formats: `dmg` and `zip`
- Update feed metadata: `latest-mac.yml` + blockmaps
- Publish target: GitHub Releases

## Prerequisites

Local:

- Node (see `.nvmrc`)
- npm
- Apple Developer signing/notarization credentials (for signed notarized builds)

GitHub Actions secrets:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_ID_PASSWORD`
- `APPLE_TEAM_ID`

`GH_TOKEN` is provided by `secrets.GITHUB_TOKEN` in workflow.

## Local Build and Verification

1. Install deps:
   - `npm ci`
2. Build:
   - `npm run build`
3. Test:
   - `npm test`
4. Optional QA gate:
   - `npm run qa:cross-phase`

## Local Packaging Commands

- `npm run package` (mac target)
- `npm run package:mac` (x64)
- `npm run package:mac:all` (x64 + arm64, run as two separate builds)
- `npm run package:dir` (unpacked debug output)

Output directory: `release/`.

## Signing and Notarization

`electron-builder` config:

- `afterSign: scripts/notarize.js`
- mac hardened runtime enabled
- entitlements: `assets/entitlements.mac.plist`

Notarization hook behavior (`scripts/notarize.js`):

- Runs only for `darwin`.
- Skips notarization if Apple credentials are missing.
- Calls `@electron/notarize` with:
  - `appleId`
  - `appleIdPassword`
  - `teamId`

## CI Release Workflow

Workflow file: `.github/workflows/release-macos.yml`

Triggers:

- Tag push: `v*`
- Manual dispatch (`workflow_dispatch`) with `publish` boolean input

Job sequence:

1. Checkout
2. Setup Node from `.nvmrc`
3. `npm ci`
4. `npm run build`
5. `npm test`
6. Validate signing/notarization secrets
7. Package:
   - publish mode: `npx electron-builder --mac --x64 --arm64 --publish always`
   - no-publish mode: `... --publish never`
8. Upload artifacts

## Artifact Checklist

Expected outputs include:

- `release/*.dmg`
- `release/*.zip`
- `release/*.blockmap`
- `release/latest-mac.yml`

If publishing is enabled, release metadata and assets should appear in GitHub Releases.

## Operational Checks After Release

1. Install latest DMG on clean macOS profile.
2. Verify app launches and loads configured `APP_URL`.
3. Verify updater status transitions (`checking` -> ...).
4. Verify update download/install flow on next version bump.
5. Verify settings and stored values persist across update.

## Troubleshooting

Signing/notarization fails:

- Confirm all Apple/certificate secrets are present and valid.
- Re-run workflow with `publish=false` to isolate packaging from publish step.
- Follow `docs/macos-notarization-setup.md` to verify credential values and source.

No updates detected:

- Confirm release artifacts include `latest-mac.yml` and blockmaps.
- Confirm published release visibility and channel alignment (`UPDATE_CHANNEL`).

Build passes but app not notarized:

- Check `scripts/notarize.js` logs for credential-missing skip.
