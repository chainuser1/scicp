import Foundation
import UIKit
import WebKit
import Capacitor

/// Capacitor plugin that detects external displays (AirPlay, HDMI via adapter)
/// and renders a WKWebView on them using UIWindow on the external UIScreen.
///
/// Communication: evaluateJavaScript() dispatches 'bridge-message' CustomEvents
/// on the external WKWebView's window object.
@objc(ExternalDisplayPlugin)
public class ExternalDisplayPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "ExternalDisplayPlugin"
    public let jsName = "ExternalDisplay"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startPresentation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopPresentation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendToDisplay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openCastSettings", returnType: CAPPluginReturnPromise),
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
        call.resolve(["available": available])
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

    @objc func openCastSettings(_ call: CAPPluginCall) {
        guard let settingsURL = URL(string: UIApplication.openSettingsURLString) else {
            call.resolve(["opened": false])
            return
        }
        DispatchQueue.main.async {
            if UIApplication.shared.canOpenURL(settingsURL) {
                UIApplication.shared.open(settingsURL, options: [:]) { ok in
                    call.resolve(["opened": ok])
                }
            } else {
                call.resolve(["opened": false])
            }
        }
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
