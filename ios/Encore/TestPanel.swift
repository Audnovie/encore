import UIKit
import WebKit

/// A panel for the UI tests (only in debug builds, and only when launched with -EncoreTestMode YES):
/// shows the player's state as text and has buttons for the lock screen controls, for holding messages
/// back from the page (as if the phone were locked), and for running a line of JavaScript in the page.
final class TestPanel: UIView {
    private weak var controller: RootViewController?
    private let state = UILabel()
    private let result = UILabel()
    /// the last diagnostics copied (one line on screen; the tests read all of it)
    private let copied = UILabel()
    private let js = UITextField()
    private var timer: Timer?
    private var runs = 0

    /// Shortcuts the tests call from the JavaScript field.
    static let pageHelpers = """
    window.__t = {
      songs: async function () {
        const s = await __encore.Lib.allSongs();
        return s.slice().sort(function (a, b) { return a.title.localeCompare(b.title); });
      },
      signIn: function (u, p) {
        document.querySelector('#lg-user').value = u;
        document.querySelector('#lg-pass').value = p;
        document.querySelector('.lg-btn').click();
        return 'ok';
      },
      play: async function (from, n) {
        const s = await this.songs();
        __encore.Player.playList(s.slice(from, from + n), 0, 'Test');
        return s.slice(from, from + n).map(function (x) { return x.id; }).join(',');
      },
      playIds: async function (ids) {
        const s = await this.songs();
        const list = ids.map(function (id) { return s.find(function (x) { return x.id === id; }) || { id: id, title: 'Missing ' + id, artist: '', album: '', duration: 10 }; });
        __encore.Player.playList(list, 0, 'Test');
        return 'ok';
      },
      ids: async function () { return (await this.songs()).map(function (x) { return x.title + '=' + x.id; }).join('|'); },
      state: function () {
        const P = __encore.Player, a = __encore.nativeAudio;
        return JSON.stringify({ signedIn: !!(__encore.api && !__encore.api.demo), cur: P.cur ? P.cur.id : '', title: P.cur ? P.cur.title : '',
          playing: P.playing, t: Math.round(P.time() * 10) / 10, hist: P.history.map(function (h) { return h.song.id; }),
          req: a ? a.req : -1, seq: a ? a.seq : -1, native: !!__encore.native, repeat: P.repeat,
          mini: (document.querySelector('#mini .mq span') || {}).textContent || '' });
      }
    };
    """

    init(controller: RootViewController) {
        self.controller = controller
        super.init(frame: .zero)
        backgroundColor = UIColor.black.withAlphaComponent(0.72)
        accessibilityIdentifier = "testPanel"

        for l in [state, result] {
            l.font = .monospacedSystemFont(ofSize: 9, weight: .regular)
            l.textColor = .white
            l.numberOfLines = 0
            l.isAccessibilityElement = true
        }
        state.accessibilityIdentifier = "testState"
        result.accessibilityIdentifier = "testResult"
        copied.font = .monospacedSystemFont(ofSize: 8, weight: .regular)
        copied.textColor = .white
        copied.numberOfLines = 1
        copied.isAccessibilityElement = true
        copied.accessibilityIdentifier = "testCopied"
        copied.text = "-"
        js.accessibilityIdentifier = "testJS"
        js.backgroundColor = .white
        js.textColor = .black
        js.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        js.autocapitalizationType = .none
        js.autocorrectionType = .no
        js.spellCheckingType = .no
        js.smartQuotesType = .no
        js.smartDashesType = .no
        js.smartInsertDeleteType = .no
        js.heightAnchor.constraint(equalToConstant: 28).isActive = true

        let buttons: [(String, Selector)] = [
            ("Next", #selector(tapNext)), ("Prev", #selector(tapPrev)), ("Pause", #selector(tapPause)), ("Play", #selector(tapPlay)),
            ("Freeze", #selector(tapFreeze)), ("Thaw", #selector(tapThaw)), ("Diag", #selector(tapDiag)), ("Run", #selector(tapRun)),
        ]
        let row = UIStackView(arrangedSubviews: buttons.map { title, sel in
            let b = UIButton(type: .system)
            b.setTitle(title, for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 12, weight: .semibold)
            b.setTitleColor(.white, for: .normal)
            b.backgroundColor = UIColor.white.withAlphaComponent(0.18)
            b.accessibilityIdentifier = "test" + title
            b.addTarget(self, action: sel, for: .touchUpInside)
            return b
        })
        row.distribution = .fillEqually
        row.spacing = 4
        row.heightAnchor.constraint(equalToConstant: 30).isActive = true

        let stack = UIStackView(arrangedSubviews: [state, row, js, result, copied])
        stack.axis = .vertical
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 6),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6),
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 4),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -4),
        ])
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.refresh() }
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    private func refresh() {
        guard let c = controller else { return }
        var s = c.engine.debugState
        s["pageReady"] = c.bridge.pageReady
        s["frozen"] = c.bridge.frozen
        s["unconfirmed"] = c.bridge.log.events.count
        s["lastSeq"] = c.bridge.log.nextSeq - 1
        s["appState"] = UIApplication.shared.applicationState == .active ? "active" : UIApplication.shared.applicationState == .background ? "background" : "inactive"
        s["copies"] = c.copies
        s["diagLines"] = Diagnostics.shared.count
        if let d = try? JSONSerialization.data(withJSONObject: s, options: [.sortedKeys]), let text = String(data: d, encoding: .utf8) {
            state.text = text
        }
    }

    @objc private func tapNext() { controller?.engine.remoteNext() }
    @objc private func tapPrev() { controller?.engine.remotePrevious() }
    @objc private func tapPause() { controller?.engine.pause(from: "the test panel") }
    @objc private func tapPlay() { controller?.engine.play(from: "the test panel") }
    @objc private func tapFreeze() { controller?.bridge.frozen = true }
    /// as Copy Diagnostics in the Home Screen icon's menu
    @objc private func tapDiag() { controller?.copyDiagnostics() }

    func showCopied(_ text: String) {
        copied.text = text
        copied.accessibilityLabel = text
    }

    @objc private func tapThaw() {
        controller?.bridge.frozen = false
        controller?.bridge.appActive()
    }

    @objc private func tapRun() {
        guard let wv = controller?.webView else { return }
        runs += 1
        let n = runs
        let code = js.text ?? ""
        js.text = ""
        js.resignFirstResponder()
        result.text = "\(n): …"
        wv.callAsyncJavaScript("return await (async () => { return (" + code + "); })();", arguments: [:], in: nil, in: .page) { [weak self] r in
            let text: String
            switch r {
            case .success(let v): text = "\(v)"
            case .failure(let e): text = "error: \(e.localizedDescription)"
            }
            self?.result.text = "\(n): " + text
        }
    }
}
