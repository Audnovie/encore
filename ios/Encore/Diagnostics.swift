import AVFoundation
import MediaPlayer
import UIKit

/// What the app and iOS did with the sound, kept on the phone across launches (the latest 1,500 lines), for
/// problems that only show on the phone, such as Control Center saying "Not Playing" while the music plays:
/// the app going to the background and back, the phone locking, the audio session starting and stopping,
/// calls and other apps taking the sound, headphones and speakers changing, the lock screen buttons, the
/// player's state and its songs.
///
/// Touch and hold Encore's icon on the Home Screen, then Copy Diagnostics: how things stand at that moment
/// and the latest lines go to the clipboard. Nothing here holds an address (Encore's or the music server's,
/// whose addresses carry the sign-in token), a password or a token: anything that looks like one is hidden.
final class Diagnostics {
    static let shared = Diagnostics(file: Diagnostics.standardFile())

    let file: URL?
    let maxLines: Int
    private let lock = NSLock()
    private var lines: [String] = []
    private var sinceRewrite = 0
    private var lastNoted: [String: CFTimeInterval] = [:]
    private let io = DispatchQueue(label: "io.github.audnovie.encore.diagnostics")

    init(file: URL?, maxLines: Int = 1500) {
        self.file = file
        self.maxLines = maxLines
        if let file = file, let data = try? Data(contentsOf: file), let text = String(data: data, encoding: .utf8) {
            lines = text.split(separator: "\n", omittingEmptySubsequences: true).suffix(maxLines).map(String.init)
        }
    }

