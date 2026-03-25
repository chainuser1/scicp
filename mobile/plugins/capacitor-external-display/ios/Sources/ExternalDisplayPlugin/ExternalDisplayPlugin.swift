import Foundation
import UIKit
import WebKit
import AVFoundation
import AVKit
import Capacitor

/// Capacitor plugin that detects external displays (AirPlay, HDMI via adapter)
/// and renders a WKWebView on them using UIWindow on the external UIScreen.
///
/// Communication: evaluateJavaScript() dispatches 'bridge-message' CustomEvents
/// on the external WKWebView's window object.
@objc(ExternalDisplayPlugin)
public class ExternalDisplayPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate {

    public let identifier = "ExternalDisplayPlugin"
    public let jsName = "ExternalDisplay"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startPresentation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopPresentation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendToDisplay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openCastSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acquireWakeLock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "releaseWakeLock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkCameraPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestCameraPermission", returnType: CAPPluginReturnPromise),
    ]

    private var externalWindow: UIWindow?
    private var externalWebView: WKWebView?

    override public func load() {
        registerScreenNotifications()
    }

    // MARK: - Plugin Methods
    @objc func isAvailable(_ call: CAPPluginCall) {
        let screens = UIScreen.screens
        let available = screens.count > 1
        // UIScreen doesn't expose a user-facing name; use "External Display" as placeholder.
        call.resolve(["available": available, "displayName": available ? "External Display" : ""])
    }

    @objc func startPresentation(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString) else {
            call.reject("Missing required parameter: url")
            return
        }

        guard UIScreen.screens.count > 1 else {
            call.reject("No external display available")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            let externalScreen = UIScreen.screens[1]

            // Create a window on the external screen
            let window = UIWindow(frame: externalScreen.bounds)
            window.screen = externalScreen

            // Create the WKWebView
            let config = WKWebViewConfiguration()
            config.allowsInlineMediaPlayback = true
            config.mediaTypesRequiringUserActionForPlayback = []

            let webView = WKWebView(frame: window.bounds, configuration: config)
            webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            webView.scrollView.isScrollEnabled = false
            webView.navigationDelegate = self  // fires webView(_:didFinish:) for displayReady

            let vc = UIViewController()
            vc.view.addSubview(webView)
            window.rootViewController = vc
            window.isHidden = false

            // Keep screen active
            UIApplication.shared.isIdleTimerDisabled = true

            webView.load(URLRequest(url: url))

            self.externalWindow = window
            self.externalWebView = webView

            call.resolve()
        }
    }

    @objc func stopPresentation(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.teardownPresentation()
            UIApplication.shared.isIdleTimerDisabled = false
            call.resolve()
        }
    }

    @objc func sendToDisplay(_ call: CAPPluginCall) {
        guard let message = call.getObject("message") else {
            call.reject("Missing required parameter: message")
            return
        }

        guard let webView = externalWebView else {
            call.reject("No active presentation")
            return
        }

        guard let jsonData = try? JSONSerialization.data(withJSONObject: message),
              let json = String(data: jsonData, encoding: .utf8) else {
            call.reject("Failed to serialize message")
            return
        }

        let js = "window.dispatchEvent(new CustomEvent('bridge-message',{detail:\(json)}));"

        DispatchQueue.main.async {
            webView.evaluateJavaScript(js) { _, error in
                if let error = error {
                    call.reject("evaluateJavaScript failed: \(error.localizedDescription)")
                } else {
                    call.resolve()
                }
            }
        }
    }

    /// Opens the AVRoutePickerView (AirPlay picker) anchored to the center of the screen.
    /// This is the correct iOS API for routing audio/video to Apple TV or AirPlay receivers.
    /// Falls back to app settings URL if AVRoutePickerView is unavailable.
    @objc func openCastSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let rootVC = self.bridge?.viewController,
                  let rootView = rootVC.view else {
                call.resolve(["opened": false])
                return
            }
            let picker = AVRoutePickerView(frame: .zero)
            picker.isHidden = true
            rootView.addSubview(picker)
            // Trigger the route picker programmatically
            for subview in picker.subviews {
                if let button = subview as? UIButton {
                    button.sendActions(for: .touchUpInside)
                    break
                }
            }
            picker.removeFromSuperview()
            call.resolve(["opened": true])
        }
    }

    @objc func acquireWakeLock(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = true
            call.resolve()
        }
    }

    @objc func releaseWakeLock(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = false
            call.resolve()
        }
    }

    @objc func checkCameraPermission(_ call: CAPPluginCall) {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        let state: String
        switch status {
        case .authorized:
            state = "granted"
        case .denied, .restricted:
            state = "denied"
        default:
            state = "prompt"
        }
        call.resolve(["status": state])
    }

    @objc func requestCameraPermission(_ call: CAPPluginCall) {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        if status == .authorized {
            call.resolve(["status": "granted"])
            return
        }
        if status == .denied || status == .restricted {
            call.resolve(["status": "denied"])
            return
        }
        AVCaptureDevice.requestAccess(for: .video) { granted in
            call.resolve(["status": granted ? "granted" : "denied"])
        }
    }

    // MARK: - WKNavigationDelegate (displayReady handshake)

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // External display WebView finished loading — safe to push verse state
        notifyListeners("displayReady", data: [:])
    }

    // MARK: - Screen Notifications

    private func registerScreenNotifications() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screenDidConnect),
            name: UIScreen.didConnectNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screenDidDisconnect),
            name: UIScreen.didDisconnectNotification,
            object: nil
        )
    }

    @objc private func screenDidConnect(_ notification: Notification) {
        notifyListeners("displayConnected", data: [:])
    }

    @objc private func screenDidDisconnect(_ notification: Notification) {
        DispatchQueue.main.async { [weak self] in
            self?.teardownPresentation()
        }
        notifyListeners("displayDisconnected", data: [:])
    }

    private func teardownPresentation() {
        externalWebView?.stopLoading()
        externalWebView?.removeFromSuperview()
        externalWebView = nil
        externalWindow?.isHidden = true
        externalWindow = nil
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}
