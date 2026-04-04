package com.telegram2whatsapp

import android.content.ContentProvider
import android.content.ContentValues
import android.content.UriMatcher
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException

class StickerContentProvider : ContentProvider() {

    companion object {
        const val AUTHORITY = BuildConfig.APPLICATION_ID + ".stickercontentprovider"
        private const val METADATA = "metadata"
        private const val STICKERS = "stickers"
        private const val STICKERS_ASSET = "stickers_asset"
        const val MATCHER_PACKS = 1
        const val MATCHER_PACK_BY_ID = 2
        const val MATCHER_STICKERS = 3
        const val MATCHER_STICKERS_ASSET = 4
        private val uriMatcher = UriMatcher(UriMatcher.NO_MATCH).apply {
            addURI(AUTHORITY, METADATA, MATCHER_PACKS)
            addURI(AUTHORITY, "$METADATA/*", MATCHER_PACK_BY_ID)
            addURI(AUTHORITY, "$STICKERS/*", MATCHER_STICKERS)
            addURI(AUTHORITY, "$STICKERS_ASSET/*/*", MATCHER_STICKERS_ASSET)
        }
    }

    private fun getStickerAssetsDir(): File {
        return File(context!!.filesDir, "sticker_assets")
    }

    private fun getContentsJson(): JSONObject? {
        val file = File(getStickerAssetsDir(), "contents.json")
        if (!file.exists()) return null
        return JSONObject(file.readText())
    }

    private fun getEmptyStickerCursor(): MatrixCursor {
        return MatrixCursor(arrayOf("sticker_file_name", "sticker_emoji", "sticker_accessibility_text"))
    }

    override fun onCreate(): Boolean {
        val packageName = context?.packageName ?: ""
        if (!AUTHORITY.startsWith(packageName)) {
            throw IllegalStateException("Provider authority must start with package name. authority=$AUTHORITY package=$packageName")
        }
        Log.d("StickerContentProvider", "Created provider for authority=$AUTHORITY")
        return true
    }

    private fun findPackByIdentifier(packsArray: JSONArray, identifier: String): JSONObject? {
        for (i in 0 until packsArray.length()) {
            val pack = packsArray.optJSONObject(i) ?: continue
            if (pack.optString("identifier") == identifier) {
                return pack
            }
        }
        return null
    }

    override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor {
        val contents = getContentsJson()
        val packsArray = contents?.optJSONArray("sticker_packs") ?: JSONArray()

        return when (uriMatcher.match(uri)) {
            MATCHER_PACKS -> {
                getPacksCursor(packsArray)
            }
            MATCHER_PACK_BY_ID -> {
                val identifier = uri.pathSegments.getOrNull(1)
                if (identifier.isNullOrBlank()) {
                    return createPackCursor()
                }
                val pack = findPackByIdentifier(packsArray, identifier)
                if (pack == null) createPackCursor() else getPackCursor(pack)
            }
            MATCHER_STICKERS -> {
                val identifier = uri.pathSegments.getOrNull(1)
                if (identifier.isNullOrBlank()) {
                    return getEmptyStickerCursor()
                }
                val pack = findPackByIdentifier(packsArray, identifier)
                if (pack == null) {
                    getEmptyStickerCursor()
                } else {
                    getStickersCursor(pack)
                }
            }
            else -> throw IllegalArgumentException("Unknown URI: $uri")
        }
    }

    private fun getPacksCursor(packsArray: JSONArray): Cursor {
        val cursor = createPackCursor()
        for (i in 0 until packsArray.length()) {
            val pack = packsArray.optJSONObject(i) ?: continue
            addPackRow(cursor, pack)
        }
        return cursor
    }

    private fun createPackCursor(): MatrixCursor {
        return MatrixCursor(arrayOf(
            "sticker_pack_identifier",
            "sticker_pack_name",
            "sticker_pack_publisher",
            "sticker_pack_icon",
            "android_play_store_link",
            "ios_app_download_link",
            "sticker_pack_publisher_email",
            "sticker_pack_publisher_website",
            "sticker_pack_privacy_policy_website",
            "sticker_pack_license_agreement_website",
            "image_data_version",
            "whatsapp_will_not_cache_stickers",
            "animated_sticker_pack"
        ))
    }

