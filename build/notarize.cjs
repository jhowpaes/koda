require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: false });

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== 'darwin') return;

  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.log('  • Skipping notarization: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD not set');
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const zipPath = path.join(os.tmpdir(), `${appName}-notarize.zip`);

  console.log(`  • Zipping ${appPath} for notarization…`);
  execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`, { stdio: 'inherit' });

  console.log(`  • Submitting to Apple notarization (this streams output in real-time)…`);
  const result = spawnSync(
    'xcrun',
    [
      'notarytool', 'submit', zipPath,
      '--apple-id', process.env.APPLE_ID,
      '--password', process.env.APPLE_APP_SPECIFIC_PASSWORD,
      '--team-id', process.env.APPLE_TEAM_ID,
      '--wait',
      '--timeout', '10m',
    ],
    { stdio: 'inherit', timeout: 11 * 60 * 1000 }
  );

  try { fs.unlinkSync(zipPath); } catch (_) {}

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`notarytool exited with code ${result.status}`);
  }

  console.log(`  • Stapling notarization ticket to ${appName}.app…`);
  spawnSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' });
};
