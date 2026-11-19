package app.rpnow.desktop

import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var webview: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    /*
     * Enabled unconditionally so the WebView can be inspected with
     * `adb forward … webview_devtools_remote` + Chrome DevTools while chasing
     * layout bugs on a real device. `BuildConfig.DEBUG` was false for release
     * builds, which is exactly when those bugs appear.
     */
    WebView.setWebContentsDebuggingEnabled(true)

    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    applyStatusBar()
  }

  /**
   * The web app notifies theme changes through this bridge (see `applyTheme` in
   * boot.ts). Light themes need **dark** status-bar glyphs on the transparent
   * bar; dark themes need white ones.
   */
  inner class StatusBarBridge {
    @JavascriptInterface
    fun setStyle(mode: String) {
      runOnUiThread { applyStatusBar(mode == "light") }
    }

    /**
     * 把图片写进系统公共「下载」目录（MediaStore）。
     *
     * 为什么需要原生：安卓 WebView 里 `<a download>` 点击会被静默丢弃，
     * `navigator.share` 也不可用 —— 前端两条退路都落不了盘。Android 10+
     * 走 [MediaStore.Downloads] 无需任何存储权限；更早的系统直接写公共目录并
     * 触发媒体扫描。返回 `"ok"` 表示已落盘（用户在文件管理器/Download 可见）。
     */
    @JavascriptInterface
    fun saveToDownloads(fileName: String, base64: String): String {
      return try {
        val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
        val safeName = fileName.ifBlank { "rpnow-${System.currentTimeMillis()}.png" }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.Downloads.DISPLAY_NAME, safeName)
            put(android.provider.MediaStore.Downloads.MIME_TYPE, mimeOf(safeName))
            put(android.provider.MediaStore.Downloads.IS_PENDING, 1)
          }
          val uri = contentResolver.insert(
            android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values,
          ) ?: return "insert-failed"
          contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return "open-failed"
          values.clear()
          values.put(android.provider.MediaStore.Downloads.IS_PENDING, 0)
          contentResolver.update(uri, values, null, null)
          "ok"
        } else {
          @Suppress("DEPRECATION")
          val dir = android.os.Environment.getExternalStoragePublicDirectory(
            android.os.Environment.DIRECTORY_DOWNLOADS,
          )
          dir.mkdirs()
          val file = java.io.File(dir, safeName)
          file.writeBytes(bytes)
          sendBroadcast(
            android.content.Intent(
              android.content.Intent.ACTION_MEDIA_SCANNER_SCAN_FILE,
              android.net.Uri.fromFile(file),
            ),
          )
          "ok"
        }
      } catch (e: Exception) {
        "error:" + (e.message ?: e.javaClass.simpleName)
      }
    }

    private fun mimeOf(name: String): String = when {
      name.endsWith(".jpg", true) || name.endsWith(".jpeg", true) -> "image/jpeg"
      name.endsWith(".webp", true) -> "image/webp"
      name.endsWith(".gif", true) -> "image/gif"
      else -> "image/png"
    }
  }

  /**
   * wry creates its WebView asynchronously, so the instance is grabbed on every
   * focus pass until it exists. The JS side also retries after boot, which
   * covers the case where the theme was set before the bridge was attached.
   */
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus && webview == null) {
      webview = findWebView(window.decorView)
      webview?.addJavascriptInterface(StatusBarBridge(), "RPNowNative")
    }
  }

  private fun findWebView(root: View): WebView? {
    if (root is WebView) return root
    if (root is ViewGroup) {
      for (i in 0 until root.childCount) {
        findWebView(root.getChildAt(i))?.let { return it }
      }
    }
    return null
  }

  /**
   * Transparent, edge-to-edge status bar. `lightTheme` inverts the glyph
   * colour: the app's header sits under the bar, so the glyphs must contrast
   * with the *theme's* background, not with a fixed colour.
   */
  private fun applyStatusBar(lightTheme: Boolean = false) {
    window.statusBarColor = android.graphics.Color.TRANSPARENT
    WindowCompat.setDecorFitsSystemWindows(window, false)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.insetsController?.apply {
        val flags = if (lightTheme) {
          // Dark glyphs on a light background.
          WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        } else {
          0
        }
        setSystemBarsAppearance(
          flags,
          WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          window.attributes.layoutInDisplayCutoutMode =
            WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
      }
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      @Suppress("DEPRECATION")
      val flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
      window.decorView.systemUiVisibility =
        if (lightTheme) {
          window.decorView.systemUiVisibility or flags
        } else {
          window.decorView.systemUiVisibility and flags.inv()
        }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      window.attributes.layoutInDisplayCutoutMode =
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }
  }
}
