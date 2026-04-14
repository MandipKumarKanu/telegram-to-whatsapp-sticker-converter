package com.telegram2whatsapp

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.database.Cursor
import android.content.ContentResolver
import android.content.res.AssetFileDescriptor
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.media.MediaMetadataRetriever
import com.airbnb.lottie.LottieComposition
import com.airbnb.lottie.LottieCompositionFactory
import com.airbnb.lottie.LottieDrawable
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import android.util.Log
import com.aureusapps.android.webpandroid.encoder.WebPAnimEncoder
import com.aureusapps.android.webpandroid.encoder.WebPAnimEncoderOptions
import com.aureusapps.android.webpandroid.encoder.WebPConfig
import com.aureusapps.android.webpandroid.encoder.WebPEncoder
import com.aureusapps.android.webpandroid.encoder.WebPMuxAnimParams
import com.aureusapps.android.webpandroid.encoder.WebPPreset
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.ReturnCode
import java.io.File
import java.util.Locale
import java.util.zip.GZIPInputStream

class WhatsAppStickerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        private const val ADD_STICKER_PACK_REQUEST_CODE = 8142
        private const val STICKER_SIZE = 512
        private const val MAX_ANIM_DURATION_MS = 3000L
    }

    private var pendingPromise: Promise? = null

    init {
        reactContext.addActivityEventListener(this)
        Log.d("WhatsAppStickerModule", "Native module initialized")
    }

    override fun getName(): String {
        return "WhatsAppStickerModule"
    }

    private fun resolveDirPath(pathOrUri: String): File {
        val parsed = Uri.parse(pathOrUri)
        if (parsed.scheme == "file" && parsed.path != null) {
            return File(parsed.path!!)
        }
        return File(pathOrUri)
    }

    private data class TranscodeOptions(
        val fps: Int,
        val quality: Float,
        val method: Int,
    )

    private fun transcodeOptionsForPreset(preset: String): TranscodeOptions {
        return when (preset.lowercase(Locale.US)) {
            "fast" -> TranscodeOptions(fps = 8, quality = 52f, method = 4)
            "small" -> TranscodeOptions(fps = 10, quality = 46f, method = 6)
            else -> TranscodeOptions(fps = 12, quality = 60f, method = 5)
        }
    }

    private fun transcodeVideoWithFfmpeg(
        inputFile: File,
        outputFile: File,
        mode: String,
        options: TranscodeOptions,
    ) {
        val quality = options.quality.toInt().coerceIn(35, 85)
        val compressionLevel = options.method.coerceIn(3, 6)
        val fps = options.fps.coerceIn(8, 14)
        val durationSeconds = String.format(Locale.US, "%.1f", MAX_ANIM_DURATION_MS / 1000.0)
        val baseFilter =
            "scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease:flags=lanczos," +
                "pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba"

        val command = when (mode.lowercase(Locale.US)) {
            "animated-webp" ->
                "-y -i \"${inputFile.absolutePath}\" -an -t $durationSeconds " +
                    "-vf \"fps=$fps,$baseFilter\" " +
                    "-c:v libwebp -preset picture -lossless 0 -q:v $quality " +
                    "-compression_level $compressionLevel -loop 0 -vsync 0 " +
                    "-pix_fmt yuva420p \"${outputFile.absolutePath}\""

            "still-webp" ->
                "-y -ss 0.5 -i \"${inputFile.absolutePath}\" -an -frames:v 1 " +
                    "-vf \"$baseFilter\" " +
                    "-c:v libwebp -compression_level $compressionLevel " +
                    "-quality $quality -lossless 0 \"${outputFile.absolutePath}\""

            else -> throw IllegalArgumentException("Unsupported transcode mode: $mode")
        }

        val session = FFmpegKit.execute(command)
        val returnCode = session.returnCode
        if (!ReturnCode.isSuccess(returnCode) || !outputFile.exists() || outputFile.length() <= 0L) {
            throw IllegalStateException("FFmpeg video transcode failed (mode=$mode, returnCode=$returnCode)")
        }
    }

    private fun fitBitmapToStickerCanvas(source: Bitmap): Bitmap {
        val targetSize = STICKER_SIZE
        val outputBitmap = Bitmap.createBitmap(targetSize, targetSize, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(outputBitmap)
        val paint = Paint(Paint.FILTER_BITMAP_FLAG)

        val sourceWidth = source.width.toFloat().coerceAtLeast(1f)
        val sourceHeight = source.height.toFloat().coerceAtLeast(1f)
        val scale = minOf(targetSize / sourceWidth, targetSize / sourceHeight)

        val destWidth = sourceWidth * scale
        val destHeight = sourceHeight * scale
        val left = (targetSize - destWidth) / 2f
        val top = (targetSize - destHeight) / 2f

        val destRect = android.graphics.RectF(left, top, left + destWidth, top + destHeight)
        canvas.drawBitmap(source, null, destRect, paint)

        return outputBitmap
    }

    private fun decodeTgsJson(inputFile: File): String {
        return try {
            GZIPInputStream(inputFile.inputStream()).bufferedReader(Charsets.UTF_8).use { it.readText() }
        } catch (_: Exception) {
            // Some tools may already provide decompressed JSON; support both forms.
            inputFile.readText()
        }
    }

    private fun loadTgsComposition(inputFile: File): LottieComposition {
        val tgsJson = decodeTgsJson(inputFile)
        val parseResult = LottieCompositionFactory.fromJsonStringSync(tgsJson, inputFile.name)
        return parseResult.value
            ?: throw IllegalStateException(
                parseResult.exception?.message
                    ?: "Failed to parse Telegram TGS animation.",
            )
    }

    private fun createTgsDrawable(composition: LottieComposition): LottieDrawable {
        return LottieDrawable().apply {
            setComposition(composition)
            setBounds(0, 0, STICKER_SIZE, STICKER_SIZE)
        }
    }

    private fun renderTgsFrame(drawable: LottieDrawable, progress: Float): Bitmap {
        val frameBitmap = Bitmap.createBitmap(STICKER_SIZE, STICKER_SIZE, Bitmap.Config.ARGB_8888)
        val frameCanvas = Canvas(frameBitmap)
        drawable.progress = progress.coerceIn(0f, 1f)
        drawable.draw(frameCanvas)
        return frameBitmap
    }

    private fun encodeStillWebpFromVideo(inputFile: File, outputFile: File, options: TranscodeOptions) {
        val retriever = MediaMetadataRetriever()
        var frameBitmap: Bitmap? = null
        var fittedBitmap: Bitmap? = null
        var encoder: WebPEncoder? = null

        try {
            retriever.setDataSource(inputFile.absolutePath)
            val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull() ?: 0L
            val frameTimeMs = if (durationMs > 0) durationMs / 2 else 0

            frameBitmap = retriever.getFrameAtTime(frameTimeMs * 1000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                ?: throw IllegalStateException("Failed to decode frame from video")

            fittedBitmap = fitBitmapToStickerCanvas(frameBitmap)
            encoder = WebPEncoder(reactApplicationContext, STICKER_SIZE, STICKER_SIZE)
            encoder.configure(
                config = WebPConfig(
                    lossless = WebPConfig.COMPRESSION_LOSSY,
                    quality = options.quality,
                    method = options.method,
                    alphaCompression = WebPConfig.ALPHA_COMPRESSION_WITH_LOSSLESS,
                ),
                preset = WebPPreset.WEBP_PRESET_PICTURE,
            )
            encoder.encode(fittedBitmap, Uri.fromFile(outputFile))
        } finally {
            encoder?.release()
            fittedBitmap?.recycle()
            frameBitmap?.recycle()
            retriever.release()
        }
    }

    private fun encodeStillWebpFromTgs(inputFile: File, outputFile: File, options: TranscodeOptions) {
        var frameBitmap: Bitmap? = null
        var encoder: WebPEncoder? = null

        try {
            val composition = loadTgsComposition(inputFile)
            val drawable = createTgsDrawable(composition)

            frameBitmap = renderTgsFrame(drawable, 0.5f)
            encoder = WebPEncoder(reactApplicationContext, STICKER_SIZE, STICKER_SIZE)
            encoder.configure(
                config = WebPConfig(
                    lossless = WebPConfig.COMPRESSION_LOSSY,
                    quality = options.quality,
                    method = options.method,
                    alphaCompression = WebPConfig.ALPHA_COMPRESSION_WITH_LOSSLESS,
                ),
                preset = WebPPreset.WEBP_PRESET_DRAWING,
            )
            encoder.encode(frameBitmap, Uri.fromFile(outputFile))
        } finally {
            encoder?.release()
            frameBitmap?.recycle()
        }
    }

    private fun encodeAnimatedWebpFromVideo(inputFile: File, outputFile: File, options: TranscodeOptions) {
        val retriever = MediaMetadataRetriever()
        var encoder: WebPAnimEncoder? = null

        try {
            retriever.setDataSource(inputFile.absolutePath)

            val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull()
                ?.coerceAtLeast(500L)
                ?: 2000L
            val clippedDurationMs = durationMs.coerceAtMost(MAX_ANIM_DURATION_MS)
            val frameDelayMs = (1000f / options.fps).toLong().coerceAtLeast(80L)
            val requestedFrames = (clippedDurationMs / frameDelayMs).toInt().coerceIn(6, 48)

            encoder = WebPAnimEncoder(
                context = reactApplicationContext,
                width = STICKER_SIZE,
                height = STICKER_SIZE,
                options = WebPAnimEncoderOptions(
                    allowMixed = false,
                    minimizeSize = false,
                    animParams = WebPMuxAnimParams(loopCount = 0),
                ),
            )
            encoder.configure(
                config = WebPConfig(
                    lossless = WebPConfig.COMPRESSION_LOSSY,
                    quality = options.quality,
                    method = options.method,
                    alphaCompression = WebPConfig.ALPHA_COMPRESSION_WITH_LOSSLESS,
                ),
                preset = WebPPreset.WEBP_PRESET_PICTURE,
            )

            var addedFrames = 0
            for (i in 0 until requestedFrames) {
                val timeUs = (i * frameDelayMs * 1000L).coerceAtMost(clippedDurationMs * 1000L)
                val frameBitmap = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST)
                    ?: continue

                val fittedBitmap = fitBitmapToStickerCanvas(frameBitmap)
                frameBitmap.recycle()

                encoder.addFrame(addedFrames * frameDelayMs, fittedBitmap)
                fittedBitmap.recycle()
                addedFrames += 1
            }

            if (addedFrames < 6) {
                throw IllegalStateException("Could not extract enough frames for animated sticker.")
            }

            val animationDurationMs = addedFrames * frameDelayMs
            encoder.assemble(animationDurationMs, Uri.fromFile(outputFile))
        } finally {
            encoder?.release()
            retriever.release()
        }
    }

    private fun encodeAnimatedWebpFromTgs(inputFile: File, outputFile: File, options: TranscodeOptions) {
        var encoder: WebPAnimEncoder? = null

        try {
            val composition = loadTgsComposition(inputFile)
            val drawable = createTgsDrawable(composition)

            val compositionFrames = (composition.endFrame - composition.startFrame).coerceAtLeast(1f)
            val compositionFrameRate = composition.frameRate.coerceAtLeast(1f)
            val compositionDurationMs = ((compositionFrames / compositionFrameRate) * 1000f)
                .toLong()
                .coerceAtLeast(500L)
            val clippedDurationMs = compositionDurationMs.coerceAtMost(MAX_ANIM_DURATION_MS)
            val frameDelayMs = (1000f / options.fps).toLong().coerceAtLeast(80L)
            val requestedFrames = (clippedDurationMs / frameDelayMs).toInt().coerceIn(6, 48)

            encoder = WebPAnimEncoder(
                context = reactApplicationContext,
                width = STICKER_SIZE,
                height = STICKER_SIZE,
                options = WebPAnimEncoderOptions(
                    allowMixed = false,
                    minimizeSize = false,
                    animParams = WebPMuxAnimParams(loopCount = 0),
                ),
            )
            encoder.configure(
                config = WebPConfig(
                    lossless = WebPConfig.COMPRESSION_LOSSY,
                    quality = options.quality,
                    method = options.method,
                    alphaCompression = WebPConfig.ALPHA_COMPRESSION_WITH_LOSSLESS,
                ),
                preset = WebPPreset.WEBP_PRESET_DRAWING,
            )

            var addedFrames = 0
            for (i in 0 until requestedFrames) {
                val frameTimeMs = (i * frameDelayMs).coerceAtMost(clippedDurationMs)
                val progress = if (clippedDurationMs <= 0L) {
                    0f
                } else {
                    (frameTimeMs.toFloat() / clippedDurationMs.toFloat()).coerceIn(0f, 1f)
                }

                val frameBitmap = renderTgsFrame(drawable, progress)
                encoder.addFrame(addedFrames * frameDelayMs, frameBitmap)
                frameBitmap.recycle()
                addedFrames += 1
            }

            if (addedFrames < 6) {
                throw IllegalStateException("Could not render enough frames for animated TGS sticker.")
            }

            val animationDurationMs = addedFrames * frameDelayMs
            encoder.assemble(animationDurationMs, Uri.fromFile(outputFile))
        } finally {
            encoder?.release()
        }
    }

    @ReactMethod
    fun transcodeVideoSticker(
        inputPathOrUri: String,
        outputPathOrUri: String,
        mode: String,
        preset: String,
        promise: Promise,
    ) {
        try {
            val inputFile = resolveDirPath(inputPathOrUri)
            if (!inputFile.exists()) {
                promise.reject("E_INPUT_MISSING", "Input file does not exist: $inputPathOrUri")
                return
            }

            val outputFile = resolveDirPath(outputPathOrUri)
            outputFile.parentFile?.let { parent ->
                if (!parent.exists()) {
                    parent.mkdirs()
                }
            }
            if (outputFile.exists()) {
                outputFile.delete()
            }

            val options = transcodeOptionsForPreset(preset)
            try {
                transcodeVideoWithFfmpeg(inputFile, outputFile, mode, options)
            } catch (ffmpegError: Exception) {
                Log.w(
                    "WhatsAppStickerModule",
                    "FFmpeg video transcode failed, falling back to internal encoder: ${ffmpegError.message}",
                )

                when (mode.lowercase(Locale.US)) {
                    "animated-webp" -> encodeAnimatedWebpFromVideo(inputFile, outputFile, options)
                    "still-webp" -> encodeStillWebpFromVideo(inputFile, outputFile, options)
                    else -> {
                        promise.reject("E_TRANSCODE_MODE", "Unsupported transcode mode: $mode")
                        return
                    }
                }
            }

            if (!outputFile.exists() || outputFile.length() <= 0L) {
                promise.reject("E_TRANSCODE_FAILED", "Video transcode produced an empty output file.")
                return
            }

            promise.resolve(outputFile.absolutePath)
        } catch (e: Exception) {
            promise.reject("E_TRANSCODE_FAILED", "Video transcode failed: ${e.message}")
        }
    }

    @ReactMethod
    fun generateTrayIcon(inputPathOrUri: String, outputPathOrUri: String, promise: Promise) {
        try {
            val inputFile = resolveDirPath(inputPathOrUri)
            if (!inputFile.exists()) {
                promise.reject("E_INPUT_MISSING", "Input file does not exist")
                return
            }

            val outputFile = resolveDirPath(outputPathOrUri)
            outputFile.parentFile?.let { parent ->
                if (!parent.exists()) {
                    parent.mkdirs()
                }
            }

            val options = android.graphics.BitmapFactory.Options()
            options.inPreferredConfig = Bitmap.Config.ARGB_8888
            val sourceBitmap = android.graphics.BitmapFactory.decodeFile(inputFile.absolutePath, options)
                ?: throw IllegalStateException("Could not decode WebP or Image for tray icon. Ensure file is a valid image.")

            val destBitmap = Bitmap.createScaledBitmap(sourceBitmap, 96, 96, true)

            java.io.FileOutputStream(outputFile).use { out ->
                destBitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            }

            sourceBitmap.recycle()
            destBitmap.recycle()

            promise.resolve(outputFile.absolutePath)
        } catch (e: Exception) {
            promise.reject("E_TRAY_FAILED", "Failed to generate tray icon natively: ${e.message}")
        }
    }

    @ReactMethod
    fun transcodeTgsSticker(
        inputPathOrUri: String,
        outputPathOrUri: String,
        mode: String,
        preset: String,
        promise: Promise,
    ) {
        try {
            val inputFile = resolveDirPath(inputPathOrUri)
            if (!inputFile.exists()) {
                promise.reject("E_INPUT_MISSING", "Input file does not exist: $inputPathOrUri")
                return
            }

            val outputFile = resolveDirPath(outputPathOrUri)
            outputFile.parentFile?.let { parent ->
                if (!parent.exists()) {
                    parent.mkdirs()
                }
            }
            if (outputFile.exists()) {
                outputFile.delete()
            }

            val options = transcodeOptionsForPreset(preset)
            when (mode.lowercase(Locale.US)) {
                "animated-webp" -> encodeAnimatedWebpFromTgs(inputFile, outputFile, options)
                "still-webp" -> encodeStillWebpFromTgs(inputFile, outputFile, options)
                else -> {
                    promise.reject("E_TRANSCODE_MODE", "Unsupported transcode mode: $mode")
                    return
                }
            }

            if (!outputFile.exists() || outputFile.length() <= 0L) {
                promise.reject("E_TRANSCODE_FAILED", "TGS transcode produced an empty output file.")
                return
            }

            promise.resolve(outputFile.absolutePath)
        } catch (e: Exception) {
            promise.reject("E_TRANSCODE_FAILED", "TGS transcode failed: ${e.message}")
        }
    }

    private fun syncStickerAssets(sourceDirPathOrUri: String) {
        val sourceDir = resolveDirPath(sourceDirPathOrUri)

        if (!sourceDir.exists() || !sourceDir.isDirectory) {
            throw IllegalArgumentException("Sticker source directory not found: $sourceDirPathOrUri")
        }

        val targetDir = File(reactApplicationContext.filesDir, "sticker_assets")
        val sourceCanonical = sourceDir.canonicalPath
        val targetCanonical = targetDir.canonicalPath

        Log.d("WhatsAppStickerModule", "syncStickerAssets source=$sourceCanonical target=$targetCanonical")

        // If JS already staged into filesDir, avoid deleting the same directory.
        if (sourceCanonical == targetCanonical) {
            val contentsSameDir = File(targetDir, "contents.json")
            if (!contentsSameDir.exists() || contentsSameDir.length() == 0L) {
                throw IllegalStateException("contents.json is missing in sticker assets directory")
            }
            return
        }

        if (targetDir.exists()) {
            if (!targetDir.deleteRecursively()) {
                throw IllegalStateException("Could not clear internal sticker assets directory")
            }
        }
        if (!targetDir.exists() && !targetDir.mkdirs()) {
            throw IllegalStateException("Could not create internal sticker assets directory")
        }

        val files = sourceDir.listFiles()
            ?: throw IllegalStateException("No files found in source directory")

        var contentsFound = false

        files.forEach { file ->
            if (file.isFile) {
                val target = File(targetDir, file.name)
                file.copyTo(target, overwrite = true)

                if (!target.exists() || target.length() == 0L) {
                    throw IllegalStateException("Failed to copy file: ${file.name}")
                }
                if (file.name == "contents.json") {
                    contentsFound = true
                }
            }
        }

        if (!contentsFound) {
            throw IllegalStateException("contents.json not found in source directory")
        }
    }

    private fun getPackCountFromMetadata(cursor: Cursor): Int {
        val identifierIndex = cursor.getColumnIndex("sticker_pack_identifier")
        if (identifierIndex < 0) {
            return 0
        }
        return cursor.count
    }

    private fun requireColumnIndex(cursor: Cursor, columnName: String): Int {
        val index = cursor.getColumnIndex(columnName)
        if (index < 0) {
            throw IllegalStateException("Missing required cursor column: $columnName")
        }
        return index
    }

    private fun openReadAsset(resolver: ContentResolver, uri: Uri) {
        val descriptor: AssetFileDescriptor =
            resolver.openAssetFileDescriptor(uri, "r")
                ?: throw IllegalStateException("Could not open asset descriptor for URI: $uri")
        descriptor.close()
    }

    private fun validateProviderReadable(identifier: String) {
        val resolver = reactApplicationContext.contentResolver
        val metadataUri = Uri.parse("content://${StickerContentProvider.AUTHORITY}/metadata")
        val allPacksCursor = resolver.query(metadataUri, null, null, null, null)
            ?: throw IllegalStateException("Sticker provider metadata query returned null.")
        allPacksCursor.use {
            val packCount = getPackCountFromMetadata(it)
            if (packCount <= 0) {
                throw IllegalStateException("Sticker provider returned no packs.")
            }
        }

        val singlePackUri = Uri.parse("content://${StickerContentProvider.AUTHORITY}/metadata/$identifier")
        val packCursor = resolver.query(singlePackUri, null, null, null, null)
            ?: throw IllegalStateException("Sticker provider single-pack query returned null.")

        var trayFileName: String? = null
        packCursor.use {
            if (!it.moveToFirst()) {
                throw IllegalStateException("Sticker pack metadata for id=$identifier not found.")
            }
            val trayColumn = requireColumnIndex(it, "sticker_pack_icon")
            trayFileName = it.getString(trayColumn)
        }

        val stickersUri = Uri.parse("content://${StickerContentProvider.AUTHORITY}/stickers/$identifier")
        val stickersCursor = resolver.query(stickersUri, null, null, null, null)
            ?: throw IllegalStateException("Sticker provider stickers query returned null.")

        var firstStickerFileName: String? = null
        stickersCursor.use {
            if (it.count < 3 || it.count > 30) {
                throw IllegalStateException("Sticker pack must contain 3 to 30 stickers. Found: ${it.count}")
            }
            val stickerColumn = requireColumnIndex(it, "sticker_file_name")
            if (it.moveToFirst()) {
                firstStickerFileName = it.getString(stickerColumn)
            }
        }

        val tray = trayFileName
        if (tray.isNullOrBlank()) {
            throw IllegalStateException("Tray icon file name is missing from metadata.")
        }
        val firstSticker = firstStickerFileName
        if (firstSticker.isNullOrBlank()) {
            throw IllegalStateException("No sticker files available for metadata validation.")
        }

        openReadAsset(
            resolver,
            Uri.parse("content://${StickerContentProvider.AUTHORITY}/stickers_asset/$identifier/$tray")
        )
        openReadAsset(
            resolver,
            Uri.parse("content://${StickerContentProvider.AUTHORITY}/stickers_asset/$identifier/$firstSticker")
        )

        Log.d(
            "WhatsAppStickerModule",
            "Provider validation passed for pack=$identifier tray=$tray firstSticker=$firstSticker"
        )
    }

    private fun isWhitelisted(authorityProvider: String, identifier: String): Boolean {
        return try {
            val resolver = reactApplicationContext.contentResolver
            val uri = Uri.parse(
                "content://$authorityProvider/is_whitelisted?authority=${StickerContentProvider.AUTHORITY}&identifier=$identifier"
            )
            val cursor = resolver.query(uri, null, null, null, null) ?: return false
            cursor.use {
                val resultColumn = it.getColumnIndex("result")
                if (resultColumn < 0 || !it.moveToFirst()) {
                    return false
                }
                return it.getInt(resultColumn) == 1
            }
        } catch (e: Exception) {
            Log.w("WhatsAppStickerModule", "Whitelist check failed for $authorityProvider: ${e.message}")
                return false
        }
    }

    private fun resolveSupportedTargets(activity: Activity): List<String> {
        val baseIntent = Intent().apply {
            action = "com.whatsapp.intent.action.ENABLE_STICKER_PACK"
        }

        return activity.packageManager
            .queryIntentActivities(baseIntent, 0)
            .map { it.activityInfo.packageName }
            .distinct()
    }

    @ReactMethod
    fun runBasicDiagnostics(promise: Promise) {
        try {
            val result = Arguments.createMap()
            result.putString("providerAuthority", StickerContentProvider.AUTHORITY)

            val activity = reactApplicationContext.currentActivity
            result.putBoolean("hasForegroundActivity", activity != null)

            if (activity != null) {
                val targets = resolveSupportedTargets(activity)
                val targetsArray = Arguments.createArray()
                targets.forEach { targetsArray.pushString(it) }
                result.putArray("supportedTargets", targetsArray)
                result.putBoolean("whatsappInstalled", targets.isNotEmpty())

                val whitelistChecks = Arguments.createMap()
                whitelistChecks.putBoolean(
                    "com.whatsapp",
                    isWhitelisted("com.whatsapp.provider.sticker_whitelist_check", "diagnostics"),
                )
                whitelistChecks.putBoolean(
                    "com.whatsapp.w4b",
                    isWhitelisted("com.whatsapp.w4b.provider.sticker_whitelist_check", "diagnostics"),
                )
                result.putMap("whitelistProviderReachable", whitelistChecks)
            } else {
                result.putBoolean("whatsappInstalled", false)
                result.putArray("supportedTargets", Arguments.createArray())
            }

            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("E_DIAGNOSTICS", "Failed to run diagnostics: ${e.message}")
        }
    }

    @ReactMethod
    fun sendStickerPack(destDir: String, identifier: String, packName: String, promise: Promise) {
        if (pendingPromise != null) {
            promise.reject("E_IN_PROGRESS", "Another add-to-WhatsApp request is already in progress.")
            return
        }

        try {
            syncStickerAssets(destDir)

            val activity: Activity? = reactApplicationContext.currentActivity
            if (activity == null) {
                promise.reject("E_NO_ACTIVITY", "Current activity is null. Please keep the app in foreground.")
                return
            }

            val supportedTargets = resolveSupportedTargets(activity)
            if (supportedTargets.isEmpty()) {
                promise.reject("E_WHATSAPP_NOT_INSTALLED", "No supported version of WhatsApp is installed on this device.")
                pendingPromise = null
                return
            }

            // Prefer official ones if they exist, else just take the first one found
            val targetPackage = supportedTargets.let { foundApps ->
                foundApps.firstOrNull { it == "com.whatsapp" }
                    ?: foundApps.firstOrNull { it == "com.whatsapp.w4b" }
                    ?: foundApps.first()
            }

            val intent = Intent()
            intent.action = "com.whatsapp.intent.action.ENABLE_STICKER_PACK"
            intent.putExtra("sticker_pack_id", identifier)
            intent.putExtra("sticker_pack_authority", StickerContentProvider.AUTHORITY)
            intent.putExtra("sticker_pack_name", packName)
            intent.putExtra("sticker_pack_publisher", "StickerBridge By Mandy")
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            intent.setPackage(targetPackage)
            
            Log.d("WhatsAppStickerModule", "Launching add flow for pack id=$identifier name=$packName targeting=$targetPackage")

            validateProviderReadable(identifier)

            try {
                Log.d("WhatsAppStickerModule", "Starting intent with package $targetPackage")
                pendingPromise = promise
                activity.startActivityForResult(intent, ADD_STICKER_PACK_REQUEST_CODE)
            } catch (e: ActivityNotFoundException) {
                Log.d("WhatsAppStickerModule", "$targetPackage not found or doesn't handle the intent")
                pendingPromise = null
                promise.reject("E_WHATSAPP_NOT_INSTALLED", "Target WhatsApp package could not be launched.")
            }

        } catch (e: Exception) {
            pendingPromise = null
            promise.reject("E_UNKNOWN", "An error occurred while launching WhatsApp: " + e.message)
        }
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != ADD_STICKER_PACK_REQUEST_CODE) {
            return
        }

        val promise = pendingPromise ?: return
        pendingPromise = null

        if (resultCode == Activity.RESULT_OK) {
            Log.d("WhatsAppStickerModule", "WhatsApp add flow completed successfully")
            promise.resolve("SUCCESS")
            return
        }

        val validationError = data?.getStringExtra("validation_error")
        if (!validationError.isNullOrBlank()) {
            val extras = data.extras
            val payload = if (extras != null && !extras.isEmpty) {
                extras.keySet().joinToString("; ") { key ->
                    val value = extras.get(key)
                    "$key=$value"
                }
            } else {
                ""
            }
            val finalMessage = if (payload.isBlank()) {
                validationError
            } else {
                "$validationError ($payload)"
            }
            Log.e("WhatsAppStickerModule", "WhatsApp validation error: $finalMessage")
            promise.reject("E_WHATSAPP_VALIDATION", finalMessage)
            return
        }

        val extras = data?.extras
        if (extras != null && !extras.isEmpty) {
            val payload = extras.keySet().joinToString("; ") { key ->
                val value = extras.get(key)
                "$key=$value"
            }
            Log.e("WhatsAppStickerModule", "WhatsApp add flow failed with extras: $payload")
            promise.reject(
                "E_WHATSAPP_VALIDATION",
                "WhatsApp rejected this sticker pack. Details: $payload",
            )
            return
        }

        Log.w("WhatsAppStickerModule", "WhatsApp add flow cancelled or failed. resultCode=$resultCode")
        promise.reject("E_WHATSAPP_CANCELLED", "Sticker pack was not added in WhatsApp.")
    }

    override fun onNewIntent(intent: Intent) {
        // No-op
    }
}
