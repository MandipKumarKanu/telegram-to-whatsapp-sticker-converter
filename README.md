# Telegram2WhatsApp Sticker Converter

A bare-workflow Expo app that bridges Telegram static stickers to WhatsApp native custom sticker packs.

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
2. Click **Fetch Pack** (This might take a few seconds as it downloads the stickers and converts them properly to WebP format limits).
3. Review the preview grid and click **Add to WhatsApp**.
4. WhatsApp should open asking if you'd like to add the pack to your collection!