    private fun addPackRow(cursor: MatrixCursor, packObj: JSONObject) {
        cursor.addRow(arrayOf(
            packObj.optString("identifier"),
            packObj.optString("name"),
            packObj.optString("publisher"),
            packObj.optString("tray_image_file"),
            "",
            "",
            packObj.optString("publisher_email"),
            packObj.optString("publisher_website"),
            packObj.optString("privacy_policy_website"),
            packObj.optString("license_agreement_website"),
            packObj.optString("image_data_version", "1"),
            if (packObj.optBoolean("avoid_cache", false)) 1 else 0,
            if (packObj.optBoolean("animated_sticker_pack", false)) 1 else 0
        ))
    }

    private fun getPackCursor(packObj: JSONObject): Cursor {
        val cursor = createPackCursor()
        addPackRow(cursor, packObj)
        return cursor
    }

    private fun getStickersCursor(packObj: JSONObject): Cursor {
        val cursor = MatrixCursor(arrayOf("sticker_file_name", "sticker_emoji", "sticker_accessibility_text"))
        val stickersObj = packObj.optJSONArray("stickers") ?: JSONArray()
        for (i in 0 until stickersObj.length()) {
            val sticker = stickersObj.getJSONObject(i)

            val emojis = sticker.optJSONArray("emojis")
            val emojiValue = if (emojis != null) {
                val parts = mutableListOf<String>()
                for (index in 0 until emojis.length()) {
                    val emoji = emojis.optString(index)
                    if (emoji.isNotBlank()) {
                        parts.add(emoji)
                    }
                }
                parts.joinToString(",")
            } else {
                ""
            }

            cursor.addRow(arrayOf(
                sticker.optString("image_file"),
                emojiValue,
                sticker.optString("accessibility_text", "")
            ))
        }
        return cursor
    }

    override fun openAssetFile(uri: Uri, mode: String): AssetFileDescriptor? {
        val descriptor = openFile(uri, mode) ?: return null
        return AssetFileDescriptor(descriptor, 0, AssetFileDescriptor.UNKNOWN_LENGTH)
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
        if (uriMatcher.match(uri) != MATCHER_STICKERS_ASSET) {
            throw FileNotFoundException("Unsupported URI: $uri")
        }

        val pathSegments = uri.pathSegments
        if (pathSegments.size < 3) throw FileNotFoundException("Unknown URI $uri")

        val identifier = pathSegments[1]
        val fileName = pathSegments[2]

        val contents = getContentsJson() ?: throw FileNotFoundException("contents.json is missing")
        val packsArray = contents.optJSONArray("sticker_packs") ?: JSONArray()
        val pack = findPackByIdentifier(packsArray, identifier)
            ?: throw FileNotFoundException("Unknown sticker pack identifier: $identifier")

        val trayFile = pack.optString("tray_image_file")
        val stickers = pack.optJSONArray("stickers") ?: JSONArray()
        val allowedFiles = mutableSetOf<String>()
        if (trayFile.isNotBlank()) {
            allowedFiles.add(trayFile)
        }
        for (i in 0 until stickers.length()) {
            val sticker = stickers.optJSONObject(i) ?: continue
            val imageFile = sticker.optString("image_file")
            if (imageFile.isNotBlank()) {
                allowedFiles.add(imageFile)
            }
        }

        if (!allowedFiles.contains(fileName)) {
            throw FileNotFoundException("File $fileName does not belong to pack $identifier")
        }

        val file = File(getStickerAssetsDir(), fileName)
        if (!file.exists()) throw FileNotFoundException("File not found: $fileName")

        Log.d("StickerContentProvider", "Serving asset for pack=$identifier file=$fileName")
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun getType(uri: Uri): String {
        return when (uriMatcher.match(uri)) {
            MATCHER_PACKS -> "vnd.android.cursor.dir/vnd.$AUTHORITY.$METADATA"
            MATCHER_PACK_BY_ID -> "vnd.android.cursor.item/vnd.$AUTHORITY.$METADATA"
            MATCHER_STICKERS -> "vnd.android.cursor.dir/vnd.$AUTHORITY.$STICKERS"
            MATCHER_STICKERS_ASSET -> {
                val fileName = uri.pathSegments.getOrNull(2).orEmpty()
                if (fileName.endsWith(".png", ignoreCase = true)) "image/png" else "image/webp"
            }
            else -> throw IllegalArgumentException("Unknown URI: $uri")
        }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = 0
}
