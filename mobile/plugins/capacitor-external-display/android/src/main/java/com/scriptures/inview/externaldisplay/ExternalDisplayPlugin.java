package com.scriptures.inview.externaldisplay;

import android.app.Presentation;
import android.content.Context;
import android.hardware.display.DisplayManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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

    private DisplayManager displayManager;
    private ExternalPresentation presentation;
    private DisplayManager.DisplayListener displayListener;

    @Override
    public void load() {
        displayManager = (DisplayManager) getContext().getSystemService(Context.DISPLAY_SERVICE);
        registerDisplayListener();
    }

    // ── Plugin methods ──────────────────────────────────────────────────────

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", findPresentationDisplay() != null);
        call.resolve(result);
    }

    @PluginMethod
    public void startPresentation(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Missing required parameter: url");
            return;
        }

        Display display = findPresentationDisplay();
        if (display == null) {
            call.reject("No external display available");
            return;
        }

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
        return (displays != null && displays.length > 0) ? displays[0] : null;
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
