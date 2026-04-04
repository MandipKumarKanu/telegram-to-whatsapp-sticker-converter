package com.telegram2whatsapp

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.database.Cursor
import android.content.ContentResolver
import android.content.res.AssetFileDescriptor
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import android.util.Log
import java.io.File

class WhatsAppStickerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        private const val ADD_STICKER_PACK_REQUEST_CODE = 8142
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

            val intent = Intent()
            intent.action = "com.whatsapp.intent.action.ENABLE_STICKER_PACK"
            intent.putExtra("sticker_pack_id", identifier)
            intent.putExtra("sticker_pack_authority", StickerContentProvider.AUTHORITY)
            intent.putExtra("sticker_pack_name", packName)
            intent.putExtra("sticker_pack_publisher", "StickerBridge By Mandy")
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            Log.d("WhatsAppStickerModule", "Launching add flow for pack id=$identifier name=$packName")

            // Try WhatsApp
            intent.setPackage("com.whatsapp")
            try {
                validateProviderReadable(identifier)
                val isAlreadyWhitelisted = isWhitelisted("com.whatsapp.provider.sticker_whitelist_check", identifier)
                Log.d("WhatsAppStickerModule", "Whitelist check (com.whatsapp): $isAlreadyWhitelisted")
                Log.d("WhatsAppStickerModule", "Starting intent with package com.whatsapp")
                pendingPromise = promise
                activity.startActivityForResult(intent, ADD_STICKER_PACK_REQUEST_CODE)
                return
            } catch (e: ActivityNotFoundException) {
                // Try WhatsApp Business if normal WhatsApp is not installed
                intent.setPackage("com.whatsapp.w4b")
                try {
                    validateProviderReadable(identifier)
                    val isAlreadyWhitelisted = isWhitelisted("com.whatsapp.w4b.provider.sticker_whitelist_check", identifier)
                    Log.d("WhatsAppStickerModule", "Whitelist check (com.whatsapp.w4b): $isAlreadyWhitelisted")
                    Log.d("WhatsAppStickerModule", "Starting intent with package com.whatsapp.w4b")
                    pendingPromise = promise
                    activity.startActivityForResult(intent, ADD_STICKER_PACK_REQUEST_CODE)
                    return
                } catch (ex: ActivityNotFoundException) {
                    pendingPromise = null
                    promise.reject("E_WHATSAPP_NOT_INSTALLED", "WhatsApp is not installed on this device.")
                }
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
            Log.e("WhatsAppStickerModule", "WhatsApp validation error: $validationError")
            promise.reject("E_WHATSAPP_VALIDATION", validationError)
            return
        }

        Log.w("WhatsAppStickerModule", "WhatsApp add flow cancelled or failed. resultCode=$resultCode")
        promise.reject("E_WHATSAPP_CANCELLED", "Sticker pack was not added in WhatsApp.")
    }

    override fun onNewIntent(intent: Intent) {
        // No-op
    }
}
