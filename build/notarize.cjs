/**
 * afterSign hook — notarizes the macOS app after code signing.
 *
 * Required environment variables (set in .env or CI secrets):
 *   APPLE_ID                    = your@appleid.com
 *   APPLE_APP_SPECIFIC_PASSWORD = <app-specific password from appleid.apple.com>
 *   APPLE_TEAM_ID               = <your Apple Developer Team ID>
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: false });

const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== 'darwin') return;

  // Skip notarization when env vars are not set (e.g. local unsigned builds)
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.log('  • Skipping notarization: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD not set');
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`  • Notarizing ${appName} (${process.env.APPLE_TEAM_ID})…`);

  const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
  await Promise.race([
    notarize({
      tool: 'notarytool',
      appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Notarization timed out after 10 minutes')), TIMEOUT_MS)
    ),
  ]);

  console.log(`  • Notarization complete`);
};
