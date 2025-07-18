# CI/CD Configuration for LovClip

This document describes the Continuous Integration and Continuous Deployment setup for LovClip.

## Overview

The CI/CD pipeline is built using GitHub Actions and consists of three main workflows:

1. **Build Workflow** (`build.yml`) - Runs on every push and PR
2. **Release Workflow** (`release.yml`) - Runs on version tags
3. **Version Management** (`version.yml`) - Manual version bumping

## Workflows

### 1. Build Workflow

**Trigger**: Push to main branch, Pull Requests

**What it does**:
- Builds the app on macOS, Windows, and Linux
- Runs TypeScript checks
- Runs tests
- Builds native modules
- Uploads build artifacts

**Files**: `.github/workflows/build.yml`

### 2. Release Workflow

**Trigger**: Version tags (e.g., `v1.2.3`)

**What it does**:
- Builds and packages the app for all platforms
- Signs the applications (with proper certificates)
- Publishes to GitHub Releases
- Handles auto-updater distribution

**Files**: `.github/workflows/release.yml`

### 3. Version Management Workflow

**Trigger**: Manual dispatch from GitHub Actions tab

**What it does**:
- Bumps version numbers
- Updates CHANGELOG.md
- Creates git tags
- Triggers the release workflow

**Files**: `.github/workflows/version.yml`

## Setup Required

### 1. GitHub Repository Secrets

You need to configure these secrets in your GitHub repository:

#### For macOS Code Signing:
- `CSC_LINK`: Base64 encoded .p12 certificate
- `CSC_KEY_PASSWORD`: Password for the certificate
- `APPLE_ID`: Your Apple ID for notarization
- `APPLE_ID_PASS`: App-specific password for Apple ID
- `APPLE_TEAM_ID`: Your Apple Developer Team ID

#### For Windows Code Signing:
- `CSC_LINK_WIN`: Base64 encoded .p12 certificate for Windows
- `CSC_KEY_PASSWORD_WIN`: Password for Windows certificate

### 2. Repository Configuration

Update `electron-builder.json` with your repository details:

```json
{
  "publish": [
    {
      "provider": "github",
      "owner": "your-username",
      "repo": "n-clip",
      "releaseType": "release"
    }
  ]
}
```

## Usage

### Automated Release Process

1. **Using the Release Script** (Recommended):
   ```bash
   ./scripts/release.sh
   ```
   This script will:
   - Check if you're on main branch
   - Ensure working directory is clean
   - Run tests and TypeScript checks
   - Ask for version type (patch/minor/major/prerelease)
   - Bump version and create git tag
   - Push to GitHub

2. **Manual Version Management**:
   - Go to GitHub Actions tab
   - Select "Version Management" workflow
   - Click "Run workflow"
   - Choose version type
   - Click "Run workflow"

3. **Manual Tag Creation**:
   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```

### Build Artifacts

After successful builds, artifacts are available:

- **GitHub Releases**: Signed, production-ready installers
- **GitHub Actions Artifacts**: Development builds (7 days retention)

## File Structure

```
.github/
├── workflows/
│   ├── build.yml      # Main build workflow
│   ├── release.yml    # Release workflow
│   └── version.yml    # Version management
build/
├── entitlements.mac.plist  # macOS entitlements
scripts/
├── release.sh         # Release automation script
docs/
├── CICD.md           # This file
```

## Platform-Specific Notes

### macOS
- Requires valid Apple Developer certificate
- Uses notarization for Gatekeeper approval
- Builds universal binaries (Intel + Apple Silicon)
- Outputs: `.dmg` and `.zip`

### Windows
- Requires code signing certificate
- Uses NSIS installer
- Outputs: `.exe` installer and `.zip`

### Linux
- No code signing required
- Outputs: `.AppImage` and `.deb`

## Auto-Updater

The app includes `electron-updater` which automatically:
- Checks for updates from GitHub Releases
- Downloads and installs updates
- Handles update notifications

## Security

- All certificates are stored as encrypted secrets
- Code signing happens in isolated CI environment
- No sensitive data is logged or exposed

## Troubleshooting

### Common Issues

1. **Build fails on native modules**:
   - Ensure `node-gyp` is properly configured
   - Check platform-specific build dependencies

2. **Code signing fails**:
   - Verify certificate format and password
   - Check Apple Developer account status

3. **Tests fail in CI**:
   - Ensure tests work in headless environment
   - Check for environment-specific dependencies

### Debugging

- Check GitHub Actions logs for detailed error messages
- Use `--verbose` flag in electron-builder for more details
- Test builds locally before pushing

## Contributing

When contributing to the CI/CD setup:

1. Test changes in a fork first
2. Update documentation if needed
3. Consider backward compatibility
4. Follow security best practices

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [electron-builder Documentation](https://www.electron.build/)
- [Code Signing Guide](https://www.electron.build/code-signing)
- [Auto-updater Documentation](https://www.electron.build/auto-update)