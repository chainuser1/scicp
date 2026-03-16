package com.scriptures.inview.externaldisplay;

import android.app.Presentation;
import android.content.Context;
import android.hardware.display.DisplayManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Display;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor plugin that detects external displays (HDMI, Miracast, Chromecast)
 * and renders a WebView on them using Android's Presentation API.
 *
 * Communication: evaluateJavascript() dispatches 'bridge-message' CustomEvents
 * on the external WebView's window object.
 */
@CapacitorPlugin(name = "ExternalDisplay")
public class ExternalDisplayPlugin extends Plugin {

    private static final String TAG = "ExternalDisplay";
    private DisplayManager displayManager;
    private ExternalPresentation presentation;
    private DisplayManager.DisplayListener displayListener;

    @Override
    public void load() {
        Log.d(TAG, "Plugin loaded");
        displayManager = (DisplayManager) getContext().getSystemService(Context.DISPLAY_SERVICE);
        registerDisplayListener();
    }

    // ── Plugin methods ──────────────────────────────────────────────────────

    @PluginMethod
    public void isAvailable(PluginCall call) {
        Display d = findPresentationDisplay();
        Log.d(TAG, "isAvailable called, display=" + (d != null ? d.getName() + " id=" + d.getDisplayId() : "null"));
        JSObject result = new JSObject();
        result.put("available", d != null);
        call.resolve(result);
    }

    @PluginMethod
    public void startPresentation(PluginCall call) {
        String url = call.getString("url");
        Log.d(TAG, "startPresentation url=" + url);
        if (url == null || url.isEmpty()) {
            call.reject("Missing required parameter: url");
            return;
        }

        Display display = findPresentationDisplay();
        if (display == null) {
            Log.w(TAG, "startPresentation: no external display found");
            call.reject("No external display available");
            return;
        }

        Log.d(TAG, "startPresentation on display: " + display.getName() + " id=" + display.getDisplayId());
        getActivity().runOnUiThread(() -> {
            try {
                if (presentation != null) {
                    presentation.dismiss();
                }
                presentation = new ExternalPresentation(getContext(), display, url);
                presentation.show();
                call.resolve();
            } catch (Exception e) {
                call.reject("Failed to start presentation: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void stopPresentation(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (presentation != null) {
                presentation.dismiss();
                presentation = null;
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void sendToDisplay(PluginCall call) {
        JSObject message = call.getObject("message");
        if (message == null) {
            call.reject("Missing required parameter: message");
            return;
        }

        if (presentation == null || presentation.getWebView() == null) {
            call.reject("No active presentation");
            return;
        }

        String json = message.toString();
        // Escape for JS injection
        String escaped = json.replace("\\", "\\\\").replace("'", "\\'");
        String js = "window.dispatchEvent(new CustomEvent('bridge-message',{detail:" + escaped + "}));";

        getActivity().runOnUiThread(() -> {
            presentation.getWebView().evaluateJavascript(js, null);
            call.resolve();
        });
    }

    // ── Display detection ───────────────────────────────────────────────────

    private Display findPresentationDisplay() {
        if (displayManager == null) return null;
        Display[] displays = displayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION);
        Log.d(TAG, "PRESENTATION displays: " + (displays != null ? displays.length : 0));
        if (displays != null) {
            for (Display display : displays) {
                Log.d(TAG, "  PRES display: id=" + display.getDisplayId() + " name=" + display.getName() + " state=" + display.getState());
                if (isUsableExternalDisplay(display)) return display;
            }
        }

        // Fallback: some devices report cast/virtual outputs outside
        // DISPLAY_CATEGORY_PRESENTATION but still as non-default active displays.
        Display[] allDisplays = displayManager.getDisplays();
        Log.d(TAG, "ALL displays: " + (allDisplays != null ? allDisplays.length : 0));
        if (allDisplays != null) {
            for (Display display : allDisplays) {
                Log.d(TAG, "  ALL display: id=" + display.getDisplayId() + " name=" + display.getName() + " state=" + display.getState() + " default=" + (display.getDisplayId() == Display.DEFAULT_DISPLAY));
                if (isUsableExternalDisplay(display)) return display;
            }
        }
        return null;
    }

    private boolean isUsableExternalDisplay(Display display) {
        if (display == null) return false;
        if (display.getDisplayId() == Display.DEFAULT_DISPLAY) return false;
        return display.getState() != Display.STATE_OFF;
    }

    private void registerDisplayListener() {
        if (displayManager == null) return;

        final Handler handler = new Handler(Looper.getMainLooper());

        displayListener = new DisplayManager.DisplayListener() {
            @Override
            public void onDisplayAdded(int displayId) {
                // Miracast/virtual displays may not be added to DISPLAY_CATEGORY_PRESENTATION
                // immediately — wait 800ms then check if a presentation display is available.
                handler.postDelayed(() -> {
                    if (findPresentationDisplay() != null) {
                        notifyListeners("displayConnected", new JSObject());
                    }
                }, 800);
            }

            @Override
            public void onDisplayRemoved(int displayId) {
                // If the removed display was our presentation, clean up
                if (presentation != null) {
                    getActivity().runOnUiThread(() -> {
                        presentation.dismiss();
                        presentation = null;
                    });
                }
                notifyListeners("displayDisconnected", new JSObject());
            }

            @Override
            public void onDisplayChanged(int displayId) {
                // Miracast display state can change to PRESENTATION after initial add —
                // notify if this display is now available as a presentation display.
                handler.postDelayed(() -> {
                    if (findPresentationDisplay() != null) {
                        notifyListeners("displayConnected", new JSObject());
                    }
                }, 400);
            }
        };

        displayManager.registerDisplayListener(displayListener, null);
    }

    @Override
    protected void handleOnDestroy() {
        if (displayManager != null && displayListener != null) {
            displayManager.unregisterDisplayListener(displayListener);
        }
        if (presentation != null) {
            presentation.dismiss();
            presentation = null;
        }
    }

    // ── Presentation (WebView on external display) ──────────────────────────

    private static class ExternalPresentation extends Presentation {
        private WebView webView;
        private final String url;

        ExternalPresentation(Context context, Display display, String url) {
            super(context, display);
            this.url = url;
        }

        @Override
        protected void onCreate(Bundle savedInstanceState) {
            super.onCreate(savedInstanceState);

            webView = new WebView(getContext());
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setAllowFileAccess(true);

            webView.setWebViewClient(new WebViewClient());
            webView.setWebChromeClient(new WebChromeClient());

            setContentView(webView);

            // Keep screen on while presenting
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

            webView.loadUrl(url);
        }

        WebView getWebView() {
            return webView;
        }
    }
}
