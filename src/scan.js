// Read-only scanner: checks a React Native / Expo project against current
// Google Play and App Store submission requirements. Never writes to the project.
import fs from 'node:fs';
import path from 'node:path';

const PLAY_TARGET_SDK = 36; // required for new apps and updates from 2026-08-31 (extension: 2026-11-01)
const PLAY_EXISTING_MIN = 35; // below this, existing apps lose visibility to new users

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const exists = (p) => fs.existsSync(p);

export function parseVersion(v) {
  if (!v) return null;
  const m = String(v).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}
const lt = (a, b) => { for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] < b[i]; } return false; };

// Resolves `targetSdkVersion 34`, `targetSdk = 34`, `targetSdkVersion = rootProject.ext.targetSdkVersion`
// and `ext { targetSdkVersion = 34 }` across the given gradle sources.
export function findSdk(name, sources) {
  const all = sources.filter(Boolean).join('\n');
  const short = name.replace(/Version$/, '');
  const literal = new RegExp(`\\b(?:${name}|${short})\\s*=?\\s*(\\d{2})\\b`);
  const m = all.match(literal);
  return m ? Number(m[1]) : null;
}

function walk(dir, exts, out = [], depth = 0) {
  if (depth > 8) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || ['node_modules', 'android', 'ios', 'build', 'dist', 'vendor', 'Pods'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out, depth + 1);
    else if (exts.includes(path.extname(e.name))) out.push(p);
  }
  return out;
}

