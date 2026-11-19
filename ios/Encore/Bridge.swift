import UIKit
import WebKit

/// Carries messages between the page (Encore's web app in the web view) and the player.
///
/// The page → app: `window.EncoreNative.post(message)`, which arrives here as a script message.
/// The app → page: batches of messages handed to `window.EncoreNative._receive(batch)`.
///
/// While the app isn't in front, the page is asleep: only numbered news (EventLog) is kept for it, and it's
/// all sent when the page says hello (after loading) or asks for it (when it wakes up), followed by the
/// player's state.
final class Bridge: NSObject, WKScriptMessageHandler, PageLink {
    static let handlerName = "encore"
    static let logKey = "encore.newsForPage"

    weak var webView: WKWebView?
    let engine: PlayerEngine
    private(set) var log: EventLog
    /// the page has loaded and said hello
    private(set) var pageReady = false
    /// test panel: hold everything back, as if the phone were locked
    var frozen = false
    /// messages for the screen around the page: status bar, AirPlay, address, clipboard
    var onUIMessage: ((String, [String: Any]) -> Void)?
    private let defaults: UserDefaults
    private var saveWork: DispatchWorkItem?
    private var lastListeningSave: CFTimeInterval = 0
    /// News piled up while the page was asleep: it goes to the page all together, with the player's state
    /// (sendAll), never a piece at a time before that.
    private(set) var needsCatchUp = false

    init(engine: PlayerEngine, defaults: UserDefaults = .standard) {
        self.engine = engine
        self.defaults = defaults
        self.log = EventLog.load(from: defaults, key: Bridge.logKey)
        super.init()
        engine.link = self
    }

    /// The page is there and awake (the app is in front).
    var isLive: Bool {
        pageReady && !frozen && UIApplication.shared.applicationState != .background
    }

    /// Put on the page before anything else runs.
    static func pageScript(appVersion: String) -> String {
        let version = appVersion.replacingOccurrences(of: "\\", with: "").replacingOccurrences(of: "'", with: "")
        return """
        (function () {
          if (window.EncoreNative) return;
          var queue = [], handler = null;
          function deliver(batch) { try { handler(batch); } catch (e) { console.error(e); } }
          window.EncoreNative = Object.freeze({
            platform: 'ios',
            appVersion: '\(version)',
            post: function (m) { window.webkit.messageHandlers.\(handlerName).postMessage(m); },
            listen: function (fn) { handler = fn; var q = queue; queue = []; q.forEach(deliver); },
            _receive: function (batch) { if (handler) deliver(batch); else queue.push(batch); }
          });
        })();
        """
    }

    // MARK: - from the page

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        handle(type, body)
    }

    func handle(_ type: String, _ body: [String: Any]) {
        switch type {
        case "hello":
            pageReady = true
            sendAll(welcome: true)
        case "pull":
            sendAll(welcome: false)
        case "ack":
            if let s = Item.number(body["seq"]) {
                log.ack(Int(s))
                saveSoon()
            }
        case "load":
            let req = Int(Item.number(body["req"]) ?? 0)
            guard let item = Item(body["item"]) else {
                // something the app can't play (no usable address): say so, rather than play on regardless
                let key = (body["item"] as? [String: Any])?["key"] as? String ?? ""
                engine.rejectLoad(req: req, key: key)
                return
            }
            engine.load(item, req: req, startAt: Item.number(body["startAt"]) ?? 0,
                        autoplay: (body["autoplay"] as? NSNumber)?.boolValue ?? false,
                        restore: (body["restore"] as? NSNumber)?.boolValue ?? false)
        case "play":
            engine.play()
        case "pause":
            engine.pause()
        case "seek":
            engine.seek(Item.number(body["t"]) ?? 0)
        case "stop":
            engine.stop()
            save()
        case "upcoming":
            engine.upcoming(key: body["key"] as? String ?? "", req: Int(Item.number(body["req"]) ?? 0),
                            items: Item.list(body["items"]), back: Item.list(body["back"]),
                            repeatOne: (body["repeatOne"] as? NSNumber)?.boolValue ?? false)
        default:
            onUIMessage?(type, body)
        }
    }

    // MARK: - to the page (PageLink)

    func send(_ message: [String: Any]) {
        guard isLive else { return }
        deliver([message])
    }

    func record(_ message: [String: Any]) {
        log.add(message)
        if isLive && !needsCatchUp {
            saveSoon()
            deliver(log.messages)
        } else {
            // the page is asleep and iOS may close the app at any moment: keep it now
            if !isLive { needsCatchUp = true }
            save()
        }
    }

    func countListening(_ seconds: Double) {
        log.addListening(seconds, day: EventLog.dayKey(Date()))
        if log.pendingListening >= 30 && isLive && !needsCatchUp {
            log.flushListening()
            deliver(log.messages)
            saveSoon()
        } else if CACurrentMediaTime() - lastListeningSave >= 15 {
            // listening time is saved every 15 seconds at most (and when the app goes to the background)
            lastListeningSave = CACurrentMediaTime()
            saveSoon()
        }
    }

    /// Everything the page hasn't confirmed, then the player's state.
    func sendAll(welcome: Bool) {
        guard pageReady, !frozen else { return }
        log.flushListening()
        saveSoon()
        var batch: [[String: Any]] = welcome ? [["type": "welcome"]] : []
        batch += log.messages
        batch.append(engine.snapshot())
        if welcome { batch.append(["type": "route", "available": engine.routesAvailable]) }
        deliver(batch)
        needsCatchUp = false
    }

    private func deliver(_ batch: [[String: Any]]) {
        guard let wv = webView, !batch.isEmpty else { return }
        guard JSONSerialization.isValidJSONObject(batch) else {
            NSLog("%@", "Encore: a message for the page couldn't be sent")
            return
        }
        wv.callAsyncJavaScript("window.EncoreNative && window.EncoreNative._receive(batch)",
                               arguments: ["batch": batch], in: nil, in: .page) { _ in }
    }

    // MARK: - the page's life

    /// A new page is loading (or the old one died): wait for its hello before sending anything.
    func pageGone() {
        pageReady = false
    }

    /// The app came back to the front.
    func appActive() {
        sendAll(welcome: false)
    }

    /// The app went to the background: the page sleeps, and gets everything at once when it wakes.
    func appInBackground() {
        needsCatchUp = true
        save()
    }

    // MARK: - saving the news (it survives the app being closed)

    private func saveSoon() {
        guard saveWork == nil else { return }
        let w = DispatchWorkItem { [weak self] in
            self?.saveWork = nil
            self?.save()
        }
        saveWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: w)
    }

    func save() {
        saveWork?.cancel()
        saveWork = nil
        log.save(to: defaults, key: Bridge.logKey)
    }

    /// A different address: the news was for the old page, and the player stops.
    func forgetAll() {
        engine.stop()
        log = EventLog()
        save()
        pageReady = false
    }
}
