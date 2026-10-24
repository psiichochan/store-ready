import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan, findSdk, toMarkdown } from '../src/scan.js';

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-ready-'));
  for (const [p, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}
const ids = (r, sev) => r.findings.filter((f) => f.severity === sev).map((f) => f.id);

test('findSdk resolves ext blocks, Groovy and Kotlin DSL', () => {
  assert.equal(findSdk('targetSdkVersion', ['ext {\n  targetSdkVersion = 34\n}', 'targetSdkVersion rootProject.ext.targetSdkVersion']), 34);
  assert.equal(findSdk('targetSdkVersion', ['android { defaultConfig { targetSdk = 36 } }']), 36);
  assert.equal(findSdk('compileSdkVersion', ['compileSdkVersion 35']), 35);
  assert.equal(findSdk('targetSdkVersion', ['nothing here']), null);
});

test('old bare RN app: blocking target SDK, 16 KB risk and edge-to-edge issues', () => {
  const root = fixture({
    'package.json': { dependencies: { 'react-native': '0.74.5' } },
    'android/build.gradle': 'buildscript { ext { compileSdkVersion = 34\n targetSdkVersion = 34 } }',
    'android/app/build.gradle': 'android { defaultConfig { targetSdkVersion rootProject.ext.targetSdkVersion } }',
    'android/app/src/main/AndroidManifest.xml': '<activity android:screenOrientation="portrait" />',
    'android/app/src/main/res/values/styles.xml': '<item name="android:windowOptOutEdgeToEdgeEnforcement">true</item>',
    'ios/Podfile': "platform :ios, '13.4'",
    'src/Home.tsx': "import { View, SafeAreaView } from 'react-native';\n<StatusBar translucent />\nBackHandler.addEventListener('hardwareBackPress', f)",
  });
  const r = scan(root);
  assert.deepEqual(ids(r, 'fail').sort(), ['edge-opt-out', 'rn-16kb', 'target-sdk']);
  for (const id of ['orientation-lock', 'safe-area', 'status-bar', 'xcode-26', 'privacy-manifest']) assert.ok(ids(r, 'warn').includes(id), id);
  assert.ok(ids(r, 'info').includes('back-handler'));
  assert.ok(ids(r, 'info').includes('ios-min'));
  assert.match(r.findings.find((f) => f.id === 'target-sdk').title, /below API 35/);
});

test('current bare RN app passes the target SDK check', () => {
  const root = fixture({
    'package.json': { dependencies: { 'react-native': '0.81.4' } },
    'android/build.gradle': 'ext { compileSdkVersion = 36\n targetSdkVersion = 36 }',
    'ios/Podfile': "platform :ios, '15.1'",
    'ios/App/PrivacyInfo.xcprivacy': '<plist/>',
    'src/App.tsx': "import { SafeAreaView } from 'react-native-safe-area-context';",
  });
  const r = scan(root);
  assert.equal(r.summary.fail, 0);
  assert.ok(ids(r, 'pass').includes('target-sdk'));
  assert.ok(!ids(r, 'warn').includes('safe-area'), 'safe-area-context import must not be flagged');
});

test('Expo managed app infers target from SDK version', () => {
  const old = scan(fixture({ 'package.json': { dependencies: { expo: '~52.0.0', 'react-native': '0.76.0' } }, 'app.json': { expo: {} } }));
  assert.equal(old.kind, 'expo-managed');
  assert.ok(ids(old, 'fail').includes('target-sdk'));
  assert.ok(ids(old, 'warn').includes('expo-sdk'));
  assert.ok(!ids(old, 'fail').includes('rn-16kb'), 'Expo handles RN native builds; do not double-report');

  const cur = scan(fixture({ 'package.json': { dependencies: { expo: '~54.0.0', 'react-native': '0.81.0' } }, 'app.json': { expo: {} } }));
  assert.ok(ids(cur, 'pass').includes('target-sdk'));
});

test('Expo build-properties pin overrides the default', () => {
  const r = scan(fixture({
    'package.json': { dependencies: { expo: '~54.0.0' } },
    'app.json': { expo: { plugins: [['expo-build-properties', { android: { targetSdkVersion: 35 } }]] } },
  }));
  assert.ok(ids(r, 'fail').includes('target-sdk'));
});

test('markdown report lists blocking items first and carries the disclaimer', () => {
  const r = scan(fixture({
    'package.json': { dependencies: { 'react-native': '0.72.0' } },
    'android/build.gradle': 'targetSdkVersion = 33',
    'src/A.js': "import { SafeAreaView } from 'react-native';",
  }));
  const md = toMarkdown(r);
  assert.ok(md.includes('[WARN]') && md.indexOf('[FAIL]') < md.indexOf('[WARN]'));
  assert.match(md, /does not guarantee store approval/);
});

test('scanner never writes to the project', () => {
  const root = fixture({ 'package.json': { dependencies: { 'react-native': '0.74.0' } } });
  const before = fs.readdirSync(root, { recursive: true }).sort();
  scan(root);
  assert.deepEqual(fs.readdirSync(root, { recursive: true }).sort(), before);
});
