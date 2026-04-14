# Telegram2WhatsApp Sticker Converter

A bare-workflow Expo app that bridges Telegram stickers to WhatsApp native custom sticker packs.

## Animated Support
- Video sticker packs (`.webm`): Exported as true animated WebP packs on Android.
- Lottie animated packs (`.tgs`): Exported as true animated WebP packs on Android.
- Mixed chunks keep animated/video stickers animated during export.

## Platform Support
- Android: Supported
- iOS: Not supported for WhatsApp sticker export in this project

## How to Start

### 1. Prerequisites
- Node.js (v18+)
- Android Studio / Android SDK (for building the native Android code)
- A connected physical Android device or an Android Emulator running.

### 2. Configure Telegram Bot Token
1. Open the `.env` file in the root directory.
2. Go to the [@BotFather](https://t.me/botfather) bot on Telegram.
3. Message `/newbot` to generate a new Bot Token.
4. Copy the HTTP API token BotFather gives you and paste it into `.env` like this:
```bash
EXPO_PUBLIC_TELEGRAM_BOT_TOKEN="your_token_string_here"
```

### 3. Run the App
Since we wrote custom native Android code (`StickerContentProvider`, `WhatsAppStickerModule`), **you cannot use Expo Go**. You must compile the Android App.

Run the following command in the root of the project:

```bash
npx expo run:android
```

This will:
1. Start the Metro Bundler in your terminal.
2. Compile the Android `.apk` via Gradle.
3. Install the app on your connected device/emulator.

**Note:** The first time you run this, Android dependency fetching can take 5-10 minutes.

### 4. How to Use
1. Once the app is running on your phone, paste a telegram pack URL (for example: `https://t.me/addstickers/Animals`).
2. Click **Analyze & Convert** (This might take a few seconds as it downloads the stickers and converts them to WhatsApp limits).
3. Use quality presets (`FAST`, `SMALL`, `BEST`) as needed.
4. Optionally use queue controls to process remaining chunks in the background and retry failed chunks.
5. Run diagnostics from Home/Preview if you want to verify native WhatsApp integration checks.
6. Review the preview grid and click **Add to WhatsApp**.
4. WhatsApp should open asking if you'd like to add the pack to your collection!

## Engineering Guardrails
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Tests: `npm run test`

## Release Signing (Android)
Release builds require explicit keystore properties:

```properties
MYAPP_UPLOAD_STORE_FILE=/absolute/path/to/your-release-keystore.jks
MYAPP_UPLOAD_STORE_PASSWORD=your_store_password
MYAPP_UPLOAD_KEY_ALIAS=your_key_alias
MYAPP_UPLOAD_KEY_PASSWORD=your_key_password
```

Set these in `android/gradle.properties` or pass with `-P` flags when building release.
