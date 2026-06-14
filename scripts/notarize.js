/**
 * Post-build notarization script for electron-builder.
 * Runs after the app is signed. Submits to Apple's notarization service
 * and staples the ticket so it works offline.
 *
 * Credentials are read from environment variables (set in your shell or CI):
 *   APPLE_ID         — your Apple Developer email
 *   APPLE_TEAM_ID    — your 10-character team ID
 *   APPLE_APP_PASSWORD — app-specific password from appleid.apple.com
 *
 * Or, if you stored credentials via `xcrun notarytool store-credentials`,
 * set APPLE_KEYCHAIN_PROFILE to the profile name instead.
 */

const { notarize } = require('@electron/notarize');
const path = require('path');

module.exports = async function notarizeApp(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize on macOS builds
  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`\nNotarizing ${appPath}...`);

  const keychainProfile = process.env.APPLE_KEYCHAIN_PROFILE;

  if (keychainProfile) {
    // Use stored keychain credentials (recommended)
    await notarize({
      tool: 'notarytool',
      appPath,
      keychainProfile,
    });
  } else {
    // Use environment variable credentials
    const appleId = process.env.APPLE_ID;
    const appleIdPassword = process.env.APPLE_APP_PASSWORD;
    const teamId = process.env.APPLE_TEAM_ID;

    if (!appleId || !appleIdPassword || !teamId) {
      console.warn(
        'Notarization skipped — set APPLE_KEYCHAIN_PROFILE (recommended) or ' +
        'APPLE_ID + APPLE_APP_PASSWORD + APPLE_TEAM_ID environment variables.'
      );
      return;
    }

    await notarize({
      tool: 'notarytool',
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
  }

  console.log(`Notarization complete for ${appName}.`);
};
