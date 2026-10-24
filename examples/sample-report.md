# Store readiness report

Project type: bare-rn · React Native 0.74.5
Result: 2 blocking · 4 warnings · 1 notes · 0 passed

## [FAIL] Android targetSdk 34: below API 35

The app is already hidden from new users on newer Android versions, and Google Play rejects updates below API 36.

Fix: Raise targetSdk and compileSdk to 36, update AGP, Gradle and the Android SDK, then fix the behavior changes below.

## [FAIL] React Native 0.74.5: 16 KB page-size risk

React Native below 0.77 ships native libraries that are not 16 KB aligned, which Google Play requires for apps targeting API 35+.

Fix: Upgrade React Native to 0.77+ (0.81+ recommended), then check native libraries with APK Analyzer.

## [WARN] Orientation is locked in AndroidManifest.xml

On API 36, orientation and aspect-ratio locks are ignored on large screens (600dp+), so layouts must handle rotation on tablets and foldables.

Fix: Test on a tablet or foldable emulator in both orientations.

## [WARN] SafeAreaView from react-native in 1 file(s)

It is deprecated and does nothing on Android, so content will sit under the system bars when edge-to-edge is enforced: src/App.tsx

Fix: Switch to SafeAreaView or useSafeAreaInsets from react-native-safe-area-context.

## [WARN] iOS builds with Xcode 26 may need an upgrade

App Store Connect requires Xcode 26 / iOS 26 SDK builds since 2026-04-28. React Native 0.74.5 commonly needs Podfile or dependency fixes to build with it.

Fix: Build a Release archive with Xcode 26 before you need to ship.

## [WARN] No PrivacyInfo.xcprivacy found

App Store Connect flags apps that use required-reason APIs (which React Native does) without a privacy manifest.

Fix: Add PrivacyInfo.xcprivacy with the required-reason API declarations.

## [INFO] iOS deployment target 13.4

Recent React Native versions require iOS 15.1 or later.

Fix: Raise the platform in the Podfile when you upgrade.

---
Static checks only. A passing report does not guarantee store approval: build, install and test a release on real devices.
