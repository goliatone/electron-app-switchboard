# macOS Notarization Credential Setup

This guide explains the log message:

`Skipping notarization (missing Apple credentials)`

and how to set the required values for local packaging and CI.

## Why You See This Message

During macOS packaging, `electron-builder` runs `scripts/notarize.js` (`afterSign` hook).
That script only notarizes if all three environment variables are present:

- `APPLE_ID`
- `APPLE_ID_PASSWORD`
- `APPLE_TEAM_ID`

If any are missing, packaging still succeeds, but notarization is skipped.

## Required Values and Where To Get Them

### `APPLE_ID`

What it is:
- The Apple account email used with your Apple Developer membership.

Where to get it:
- Your Apple ID login email (the same account you use for Apple Developer).

### `APPLE_ID_PASSWORD`

What it is:
- An Apple app-specific password (not your normal Apple ID password).

Where to get it:
1. Go to `https://appleid.apple.com/`
2. Sign in with the same Apple ID used for Developer access.
3. Open `Sign-In and Security`.
4. Under `App-Specific Passwords`, create a new password.
5. Copy the generated value and use it as `APPLE_ID_PASSWORD`.

Notes:
- If you revoke/regenerate this password, update CI/local env immediately.
- 2FA must be enabled on the Apple ID to create app-specific passwords.

### `APPLE_TEAM_ID`

What it is:
- Your Apple Developer Team ID (10-character alphanumeric ID).

Where to get it:
1. Go to `https://developer.apple.com/account/`
2. Open your membership/account details.
3. Copy the `Team ID`.

Alternative location:
- App Store Connect `Users and Access` also shows team details.

## Local Usage

Set variables before packaging:

```bash
export APPLE_ID="you@example.com"
export APPLE_ID_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDEFGHIJ"

npm run package:mac
```

## GitHub Actions / CI Usage

Add repository or organization secrets:

- `APPLE_ID`
- `APPLE_ID_PASSWORD`
- `APPLE_TEAM_ID`

Your workflow already expects these names.

## Quick Validation

Before packaging, verify they are set:

```bash
test -n "$APPLE_ID" && echo "APPLE_ID set"
test -n "$APPLE_ID_PASSWORD" && echo "APPLE_ID_PASSWORD set"
test -n "$APPLE_TEAM_ID" && echo "APPLE_TEAM_ID set"
```

## Common Issues

- Wrong Apple account: `APPLE_ID` must belong to the team used for signing.
- Wrong team: `APPLE_TEAM_ID` must match your signing team.
- Using normal Apple password: must be an app-specific password.
- Missing roles/access on Apple Developer account can block notarization.
