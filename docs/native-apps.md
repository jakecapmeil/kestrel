# Kestrel on iOS, Android and Mac

All three apps are thin shells around the live site (https://kestrel.jakecapmeil.workers.dev), so a web deploy updates every app at once. The only reason to ship a new app build is changing the shell itself: its icon, permissions or the site address.

| App | Folder | Built with | Status |
|---|---|---|---|
| iPhone / iPad | `apps/mobile/ios` | Capacitor 8 (Swift Package Manager) | Builds and runs in the iOS simulator |
| Android | `apps/mobile/android` | Capacitor 8 (Gradle) | Project ready; needs the Android SDK and JDK 21 to build |
| Mac | `apps/desktop` | Electron 45 + electron-builder | `.dmg` for Apple silicon builds; unsigned |

Icons come from `apps/icon/` (`icon.svg` for iOS and Android, `mac-icon.svg` for the Mac, `adaptive-foreground.svg` for Android's adaptive icon).

## What differs from the website

- **Its own start screen.** Instead of the website's landing page, the apps open on a welcome screen (the hawk, three swipeable cards, Get started / I have an account), then a full-screen sign-in or sign-up. After sign-in, everything is the same as the website. Add `?app` to the address in a normal browser to preview it.
- **Google sign-in works in the apps through the system browser.** Google blocks its sign-in inside embedded web views, so "Continue with Google" opens Safari (iOS, through Capacitor's Browser plugin), Chrome (Android) or the default browser (Mac). The system browser first opens `https://<site>/?appauth=start&to=<Supabase authorize URL>`, which marks that browser (localStorage `k-appauth`) and continues to Google; Supabase returns to the site root with `?code=…`, and because of the mark the site forwards the code to `kestrel://auth-callback?code=…`, which the app catches (Capacitor's App plugin on iOS and Android, a protocol handler in `apps/desktop/main.js` on the Mac) and exchanges for a session where the PKCE verifier was stored. The `kestrel` URL scheme is registered in `Info.plist`, `AndroidManifest.xml` and the Mac `protocols` setting. **Supabase must allow the redirect** `https://kestrel.jakecapmeil.workers.dev/**` (Authentication → URL Configuration); `/?reset=1` already needs the same.
- **Offline:** if the site can't load, the app shows a "No connection" page with a retry button (`www/offline.html`, `apps/desktop/offline.html`).
- **Permissions**, each explained to the user:
  - Camera, photos, microphone and speech for food photos and Speak.
  - Location for recording a run.
  - On Android: `CAMERA`, `RECORD_AUDIO` and location.

## Building

### iOS (Xcode on a Mac)
```bash
cd apps/mobile && npm install && npx cap sync ios && npx cap open ios
```
In Xcode:
1. Pick your team under Signing & Capabilities.
2. Choose a device or simulator.
3. Run it. For the store, use Product → Archive, then Distribute App → App Store Connect.

### Android
You need [Android Studio](https://developer.android.com/studio), which includes the SDK and a JDK 21. It takes about 4–6 GB of disk.
```bash
cd apps/mobile && npm install && npx cap sync android && npx cap open android
```
In Android Studio:
1. Build → Generate Signed App Bundle.
2. Create an upload keystore. **Back it up**: losing it means you can't update the app.
3. Upload the `.aab` to Play Console.

### Mac (.dmg)
```bash
cd apps/desktop && npm install && npm run dmg
```
The output is `apps/desktop/dist/Kestrel-<version>-arm64.dmg` (Apple silicon). `package.json` also lists an Intel (x64) build; it wasn't produced this time because the Mac building it was low on disk.

**Updates.** The window shows the live site, so site changes reach the Mac app on their own. When the shell changes, bump `version` in `apps/desktop/package.json` and run `npm run release` there: it builds the `.dmg` and publishes it as GitHub release `mac-vX.Y.Z`. The app checks that release list at launch and every 6 hours (and under Kestrel → Check for Updates…), then offers the download. It can't replace itself silently: macOS only allows that for signed apps, so the new `.dmg` is opened and dragged over the old app. Signing (below) is what unlocks silent updates, through `electron-updater`.

The `.dmg` is **unsigned**, so macOS warns the first time it opens (right-click → Open). To make it open cleanly for everyone:
1. Get a "Developer ID Application" certificate (Apple Developer Program, $99 a year).
2. Build with `CSC_NAME="Developer ID Application: …"`.
3. Notarize: set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`, and electron-builder notarizes during the build.

## Putting them in the stores

| | Apple App Store | Google Play |
|---|---|---|
| Account | Apple Developer Program, $99 a year (individual or organization) | Google Play Console, $25 once |
| Age | You must be 18+, or enroll through a parent or guardian, or an organization such as your fiscal host | 18+ to own a developer account (same options) |
| Review | Days. Guideline 4.2 rejects apps that are "just a website". Point to the native parts (camera food logging, GPS run recording, offline page) and explain it's a coaching tool for school teams. | Hours to days. New personal accounts must run a closed test with at least 12 testers for 14 days before production. |
| Privacy forms | App Privacy "nutrition label": health and fitness, location, photos, user content, identifiers. Link `/legal#privacy`. | Data safety form, same data. Health apps need the Health apps declaration. |
| Kids and teens | Rate 12+; don't list it in the Kids category. | Target audience 13+. That triggers the Families policy checks, so make sure the privacy policy covers teens (it does). |
| Account deletion | Required in-app. Kestrel has "Delete my Kestrel data" in Settings. | Required in-app and on the web. Same link. |

**Before submitting:**
- Decide the AI question in docs/funding.md (Gemini's terms bar under-18 use). Store reviewers look at AI features aimed at teens.
- Take store screenshots: 6.9" iPhone, 13" iPad (optional), and Android phone.
- Write a short description, with the support URL and privacy URL set to the site.
- Sign in with Apple is only required when an iOS app offers another third-party sign-in. The apps offer email only, so it isn't needed now; add it if Google sign-in comes back to the apps.