    /// The app's own: Application Support/diagnostics.log
    static func standardFile() -> URL? {
        guard let dir = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                     appropriateFor: nil, create: true) else { return nil }
        return dir.appendingPathComponent("diagnostics.log")
    }

    // MARK: - noting things

    static func note(_ what: String, _ details: String = "") { shared.add(what, details) }

    /// As note, at most once in `seconds` for the same key (for something that could repeat every few seconds).
    static func noteRarely(_ key: String, every seconds: Double, _ what: String, _ details: String = "") {
        shared.addRarely(key, every: seconds, what, details)
    }

    func add(_ what: String, _ details: String = "", at date: Date = Date()) {
        let body: String = details.isEmpty ? "" : ": " + Diagnostics.scrub(details)
        let line: String = Diagnostics.stamp.string(from: date) + " " + what + body
        lock.lock()
        defer { lock.unlock() }
        lines.append(line)
        if lines.count > maxLines { lines.removeFirst(lines.count - maxLines) }
        sinceRewrite += 1
        // The file gets each line added to its end, and every 300 lines it's written again with only the
        // latest ones, so it stays small.
        let whole: [String]? = sinceRewrite >= 300 ? lines : nil
        if whole != nil { sinceRewrite = 0 }
        if let file = file {
            // (queued while holding the lock, so the file gets the lines in the same order)
            io.async { Diagnostics.write(file, line: line, whole: whole) }
        }
    }

    func addRarely(_ key: String, every seconds: Double, _ what: String, _ details: String = "") {
        let now = CACurrentMediaTime()
        lock.lock()
        let due = lastNoted[key].map { now - $0 >= seconds } ?? true
        if due { lastNoted[key] = now }
        lock.unlock()
        if due { add(what, details) }
    }

    /// The lines, oldest first.
    var all: [String] {
        lock.lock()
        defer { lock.unlock() }
        return lines
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return lines.count
    }

    /// Waits until the file has everything (before iOS may close the app).
    func flush() { io.sync {} }

    /// Forgets everything (the UI tests start each fresh launch with an empty record).
    func clear() {
        lock.lock()
        defer { lock.unlock() }
        lines = []
        sinceRewrite = 0
        lastNoted = [:]
        if let file = file { io.async { try? FileManager.default.removeItem(at: file) } }
    }

    private static func write(_ file: URL, line: String, whole: [String]?) {
        if let whole = whole {
            try? Data((whole.joined(separator: "\n") + "\n").utf8).write(to: file, options: .atomic)
            return
        }
        let data = Data((line + "\n").utf8)
        if let h = try? FileHandle(forWritingTo: file) {
            defer { try? h.close() }
            do {
                try h.seekToEnd()
                try h.write(contentsOf: data)
            } catch {}
        } else {
            try? data.write(to: file, options: .atomic)
        }
    }

    // MARK: - what goes to the clipboard

    /// When it was copied, how things stand (`state`), then the latest `lastLines` lines.
    func report(state: [String], lastLines: Int = 800, now: Date = Date()) -> String {
        let l = all
        let shown = l.suffix(lastLines)
        var out = ["Encore diagnostics, copied \(Diagnostics.longStamp.string(from: now)) (\(TimeZone.current.identifier))"]
        out += state.map { Diagnostics.scrub($0) }
        out.append("--- what happened, oldest first (\(shown.count) of \(l.count) lines kept; month-day and the phone's time) ---")
        out += shown
        return out.joined(separator: "\n")
    }

    // MARK: - wording

    private static let stamp: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "MM-dd HH:mm:ss.SSS"
        return f
    }()

    private static let longStamp: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss ZZZZ"
        return f
    }()

    /// Hides web addresses (the music server's carry the sign-in token) and IP addresses.
    static func scrub(_ s: String) -> String {
        var t = s.replacingOccurrences(of: #"[A-Za-z][A-Za-z0-9+.\-]*://[^\s"'<>)\]]*"#, with: "<address>",
                                       options: .regularExpression)
        t = t.replacingOccurrences(of: #"\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b"#, with: "<address>", options: .regularExpression)
        return t
    }

    static func yn(_ b: Bool) -> String { b ? "yes" : "no" }

    /// 83.4 -> "1:23"
    static func clock(_ t: Double) -> String {
        guard t.isFinite, t >= 0 else { return "-" }
        let s = Int(t)
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    /// An error's domain and number (and the ones under it), with its description.
    static func describe(_ error: Error?) -> String {
        guard let e = error.map({ $0 as NSError }) else { return "no error given" }
        var parts = ["\(e.domain) \(e.code)"]
        var under = e.userInfo[NSUnderlyingErrorKey] as? NSError
        var depth = 0
        while let u = under, depth < 3 {
            parts.append("\(u.domain) \(u.code)")
            under = u.userInfo[NSUnderlyingErrorKey] as? NSError
            depth += 1
        }
        return parts.joined(separator: " < ") + " (" + e.localizedDescription + ")"
    }

    static func name(_ s: AVPlayer.TimeControlStatus) -> String {
        switch s {
        case .paused: return "paused"
        case .playing: return "playing"
        case .waitingToPlayAtSpecifiedRate: return "waiting"
        @unknown default: return "status \(s.rawValue)"
        }
    }

    /// "AVPlayerWaitingToMinimizeStallsReason" -> "ToMinimizeStalls"
    static func name(_ r: AVPlayer.WaitingReason) -> String {
        r.rawValue.replacingOccurrences(of: "AVPlayerWaiting", with: "").replacingOccurrences(of: "Reason", with: "")
    }

    static func name(_ r: AVAudioSession.RouteChangeReason) -> String {
        switch r {
        case .unknown: return "unknown"
        case .newDeviceAvailable: return "new device"
        case .oldDeviceUnavailable: return "device gone"
        case .categoryChange: return "category change"
        case .override: return "override"
        case .wakeFromSleep: return "wake from sleep"
        case .noSuitableRouteForCategory: return "no suitable route"
        case .routeConfigurationChange: return "configuration change"
        @unknown default: return "reason \(r.rawValue)"
        }
    }

    /// The numbers iOS gives with an interruption (only the first three have settled names).
    static func interruptionReason(_ raw: UInt?) -> String {
        guard let raw = raw else { return "no reason given" }
        switch raw {
        case 0: return "reason 0 (default)"
        case 1: return "reason 1 (app was suspended)"
        case 2: return "reason 2 (built-in mic muted)"
        default: return "reason \(raw)"
        }
    }

    /// Where the sound goes: "Speaker", "Bluetooth", "AirPlay"… (kinds only, not the devices' names).
    static func outputs(_ route: AVAudioSessionRouteDescription?) -> String {
        guard let r = route, !r.outputs.isEmpty else { return "none" }
        return r.outputs.map { port($0.portType) }.joined(separator: "+")
    }

    static func port(_ p: AVAudioSession.Port) -> String {
        switch p {
        case .builtInSpeaker: return "Speaker"
        case .builtInReceiver: return "Receiver"
        case .headphones: return "Headphones"
        case .bluetoothA2DP: return "Bluetooth"
        case .bluetoothLE: return "Bluetooth LE"
        case .bluetoothHFP: return "Bluetooth (call)"
        case .airPlay: return "AirPlay"
        case .carAudio: return "CarPlay"
        case .HDMI: return "HDMI"
        case .usbAudio: return "USB"
        case .lineOut: return "Line out"
        default: return p.rawValue
        }
    }

    /// The audio session in one line: what kind it is, whether other apps are playing, where the sound goes.
    static func sessionLine() -> String {
        let s = AVAudioSession.sharedInstance()
        let category = s.category.rawValue.replacingOccurrences(of: "AVAudioSessionCategory", with: "")
        let mode = s.mode.rawValue.replacingOccurrences(of: "AVAudioSessionMode", with: "")
        let policy: String
        switch s.routeSharingPolicy.rawValue {
        case 0: policy = "default"
        case 1: policy = "long-form audio"
        case 2: policy = "independent"
        default: policy = "\(s.routeSharingPolicy.rawValue)"
        }
        return "\(category), mode \(mode), options \(s.categoryOptions.rawValue), policy \(policy), "
            + "other audio playing \(yn(s.isOtherAudioPlaying)), another app's music playing \(yn(s.secondaryAudioShouldBeSilencedHint)), "
            + "output \(outputs(s.currentRoute))"
    }

    /// "iPhone15,2" (on the simulator, the simulated model)
    static var deviceModel: String {
        if let sim = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return sim + " (simulator)" }
        var u = utsname()
        uname(&u)
        var id = ""
        for child in Mirror(reflecting: u.machine).children {
            guard let c = child.value as? CChar, c != 0 else { break }
            id.append(Character(UnicodeScalar(UInt8(bitPattern: c))))
        }
        return id.isEmpty ? "?" : id
    }

    /// The app's version, and the commit it was built from (CI puts it in the app).
    static var appLine: String {
        let info = Bundle.main.infoDictionary ?? [:]
        let v = info["CFBundleShortVersionString"] as? String ?? "?"
        let b = info["CFBundleVersion"] as? String ?? "?"
        let commit = info["EncoreBuild"] as? String ?? ""
        return "Encore \(v) (\(b)), built from \(commit.isEmpty ? "?" : commit), iOS \(UIDevice.current.systemVersion), \(deviceModel)"
    }
}
