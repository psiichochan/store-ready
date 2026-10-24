# store-ready

A free, read-only scanner that checks a React Native or Expo app against current Google Play and App Store submission rules. It never modifies your project.

```
npx store-ready ./my-app          # Markdown report
npx store-ready ./my-app --json   # machine-readable
```
(Before it's published to npm: `node bin/store-ready.js ./my-app`.) Exits with code 1 when something would block a store submission, so it can run in CI.

See [examples/sample-report.md](examples/sample-report.md) for the output on a React Native 0.74 project.

## What it checks

| Check | Why it matters |
|---|---|
| Android targetSdk / compileSdk | Google Play requires API 36 for new apps and updates since 2026-08-31 (extension to 2026-11-01). Below API 35, existing apps stop showing up for new users on newer Android versions. |
| React Native version < 0.77 | Native libraries are not 16 KB page aligned. |
| Expo SDK < 54 | Doesn't target API 36 by default. |
| `windowOptOutEdgeToEdgeEnforcement` | Ignored at API 36, so the UI draws under the system bars. |
| `SafeAreaView` from `react-native`, StatusBar color/translucency | Deprecated or a no-op under enforced edge-to-edge. |
| Locked `screenOrientation` | Ignored on large screens at API 36. |
| BackHandler, predictive-back opt-out | Behavior changes with predictive back. |
| Prebuilt `jniLibs` | Need 16 KB alignment. |
| iOS: RN version vs Xcode 26, Podfile target, `PrivacyInfo.xcprivacy` | App Store Connect requires Xcode 26 builds since 2026-04-28. |

## Limits

These are static checks only. A clean report doesn't guarantee store approval. Build, install and test a release build on real devices.

## Tests

```
npm test
```
