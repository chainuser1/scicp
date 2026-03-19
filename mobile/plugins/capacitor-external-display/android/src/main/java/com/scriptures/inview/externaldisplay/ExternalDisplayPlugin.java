package com.scriptures.inview.externaldisplay;

import android.Manifest;
import android.app.Presentation;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.hardware.display.DisplayManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.Display;
import android.view.WindowManager;
import android.content.res.AssetManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import com.getcapacitor.JSObject;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.List;

/**
 * Capacitor plugin that detects external displays (HDMI, Miracast, Chromecast)
 * and renders a WebView on them using Android's Presentation API.
 *
 * Communication: evaluateJavascript() dispatches 'bridge-message' CustomEvents
 * on the external WebView's window object.
 */
@CapacitorPlugin(
    name = "ExternalDisplay",
    permissions = {
        @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera")
    }
)
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

        getActivity().runOnUiThread(() -> {
            presentation.dispatchBridgeMessage(json);
            call.resolve();
        });
    }

    @PluginMethod
    public void checkCameraPermission(PluginCall call) {
        String state;
        switch (getPermissionState("camera")) {
            case GRANTED:  state = "granted";  break;
            case DENIED:   state = "denied";   break;
            default:       state = "prompt";   break;
        }
        JSObject result = new JSObject();
        result.put("status", state);
        call.resolve(result);
    }

    @PluginMethod
    public void requestCameraPermission(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("status", "granted");
            call.resolve(result);
        } else {
            requestPermissionForAlias("camera", call, "cameraPermissionCallback");
        }
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("status", getPermissionState("camera") == PermissionState.GRANTED ? "granted" : "denied");
        call.resolve(result);
    }

    @PluginMethod
    public void openCastSettings(PluginCall call) {
        try {
            Intent castIntent = new Intent(Settings.ACTION_CAST_SETTINGS);
            castIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(castIntent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
            return;
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "ACTION_CAST_SETTINGS unavailable", e);
        } catch (Exception e) {
            Log.w(TAG, "Failed to open cast settings", e);
        }

        try {
            Intent wifiDisplayIntent = new Intent("android.settings.WIFI_DISPLAY_SETTINGS");
            wifiDisplayIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(wifiDisplayIntent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
            return;
        } catch (Exception e) {
            Log.w(TAG, "ACTION_WIFI_DISPLAY_SETTINGS unavailable", e);
        }

        JSObject result = new JSObject();
        result.put("opened", false);
        call.resolve(result);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception e) {
            JSObject result = new JSObject();
            result.put("opened", false);
            call.resolve(result);
        }
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
        private boolean pageReady = false;
        private final List<String> pendingMessages = new ArrayList<>();

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
            settings.setAllowContentAccess(true);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

            // Serve APK web assets (assets/public/) via http://localhost/
            WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain("localhost")
                .setHttpAllowed(true)
                .addPathHandler("/", path -> {
                    try {
                        AssetManager am = getContext().getAssets();
                        InputStream is = am.open("public" + path);
                        Map<String, String> headers = new HashMap<>();
                        headers.put("Access-Control-Allow-Origin", "*");
                        String mime = "application/octet-stream";
                        if (path.endsWith(".html")) mime = "text/html";
                        else if (path.endsWith(".js")) mime = "application/javascript";
                        else if (path.endsWith(".css")) mime = "text/css";
                        else if (path.endsWith(".json")) mime = "application/json";
                        else if (path.endsWith(".svg")) mime = "image/svg+xml";
                        else if (path.endsWith(".png")) mime = "image/png";
                        else if (path.endsWith(".woff2")) mime = "font/woff2";
                        else if (path.endsWith(".woff")) mime = "font/woff";
                        else if (path.endsWith(".wasm")) mime = "application/wasm";
                        return new WebResourceResponse(mime, "utf-8", 200, "OK", headers, is);
                    } catch (IOException e) {
                        Log.w(TAG, "Asset not found: public" + path);
                        return null;
                    }
                })
                .build();

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    WebResourceResponse res = assetLoader.shouldInterceptRequest(request.getUrl());
                    return res != null ? res : super.shouldInterceptRequest(view, request);
                }

                @Override
                public void onPageFinished(WebView view, String loadedUrl) {
                    pageReady = true;
                    flushPendingMessages();
                    Log.d(TAG, "External display page ready: " + loadedUrl);
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    super.onReceivedError(view, request, error);
                    Log.w(TAG, "External display load error: " + error);
                }
            });
            webView.setWebChromeClient(new WebChromeClient());

            setContentView(webView);

            // Keep screen on while presenting
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

            webView.loadUrl(url);
        }

        WebView getWebView() {
            return webView;
        }

        void dispatchBridgeMessage(String json) {
            if (webView == null) return;
            // JSON is already a valid JS expression — inject it directly as the detail value
            String js = "window.dispatchEvent(new CustomEvent('bridge-message',{detail:" + json + "}));";
            if (!pageReady) {
                pendingMessages.add(js);
                return;
            }
            webView.evaluateJavascript(js, null);
        }

        private void flushPendingMessages() {
            if (webView == null || pendingMessages.isEmpty()) return;
            for (String js : pendingMessages) {
                webView.evaluateJavascript(js, null);
            }
            pendingMessages.clear();
        }
    }
}
