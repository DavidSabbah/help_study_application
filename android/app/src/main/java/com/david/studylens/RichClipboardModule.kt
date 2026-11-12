package com.david.studylens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import android.util.Base64
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.io.File
import java.io.FileOutputStream

/**
 * One clipboard item: the cropped page image, then the prompt text.
 * NotebookLM never uses this path; it receives OCR text only.
 */
class RichClipboardModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "RichClipboard"

  @ReactMethod
  fun setImageThenText(images: ReadableArray, text: String, promise: Promise) {
    try {
      val clip = clipOf(writePage(images), text)
      reactApplicationContext.runOnUiQueueThread {
        try {
          val clipboard =
            reactApplicationContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
          clipboard.setPrimaryClip(clip)
          promise.resolve(true)
        } catch (err: Exception) {
          promise.reject("E_CLIP", err.message, err)
        }
      }
    } catch (err: Exception) {
      promise.reject("E_CLIP", err.message, err)
    }
  }

  @ReactMethod
  fun shareImageThenText(images: ReadableArray, text: String, promise: Promise) {
    try {
      val uri = writePage(images)
      reactApplicationContext.runOnUiQueueThread {
        try {
          val send = Intent(Intent.ACTION_SEND).apply {
            type = "image/jpeg"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TEXT, text)
            clipData = ClipData.newRawUri("page", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          }
          val activity = reactApplicationContext.currentActivity
            ?: throw IllegalStateException("The screen is not ready to share.")
          activity.startActivity(Intent.createChooser(send, "Share the page"))
          promise.resolve(true)
        } catch (err: Exception) {
          promise.reject("E_SHARE", err.message, err)
        }
      }
    } catch (err: Exception) {
      promise.reject("E_SHARE", err.message, err)
    }
  }

  private fun writePage(images: ReadableArray): Uri {
    val bitmaps = mutableListOf<Bitmap>()
    for (i in 0 until images.size()) {
      val raw = images.getString(i).trim()
      if (raw.isEmpty()) continue
      bitmaps.add(decode(raw))
    }
    if (bitmaps.isEmpty()) {
      throw IllegalArgumentException("No cropped image to copy.")
    }
    val page = combine(bitmaps)
    return try {
      saveJpeg(page)
    } finally {
      if (page !in bitmaps && !page.isRecycled) page.recycle()
      bitmaps.forEach { if (!it.isRecycled) it.recycle() }
    }
  }

  private fun decode(raw: String): Bitmap {
    val clean = if (raw.contains(",")) raw.substringAfter(",") else raw
    val bytes = Base64.decode(clean, Base64.DEFAULT)
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
      ?: throw IllegalArgumentException("Could not read the cropped image.")
  }

  private fun combine(bitmaps: List<Bitmap>): Bitmap {
    val fitted = bitmaps.map { fitWidth(it, MAX_WIDTH) }
    if (fitted.size == 1) return fitted[0]
    val gap = 28
    val width = fitted.maxOf { it.width }
    val height = fitted.sumOf { it.height } + gap * (fitted.size - 1)
    val sheet = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(sheet)
    canvas.drawColor(Color.WHITE)
    var y = 0
    for (bmp in fitted) {
      val x = (width - bmp.width) / 2f
      canvas.drawBitmap(bmp, x, y.toFloat(), null)
      y += bmp.height + gap
    }
    fitted.forEach { if (it !in bitmaps && !it.isRecycled) it.recycle() }
    return fitHeight(sheet, MAX_HEIGHT)
  }

  private fun fitWidth(bitmap: Bitmap, maxWidth: Int): Bitmap {
    if (bitmap.width <= maxWidth) return bitmap
    val height = (bitmap.height * (maxWidth.toFloat() / bitmap.width)).toInt().coerceAtLeast(1)
    return Bitmap.createScaledBitmap(bitmap, maxWidth, height, true)
  }

  private fun fitHeight(bitmap: Bitmap, maxHeight: Int): Bitmap {
    if (bitmap.height <= maxHeight) return bitmap
    val width = (bitmap.width * (maxHeight.toFloat() / bitmap.height)).toInt().coerceAtLeast(1)
    val scaled = Bitmap.createScaledBitmap(bitmap, width, maxHeight, true)
    if (scaled != bitmap && !bitmap.isRecycled) bitmap.recycle()
    return scaled
  }

  private fun saveJpeg(bitmap: Bitmap): Uri {
    val dir = File(reactApplicationContext.cacheDir, "pageclip")
    dir.mkdirs()
    val file = File(dir, "page-${System.currentTimeMillis()}.jpg")
    FileOutputStream(file).use { out ->
      if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 92, out)) {
        throw IllegalStateException("Could not write the cropped image.")
      }
    }
    return FileProvider.getUriForFile(
      reactApplicationContext,
      "${reactApplicationContext.packageName}.pageclipboard",
      file
    )
  }

  private fun clipOf(uri: Uri, text: String): ClipData {
    val html = "<img src=\"${escapeHtml(uri.toString())}\"><br>${escapeHtml(text).replace("\n", "<br>")}"
    val item = ClipData.Item(text, html, null, uri)
    return ClipData("StudyLens", arrayOf("image/jpeg", "text/plain", "text/html"), item)
  }

  private fun escapeHtml(value: String): String {
    return value
      .replace("&", "&amp;")
      .replace("<", "&lt;")
      .replace(">", "&gt;")
      .replace("\"", "&quot;")
  }

  companion object {
    private const val MAX_WIDTH = 2000
    private const val MAX_HEIGHT = 6000
  }
}
