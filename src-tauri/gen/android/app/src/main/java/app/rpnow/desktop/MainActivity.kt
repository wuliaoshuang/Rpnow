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
