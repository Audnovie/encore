import AVKit
import UIKit
import WebKit

/// The whole app: Encore's page in a web view, filling the screen, with the player behind it.
/// Before an address is set (or when the page can't be reached) a native screen asks for one.
final class RootViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    let engine = PlayerEngine()
    lazy var bridge = Bridge(engine: engine)
    private(set) var webView: WKWebView!
    private let setup = SetupView()
    private let problem = ProblemView()
    private let routePicker = AVRoutePickerView(frame: CGRect(x: 0, y: 0, width: 2, height: 2))
    /// what the page asked for (light text on dark screens)
    private var pageStatusStyle: UIStatusBarStyle = .default
    private var helloCheck: DispatchWorkItem?
    private var loadedAddress: URL?
    private var testPanel: TestPanel?

    /// the page's choice, or the system's over the first screen and the problem screen
    override var preferredStatusBarStyle: UIStatusBarStyle {
        (setup.isHidden && problem.isHidden) ? pageStatusStyle : .default
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        // UI tests: start as if just installed
        let fresh = TestMode.on && UserDefaults.standard.bool(forKey: "EncoreFreshStart")
        engine.store = PlayerStore.standard()
        if fresh {
            UserDefaults.standard.removeObject(forKey: Bridge.logKey)
            engine.store?.clear()
        }
        engine.resumeSaved()
        makeWebView()

        // AirPlay: the page's AirPlay button opens this picker's list
        routePicker.alpha = 0.02
        routePicker.isAccessibilityElement = false
        routePicker.prioritizesVideoDevices = false
        view.addSubview(routePicker)

        for v in [setup, problem] as [UIView] {
            v.frame = view.bounds
            v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            v.isHidden = true
            view.addSubview(v)
        }
        setup.onConnect = { [weak self] url in
            guard let self = self else { return }
            // another address is another copy of Encore: the player stops, and the news for the old page goes
            if let old = self.loadedAddress, old.absoluteString != url.absoluteString { self.bridge.forgetAll() }
            Address.saved = url
            self.open(url)
        }
        setup.onCancel = { [weak self] in
            self?.setup.isHidden = true
            self?.setup.endEditing(true)
            self?.setNeedsStatusBarAppearanceUpdate()
        }
        problem.onRetry = { [weak self] in
            guard let self = self, let a = Address.saved else { return }
            self.open(a)
        }
        problem.onChangeAddress = { [weak self] in self?.showSetup(cancellable: false) }
        problem.onUseAnyway = { [weak self] in
            self?.problem.isHidden = true
            self?.setNeedsStatusBarAppearanceUpdate()
        }

        bridge.onUIMessage = { [weak self] type, body in self?.uiMessage(type, body) }

        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(resigningActive), name: UIApplication.willResignActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(wentToBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)

        if TestMode.on {
            let panel = TestPanel(controller: self)
            panel.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(panel)
            NSLayoutConstraint.activate([
                panel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                panel.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                panel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 60),
            ])
            testPanel = panel
        }

        let start: () -> Void = { [weak self] in
            guard let self = self else { return }
            if let a = Address.saved { self.open(a) } else { self.showSetup(cancellable: false) }
        }
        if fresh {
            WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast, completionHandler: start)
        } else {
            start()
        }
    }

    // MARK: - the web view

    private func makeWebView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let ucc = WKUserContentController()
        ucc.addUserScript(WKUserScript(source: Bridge.pageScript(appVersion: RootViewController.appVersion),
                                       injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if TestMode.on {
            ucc.addUserScript(WKUserScript(source: TestPanel.pageHelpers, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        ucc.add(bridge, name: Bridge.handlerName)
        config.userContentController = ucc

        let wv = WKWebView(frame: view.bounds, configuration: config)
        wv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.allowsBackForwardNavigationGestures = false
        wv.allowsLinkPreview = false
        wv.isOpaque = false
        wv.backgroundColor = .systemBackground
        wv.scrollView.backgroundColor = .systemBackground
        wv.scrollView.bounces = false
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.accessibilityIdentifier = "encorePage"
        #if DEBUG
        if #available(iOS 16.4, *) { wv.isInspectable = true }
        #endif
        view.addSubview(wv)
        webView = wv
        bridge.webView = wv
    }

    static var appVersion: String {
        let info = Bundle.main.infoDictionary ?? [:]
        let v = info["CFBundleShortVersionString"] as? String ?? "?"
        let b = info["CFBundleVersion"] as? String ?? "?"
        return "\(v) (\(b))"
    }

    func open(_ url: URL) {
        setup.isHidden = true
        setup.endEditing(true)
        problem.isHidden = true
        helloCheck?.cancel()
        bridge.pageGone()
        loadedAddress = url
        webView.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 20))
        setNeedsStatusBarAppearanceUpdate()
    }

    func showSetup(cancellable: Bool) {
        setup.prepare(current: Address.saved, cancellable: cancellable)
        setup.isHidden = false
        view.bringSubviewToFront(setup)
        if let p = testPanel { view.bringSubviewToFront(p) }
        setNeedsStatusBarAppearanceUpdate()
    }

    private func showProblem(_ kind: ProblemView.Kind) {
        problem.show(kind, address: loadedAddress)
        view.bringSubviewToFront(problem)
        if let p = testPanel { view.bringSubviewToFront(p) }
        setNeedsStatusBarAppearanceUpdate()
    }

    // MARK: - messages from the page for the app around it

    private func uiMessage(_ type: String, _ body: [String: Any]) {
        switch type {
        case "statusBar":
            let style = body["style"] as? String
            pageStatusStyle = style == "light" ? .lightContent : style == "dark" ? .darkContent : .default
            setNeedsStatusBarAppearanceUpdate()
        case "airplay":
            showAirPlay()
        case "changeAddress":
            showSetup(cancellable: true)
        case "paste":
            // iOS asks you before the app can read what was copied in another app
            let text = UIPasteboard.general.string ?? ""
            bridge.send(["type": "paste", "text": text])
        default:
            break
        }
    }

    private func showAirPlay() {
        func button(in v: UIView) -> UIButton? {
            if let b = v as? UIButton { return b }
            for s in v.subviews { if let b = button(in: s) { return b } }
            return nil
        }
        button(in: routePicker)?.sendActions(for: .touchUpInside)
    }

    // MARK: - the app's life

    @objc private func becameActive() {
        bridge.appActive()
    }

    @objc private func resigningActive() {
        bridge.save()
        engine.saveState()
    }

    @objc private func wentToBackground() {
        bridge.appInBackground()
        engine.saveState()
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        let isMain = action.targetFrame?.isMainFrame ?? true
        if url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
            decisionHandler(.allow)
            return
        }
        if let home = loadedAddress, Address.sameSite(url, home) {
            decisionHandler(.allow)
            return
        }
        if !isMain {
            decisionHandler(.allow)
            return
        }
        // links to other sites open in Safari
        if url.scheme == "http" || url.scheme == "https" || url.scheme == "mailto" {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if response.isForMainFrame, let http = response.response as? HTTPURLResponse, http.statusCode >= 400 {
            decisionHandler(.cancel)
            showProblem(.httpError(http.statusCode))
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        bridge.pageGone()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadFailed(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadFailed(error)
    }

    private func loadFailed(_ error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return } // "frame load interrupted" after a policy cancel
        showProblem(.unreachable(e.localizedDescription))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Encore 1.5 and later say hello as soon as they start. If nothing does, say what's wrong.
        helloCheck?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.checkHello() }
        helloCheck = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: w)
    }

    private func checkHello() {
        guard !bridge.pageReady, problem.isHidden, setup.isHidden else { return }
        webView.evaluateJavaScript("(window.__encore && window.__encore.version) || ''") { [weak self] result, _ in
            guard let self = self, !self.bridge.pageReady else { return }
            let v = result as? String ?? ""
            self.showProblem(v.isEmpty ? .notEncore : .oldEncore(v))
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // the page's process was closed (iOS does this to save memory): load it again; the player plays on
        bridge.pageGone()
        if let a = loadedAddress { webView.load(URLRequest(url: a)) }
    }

    // MARK: - WKUIDelegate

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }
}