export function scan(root) {
  const findings = [];
  const add = (severity, id, title, detail, fix) => findings.push({ severity, id, title, detail, fix });
  const rel = (p) => path.relative(root, p);

  const pkg = JSON.parse(read(path.join(root, 'package.json')) || '{}');
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const rn = parseVersion(deps['react-native']);
  const expo = parseVersion(deps.expo);
  const hasAndroid = exists(path.join(root, 'android'));
  const hasIos = exists(path.join(root, 'ios'));
  const kind = expo && !hasAndroid ? 'expo-managed' : expo ? 'expo-prebuild' : rn ? 'bare-rn' : 'unknown';

  if (!rn && !expo) add('fail', 'not-rn', 'Not a React Native project', 'No react-native or expo dependency in package.json.', 'Run the scanner from the app root.');

  // --- Android target / compile SDK ---
  let target = null, compile = null;
  if (hasAndroid) {
    const gradle = ['build.gradle', 'build.gradle.kts', 'app/build.gradle', 'app/build.gradle.kts', 'gradle.properties']
      .map((f) => read(path.join(root, 'android', f)));
    target = findSdk('targetSdkVersion', gradle);
    compile = findSdk('compileSdkVersion', gradle);
  } else if (expo) {
    const appJson = JSON.parse(read(path.join(root, 'app.json')) || '{}');
    const props = (appJson.expo?.plugins || []).find((p) => Array.isArray(p) && p[0] === 'expo-build-properties');
    target = props?.[1]?.android?.targetSdkVersion ?? null;
    compile = props?.[1]?.android?.compileSdkVersion ?? null;
  }
  // Defaults when the project doesn't pin a value: RN 0.81 / Expo SDK 54 target API 36.
  const inferredTarget = target ?? (expo ? (expo[0] >= 54 ? 36 : 35) : rn ? (lt(rn, [0, 81, 0]) ? 35 : 36) : null);
  const label = target ? `targetSdk ${target}` : `targetSdk not pinned; framework default is about ${inferredTarget}`;
  if (inferredTarget == null) add('warn', 'target-unknown', 'Could not determine targetSdk', 'No targetSdkVersion found.', 'Check android/app/build.gradle.');
  else if (inferredTarget < PLAY_EXISTING_MIN) add('fail', 'target-sdk', `Android ${label}: below API ${PLAY_EXISTING_MIN}`, 'The app is already hidden from new users on newer Android versions, and Google Play rejects updates below API 36.', `Raise targetSdk and compileSdk to ${PLAY_TARGET_SDK}, update AGP, Gradle and the Android SDK, then fix the behavior changes below.`);
  else if (inferredTarget < PLAY_TARGET_SDK) add('fail', 'target-sdk', `Android ${label}: below API ${PLAY_TARGET_SDK}`, 'Google Play requires API 36 for app updates since 2026-08-31; the extension window ends 2026-11-01.', `Raise targetSdk and compileSdk to ${PLAY_TARGET_SDK} (React Native 0.81+ or Expo SDK 54+ ships this by default).`);
  else add('pass', 'target-sdk', `Android ${label}`, 'Meets the current Google Play target API requirement.', null);
  if (compile && inferredTarget && compile < inferredTarget) add('warn', 'compile-sdk', `compileSdk ${compile} is lower than targetSdk`, 'compileSdk must be at least the targetSdk.', `Set compileSdk to ${Math.max(inferredTarget, PLAY_TARGET_SDK)}.`);

  // --- Framework versions ---
  if (rn && lt(rn, [0, 77, 0]) && !expo) add('fail', 'rn-16kb', `React Native ${rn.join('.')}: 16 KB page-size risk`, 'React Native below 0.77 ships native libraries that are not 16 KB aligned, which Google Play requires for apps targeting API 35+.', 'Upgrade React Native to 0.77+ (0.81+ recommended), then check native libraries with APK Analyzer.');
  else if (rn && lt(rn, [0, 81, 0]) && !expo) add('warn', 'rn-version', `React Native ${rn.join('.')}`, 'Below 0.81, the API 36 defaults and edge-to-edge handling are not built in.', 'Plan an upgrade to React Native 0.81+.');
  if (expo && expo[0] < 54) add('warn', 'expo-sdk', `Expo SDK ${expo[0]}`, 'Expo SDK below 54 does not target API 36 by default, and older SDKs may not build with Xcode 26.', 'Upgrade to Expo SDK 54+ and rebuild with EAS.');

  // --- Native .so files bundled directly ---
  const jni = path.join(root, 'android', 'app', 'src', 'main', 'jniLibs');
  if (exists(jni)) add('warn', 'jni-libs', 'Prebuilt native libraries in jniLibs', 'Bundled .so files must be rebuilt with 16 KB alignment.', 'Verify with Android Studio > Build > Analyze APK, or zipalign -c -P 16.');

  // --- AndroidManifest and styles behavior changes ---
  const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  const manifest = read(manifestPath);
  if (manifest && /android:screenOrientation="(portrait|landscape|sensorPortrait|sensorLandscape|userPortrait)"/.test(manifest))
    add('warn', 'orientation-lock', 'Orientation is locked in AndroidManifest.xml', 'On API 36, orientation and aspect-ratio locks are ignored on large screens (600dp+), so layouts must handle rotation on tablets and foldables.', 'Test on a tablet or foldable emulator in both orientations.');
  const styles = read(path.join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'styles.xml'));
  if (styles && /windowOptOutEdgeToEdgeEnforcement/.test(styles))
    add('fail', 'edge-opt-out', 'Edge-to-edge opt-out in styles.xml', 'windowOptOutEdgeToEdgeEnforcement no longer works when targeting API 36. The app will draw under the status and navigation bars.', 'Remove the opt-out and handle insets with react-native-safe-area-context.');
  if (manifest && /android:enableOnBackInvokedCallback="false"/.test(manifest))
    add('warn', 'predictive-back', 'Predictive back is disabled in the manifest', 'On API 36, the predictive-back opt-out is removed, so custom back handling may change.', 'Test every screen that uses BackHandler.');

  // --- Source patterns ---
  const files = walk(root, ['.js', '.jsx', '.ts', '.tsx']);
  const hits = { safeArea: [], back: [], statusBar: [] };
  for (const f of files) {
    const src = read(f) || '';
    if (/import\s*\{[^}]*\bSafeAreaView\b[^}]*\}\s*from\s*['"]react-native['"]/.test(src)) hits.safeArea.push(rel(f));
    if (/\bBackHandler\.addEventListener\b/.test(src)) hits.back.push(rel(f));
    if (/<StatusBar[^>]*\b(backgroundColor|translucent)\b/.test(src) || /StatusBar\.set(BackgroundColor|Translucent)\b/.test(src)) hits.statusBar.push(rel(f));
  }
  const list = (a) => a.slice(0, 5).join(', ') + (a.length > 5 ? `, and ${a.length - 5} more` : '');
  if (hits.safeArea.length) add('warn', 'safe-area', `SafeAreaView from react-native in ${hits.safeArea.length} file(s)`, `It is deprecated and does nothing on Android, so content will sit under the system bars when edge-to-edge is enforced: ${list(hits.safeArea)}`, 'Switch to SafeAreaView or useSafeAreaInsets from react-native-safe-area-context.');
  if (hits.statusBar.length) add('warn', 'status-bar', `StatusBar color or translucency set in ${hits.statusBar.length} file(s)`, `These props are ignored under edge-to-edge: ${list(hits.statusBar)}`, 'Draw the bar background yourself with an inset-sized view.');
  if (hits.back.length) add('info', 'back-handler', `BackHandler used in ${hits.back.length} file(s)`, `Retest these with predictive back gestures: ${list(hits.back)}`, null);

  // --- iOS: Xcode 26 / iOS 26 SDK requirement (in force since 2026-04-28) ---
  if (hasIos || expo) {
    if (rn && lt(rn, [0, 79, 0]) && !expo) add('warn', 'xcode-26', 'iOS builds with Xcode 26 may need an upgrade', `App Store Connect requires Xcode 26 / iOS 26 SDK builds since 2026-04-28. React Native ${rn.join('.')} commonly needs Podfile or dependency fixes to build with it.`, 'Build a Release archive with Xcode 26 before you need to ship.');
    const podfile = read(path.join(root, 'ios', 'Podfile'));
    const plat = podfile?.match(/platform\s*:ios,\s*['"]?(\d+(?:\.\d+)?)/);
    if (plat && Number(plat[1]) < 15.1) add('info', 'ios-min', `iOS deployment target ${plat[1]}`, 'Recent React Native versions require iOS 15.1 or later.', 'Raise the platform in the Podfile when you upgrade.');
    const hasPrivacy = hasIos && fs.readdirSync(path.join(root, 'ios'), { recursive: true })
      .some((f) => String(f).endsWith('.xcprivacy') && !String(f).startsWith('Pods'));
    if (hasIos && !hasPrivacy) add('warn', 'privacy-manifest', 'No PrivacyInfo.xcprivacy found', 'App Store Connect flags apps that use required-reason APIs (which React Native does) without a privacy manifest.', 'Add PrivacyInfo.xcprivacy with the required-reason API declarations.');
  }

  const order = { fail: 0, warn: 1, info: 2, pass: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const count = (s) => findings.filter((f) => f.severity === s).length;
  return { root, kind, rn: rn?.join('.') ?? null, expo: expo?.[0] ?? null, findings, summary: { fail: count('fail'), warn: count('warn'), info: count('info'), pass: count('pass') } };
}

export function toMarkdown(r) {
  const icon = { fail: 'FAIL', warn: 'WARN', info: 'INFO', pass: 'PASS' };
  const lines = [
    '# Store readiness report',
    '',
    `Project type: ${r.kind}${r.rn ? ` · React Native ${r.rn}` : ''}${r.expo ? ` · Expo SDK ${r.expo}` : ''}`,
    `Result: ${r.summary.fail} blocking · ${r.summary.warn} warnings · ${r.summary.info} notes · ${r.summary.pass} passed`,
    '',
  ];
  for (const f of r.findings) {
    lines.push(`## [${icon[f.severity]}] ${f.title}`, '', f.detail);
    if (f.fix) lines.push('', `Fix: ${f.fix}`);
    lines.push('');
  }
  lines.push('---', 'Static checks only. A passing report does not guarantee store approval: build, install and test a release on real devices.');
  return lines.join('\n');
}
