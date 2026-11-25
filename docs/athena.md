# Athena Fork Guide

Athena (`0xSnww/athena`) is a fork of [T3 Code](https://github.com/pingdotgg/t3code) with a custom glass/pill UI, Athena branding, and automated Windows + macOS desktop builds.

## Golden Rule: Keep Fork Changes Isolated

Athena syncs with `pingdotgg/t3code` (`main`) every 6 hours. To keep merges clean and conflict-free:

- Put new Athena UI components under `apps/web/src/components/athena/`.
- Put Athena-specific automation in `.github/workflows/athena-*.yml` rather than editing upstream workflows.
- Put Athena-specific developer scripts in `scripts/athena-*.ts`.
- Avoid deleting upstream workflows in git—disable unused ones in GitHub **Settings → Actions** instead.

## Intentional Divergences from Upstream

| Area                       | Files                                                                                                                            | Purpose                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Athena UI components       | `apps/web/src/components/athena/*`                                                                                               | Floating collapsed rail, dot backdrop, thread buddy emblem, composer usage rings, right-side team & server cards |
| Panel blur setting         | `packages/contracts/src/settings.ts`, `apps/web/src/appInit.tsx`, `apps/web/src/components/settings/AppearanceSettingsPanel.tsx` | `panelGlassBlur` setting driving `--athena-panel-blur`                                                           |
| Web & desktop branding     | `apps/web/src/branding.ts`, `apps/desktop/src/app/DesktopAppIdentity.ts`, `apps/desktop/package.json`, `assets/*`                | Athena display name, icons, DMG artwork, installer branding                                                      |
| Desktop auto-updater feed  | `.env.example` (`T3CODE_DESKTOP_UPDATE_REPOSITORY=0xSnww/athena`)                                                                | Points `electron-updater` at Athena's GitHub Releases                                                            |
| CI, sync & desktop release | `.github/workflows/athena-ci.yml`, `.github/workflows/athena-upstream-sync.yml`, `.github/workflows/athena-desktop-release.yml`  | GitHub-hosted PR/push checks, verified upstream sync, and atomic Windows + macOS releases                        |

## Everyday Commands

Most of these are also available as one-click actions in `t3.json`:

```bash
vp run doctor         # Verify Node, vp, pnpm, Rust, git remotes, .env, and hooks
vp run dev            # Start local server + web UI
vp run dev:desktop    # Start Electron desktop app in dev mode
vp run check:changed  # Format, lint, typecheck, and test files changed on your branch
vp run typecheck      # Typecheck the monorepo
```

## CI, Upstream Sync & Releases

- **PR & `main` checks (`.github/workflows/athena-ci.yml`)**: Runs on standard `ubuntu-latest` runners (unlike upstream's `ci.yml`, which targets Blacksmith runners). PRs run `vp run check:changed`; pushes to `main` run formatting, lint, workspace typecheck, and Athena guardrail tests.
- **Verified upstream sync (`.github/workflows/athena-upstream-sync.yml`)**: Runs every 6 hours, merges `upstream/main` locally, and runs typecheck + Athena guardrail tests **before** pushing `main` or tagging a release.
  - If git hits a merge conflict, or if verification fails, `main` stays untouched and details are always written to the workflow job summary (and opened/updated as a GitHub issue when Issues are enabled on the fork).
  - To resolve a conflict locally:
    ```bash
    git fetch upstream main
    git merge upstream/main
    # Fix conflicts, then verify:
    vp run check:changed
    git push origin main
    ```
- **Atomic desktop releases (`.github/workflows/athena-desktop-release.yml`)**: Builds Windows x64 (`.exe`) and macOS arm64 (`.dmg` + `.zip`) in parallel with read-only repo permissions, generates `SHA256SUMS.txt`, uploads everything to a **draft** release, and publishes only after every requested platform succeeds. Tags with a hyphen (e.g. `v1.0.5-beta.1`) publish as GitHub prereleases so they don't overwrite the `latest` auto-update channel.

## One-Time GitHub Repository Setup

To get the full protection of these workflows on `0xSnww/athena`:

1. **Branch protection (`Settings → Rules → Rulesets`)**: Add a ruleset for `main` requiring the **Check** status check from `Athena CI` to pass before merging.
2. **Disable upstream-only workflows (`Actions` tab → select workflow → `⋯` → `Disable workflow`)**: Disable workflows meant for `pingdotgg/t3code` infrastructure (such as `CI`, `Release`, `Deploy Relay`, `Web Preview`, `PR Vouch`, `Issue Vouch`, `Publish AUR`) so your Actions tab stays quiet without creating merge conflicts.
