import AVFoundation
import MediaPlayer
import UIKit

/// How the player talks to the page (Bridge in the app, a stand-in in tests).
protocol PageLink: AnyObject {
    /// For the page only if it's awake: the player's clock and play state. Dropped otherwise.
    func send(_ message: [String: Any])
    /// News the page mustn't miss: kept until the page confirms it.
    func record(_ message: [String: Any])
    /// Seconds of music actually heard.
    func countListening(_ seconds: Double)
}

/// One song in the player: what the page asked for, and the AVPlayerItem playing it.
final class Entry {
    let item: Item
    let playerItem: AVPlayerItem
    /// playing the MP3 version because the phone couldn't play the original
    let usingFallback: Bool
    var didEnd = false
    /// its failure has been dealt with (several signals can report the same one)
    var failureHandled = false
    /// put last in the queue because the player had already let go of the song before it (see failed)
    var insertedLast = false
    /// already the second try after a broken connection (see failed)
    var retried = false
    /// seconds heard since then: after half a minute the song gets its one more try back (see tick)
    var heardSinceRetry: Double = 0
    var statusWatch: NSKeyValueObservation?

    init(item: Item, fallback: Bool = false) {
        let useFallback = fallback && item.fallback != nil
        self.item = item
        self.usingFallback = useFallback
        self.playerItem = AVPlayerItem(url: useFallback ? (item.fallback ?? item.url) : item.url)
    }
}

/// Plays the music. The page says what to play and what comes next; the player carries on by itself while
/// the page sleeps (the phone is locked): it moves on to the next song, answers the lock screen, registers
/// plays with the server and counts listening time, and tells the page all of it when it wakes up.
final class PlayerEngine: NSObject {
    weak var link: PageLink?

    private(set) var player = AVQueuePlayer()
    private(set) var queue = QueueState()
    private(set) var current: Entry?
    /// the next song, already in AVQueuePlayer so it starts without a gap
    private(set) var preload: Entry?
    /// whether the person wants music playing (false after Pause, wherever it was pressed)
    private(set) var wantsPlay = false
    /// the song came from the page's latest request (rather than the app moving on, or its saved place)
    private(set) var currentFromPage = false
    private(set) var errorsInARow = 0
    private var pendingSeek: Double?
    private var nowSent = false
    private var scrobbled = false
    private var lastTick: (entry: ObjectIdentifier, t: Double, wall: CFTimeInterval)?
    private var lastTimeSent: CFTimeInterval = 0
    private var resumeAfterInterruption = false
    private var watches: [NSKeyValueObservation] = []
    private var timeObserver: Any?
    let artwork = ArtworkCache()
    /// plays registered with the server (for the test panel)
    private(set) var scrobbleLog: [(key: String, submission: Bool, ok: Bool)] = []
    /// where the player keeps its place between launches (nil: it doesn't, as in most tests)
    var store: PlayerStore?
    private var lastSaved: CFTimeInterval = 0
    /// the page's last request when the app couldn't play it (see rejectLoad)
    private var rejectedKey = ""
    /// the reason given with the last error reported to the page (for the test panel)
    private(set) var lastErrorReason = ""
    /// songs whose original file the phone couldn't play: their MP3 version is used from then on
    private var mp3Keys = Set<String>()
    /// gets Navidrome's MP3 versions made before AVPlayer asks for them
    let warmer = TranscodeWarmer()
    /// the player was playing at the last play-state change (see playStateChanged)
    private var wasPlaying = false
    private var lastNowPlayingCheck: CFTimeInterval = 0
    /// times Now Playing had to be set again (for the test panel)
    private(set) var nowPlayingRepairs = 0
    /// for the test panel: songs counted as ended because they stuck just before the end, second tries after a
    /// broken connection, and switches of the playing song to its MP3 version
    private(set) var stallEnds = 0
    private(set) var retriesDone = 0
    private(set) var mp3Switches = 0


    override init() {
        super.init()
        attach(player)
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(itemEnded(_:)), name: .AVPlayerItemDidPlayToEndTime, object: nil)
        nc.addObserver(self, selector: #selector(itemBroke(_:)), name: .AVPlayerItemFailedToPlayToEndTime, object: nil)
        nc.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
        nc.addObserver(self, selector: #selector(mediaServicesReset(_:)), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        setUpRemoteCommands()
    }

    deinit {
        detach()
    }

    private func attach(_ p: AVQueuePlayer) {
        p.actionAtItemEnd = .advance
        p.automaticallyWaitsToMinimizeStalling = true
        watches = [
            p.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.playStateChanged() }
            },
            p.observe(\.currentItem, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.followPlayer() }
            },
        ]
        timeObserver = p.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 4), queue: .main) { [weak self] _ in
            self?.tick()
        }
    }

    private func detach() {
        watches.forEach { $0.invalidate() }
        watches = []
        if let t = timeObserver {
            player.removeTimeObserver(t)
            timeObserver = nil
        }
    }

    // MARK: - audio session

    /// Music category: plays with the Ring/Silent switch on silent and while the phone is locked.
    static func configureAudioSession() {
        let s = AVAudioSession.sharedInstance()
        do {
            try s.setCategory(.playback, mode: .default, policy: .longFormAudio, options: [])
        } catch {
            try? s.setCategory(.playback)
        }
    }

    /// Times the audio session was found changed (another part of the app, such as the web view, setting its
    /// own category) and set back (for the test panel).
    static var sessionRestores = 0

    /// iOS only makes an app the one in Control Center and on the lock screen ("Now Playing") while its audio
    /// is the music kind that doesn't mix with others. If anything else in the app changed that (to a mixing
    /// category such as Ambient), the music would keep playing but iOS would show "Not Playing" and send the
    /// Play button to another app. Set it back.
    static func keepSessionOurs() {
        let s = AVAudioSession.sharedInstance()
        if s.category == .playback && !s.categoryOptions.contains(.mixWithOthers) { return }
        NSLog("%@", "Encore: the audio session was changed to \(s.category.rawValue) (options \(s.categoryOptions.rawValue)); setting it back")
        sessionRestores += 1
        configureAudioSession()
    }

    private func activateSession() {
        PlayerEngine.keepSessionOurs()
        do { try AVAudioSession.sharedInstance().setActive(true) } catch { NSLog("%@", "Encore: couldn't start audio: \(error)") }
    }

    /// The app came to the front or went to the background: make sure iOS still has the app's music as
    /// Now Playing (see keepSessionOurs), with everything about the song.
    func appStateChanged() {
        guard current != nil else { return }
        if wantsPlay { activateSession() }
        nowPlaying(reset: true)
    }

    // MARK: - what the page asks for

    func load(_ item: Item, req: Int, startAt: Double, autoplay: Bool, restore: Bool) {
        guard queue.load(item, req: req, restore: restore) else {
            // the app keeps its own song; the page catches up from the snapshot it gets next
            return
        }
        rejectedKey = ""
        put(item, at: startAt, play: autoplay)
        currentFromPage = true
        songChanged()
        markStartedLate(startAt)
        fillPreload()
        nowPlaying(reset: true)
        sendState()
    }

    /// The page asked for something the app can't play (no usable address): stop, note the request and say so.
    func rejectLoad(req: Int, key: String) {
        stop()
        queue.note(req: req)
        rejectedKey = key
        reportError(key, "This can’t be played in the app.", reason: "unsupported")
        send(["type": "state", "key": key, "req": req, "playing": false, "waiting": false])
    }

    func upcoming(key: String, req: Int, items: [Item], back: [Item], repeatOne: Bool) {
        guard queue.upcoming(key: key, req: req, items: items, back: back, repeatOne: repeatOne) else { return }
        updateActionAtEnd()
        fillPreload()
        saveState()
    }

    func play() {
        guard let cur = current else {
            // nothing it can play (the page asked for something it couldn't): the page shows it paused
            if !rejectedKey.isEmpty {
                send(["type": "state", "key": rejectedKey, "req": queue.lastReq, "playing": false, "waiting": false])
            }
            return
        }
        wantsPlay = true
        activateSession()
        if cur.playerItem.status == .failed || cur.failureHandled || cur.didEnd || player.currentItem !== cur.playerItem {
            // a song that wouldn't load, the last one after it ended, or the player moved off it after a failure:
            // start it again from a fresh copy
            put(cur.item, fallback: cur.usingFallback, at: cur.didEnd ? 0 : currentTime(), play: true)
            fillPreload()
        } else {
            player.play()
        }
        sendState()
        nowPlaying()
    }

    func pause() {
        wantsPlay = false
        player.pause()
        sendState()
        nowPlaying()
        saveTime()
    }

    func seek(_ seconds: Double) {
        guard let cur = current, !cur.item.isRadio, seconds.isFinite else { return }
        var t = max(0, seconds)
        if let d = duration() { t = min(t, max(0, d - 0.25)) }
        lastTick = nil
        if cur.playerItem.status == .readyToPlay {
            pendingSeek = nil
            cur.playerItem.seek(to: CMTime(seconds: t, preferredTimescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
                DispatchQueue.main.async {
                    self?.sendTime()
                    self?.nowPlaying()
                }
            }
        } else {
            pendingSeek = t
        }
        nowPlaying()
    }

    func stop() {
        rejectedKey = ""
        mp3Keys.removeAll()
        wantsPlay = false
        player.pause()
        clearPreload()
        player.removeAllItems()
        current = nil
        currentFromPage = false
        queue.stop()
        pendingSeek = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        saveState()
    }

    /// Everything about the player, for the page when it wakes up. `own`: the song is the app's own doing
    /// (it moved on, or it's where it was when the app was closed), so the page should go to it.
    func snapshot() -> [String: Any] {
        let song: Any
        if let c = current { song = c.item.songInfo } else { song = NSNull() }
        return [
            "type": "snapshot",
            // after something it couldn't play, that's still the page's song (so the page doesn't ask again)
            "key": current?.item.key ?? rejectedKey,
            "req": queue.lastReq,
            "playing": isPlaying,
            "waiting": isWaiting,
            "t": finite(currentTime()),
            "d": finite(duration() ?? 0),
            "ready": current?.playerItem.status == .readyToPlay,
            "own": current != nil && !currentFromPage,
            "song": song,
        ]
    }

    // MARK: - keeping its place between launches

    struct Saved: Codable {
        var current: Item
        var ahead: [Item]
        var back: [Item]
        var repeatOne: Bool
        var fallback: Bool
    }

    /// Notes where the player is (the songs, and the time), so it can carry on after iOS closes the app.
    func saveState() {
        guard let store = store else { return }
        guard let cur = current else {
            store.clear()
            return
        }
        store.saveList(Saved(current: cur.item, ahead: Array(queue.ahead.prefix(300)), back: Array(queue.back.suffix(20)),
                             repeatOne: queue.repeatOne, fallback: cur.usingFallback))
        saveTime()
    }

    /// Just the time in the song (written often, so kept apart from the list), with which song it's for.
    func saveTime() {
        guard let store = store, let cur = current else { return }
        lastSaved = CACurrentMediaTime()
        store.saveTime(cur.didEnd ? 0 : finite(currentTime()), key: cur.item.key)
    }

    /// After iOS closed the app: be ready (paused, where it was) before the page has loaded, so Play on the
    /// lock screen works straight away. The page catches up when it loads.
    func resumeSaved() {
        guard current == nil, let store = store, let s = store.loadList() else { return }
        let t = store.loadTime(key: s.current.key)
        queue.resume(current: s.current, ahead: s.ahead, back: s.back, repeatOne: s.repeatOne)
        put(s.current, fallback: s.fallback, at: t, play: false)
        currentFromPage = false
        songChanged()
        markStartedLate(t)
        fillPreload()
        nowPlaying(reset: true)
    }

    // MARK: - lock screen

    private func setUpRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in
            guard let self = self, self.current != nil else { return .noSuchContent }
            self.play()
            return .success
        }
        c.pauseCommand.addTarget { [weak self] _ in
            self?.pause()
            return .success
        }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self = self, self.current != nil else { return .noSuchContent }
            // by what's really happening: after another app took the sound, the first press plays
            if self.player.timeControlStatus == .paused { self.play() } else { self.pause() }
            return .success
        }
        c.stopCommand.addTarget { [weak self] _ in
            self?.pause()
            return .success
        }
        c.nextTrackCommand.addTarget { [weak self] _ in
            guard let self = self, self.current != nil else { return .noSuchContent }
            self.remoteNext()
            return .success
        }
        c.previousTrackCommand.addTarget { [weak self] _ in
            guard let self = self, self.current != nil else { return .noSuchContent }
            self.remotePrevious()
            return .success
        }
        c.changePlaybackPositionCommand.addTarget { [weak self] e in
            guard let self = self, let e = e as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self.seek(e.positionTime)
            return .success
        }
        for cmd in [c.skipForwardCommand, c.skipBackwardCommand, c.seekForwardCommand, c.seekBackwardCommand,
                    c.likeCommand, c.dislikeCommand, c.bookmarkCommand, c.ratingCommand,
                    c.changeRepeatModeCommand, c.changeShuffleModeCommand,
                    c.enableLanguageOptionCommand, c.disableLanguageOptionCommand] as [MPRemoteCommand] {
            cmd.isEnabled = false
        }
    }

    /// Next on the lock screen (and in the test panel).
    func remoteNext() {
        if !advance(.next) {
            // nothing after this song: like the page's Next on the last song
            pause()
            seek(0)
        }
    }

    /// Back on the lock screen: the start of the song, or the song before when it's just started.
    func remotePrevious() {
        guard let cur = current, !cur.item.isRadio else { return }
        if currentTime() > 3 || queue.back.isEmpty {
            seek(0)
        } else {
            advance(.prev)
        }
    }

    // MARK: - moving through the songs

    /// Puts a song in the player, with nothing after it yet.
    private func put(_ item: Item, fallback: Bool = false, at t: Double = 0, play: Bool) {
        let e = Entry(item: item, fallback: fallback || (item.fallback != nil && mp3Keys.contains(item.key)))
        watch(e)
        clearPreload()
        player.removeAllItems()
        current = e
        player.insert(e.playerItem, after: nil)
        pendingSeek = t > 0.25 ? t : nil
        updateActionAtEnd()
        wantsPlay = play
        if play {
            activateSession()
            player.play()
        } else {
            player.pause()
        }
    }

    /// A new song (or the same one again) started: its play hasn't been registered yet.
    private func songChanged() {
        nowSent = false
        scrobbled = false
        lastTick = nil
        lastTimeSent = 0
        let c = MPRemoteCommandCenter.shared()
        c.changePlaybackPositionCommand.isEnabled = !(current?.item.isRadio ?? false)
        saveState()
    }

    /// Starting past the point where a play counts (a restored place): it was counted before.
    private func markStartedLate(_ t: Double) {
        if let d = duration(), d > 0, t >= min(d * 0.5, 240) { scrobbled = true }
    }

    /// Moves on (or back) by itself. Returns false when there's nothing there.
    @discardableResult
    private func advance(_ m: QueueState.Move) -> Bool {
        guard let cur = current else { return false }
        let from = cur.item
        guard let next = queue.move(m) else { return false }
        let play = (m == .next || m == .prev) ? true : wantsPlay
        // The lined-up song is only used when moving on from a song that played. After a failure (skipping
        // included), AVQueuePlayer can sit "waiting" forever on the song it had lined up, so the next song
        // starts afresh instead (put).
        let healthy = !cur.failureHandled && cur.playerItem.status != .failed
        if m != .prev, healthy, let pre = preload, pre.item == next, player.items().contains(pre.playerItem) {
            // the song is already lined up in the player (AVQueuePlayer may already have moved on to it)
            preload = nil
            current = pre
            if player.currentItem !== pre.playerItem { player.advanceToNextItem() }
            wantsPlay = play
            if play {
                activateSession()
                player.play()
            }
        } else {
            put(next, play: play)
        }
        currentFromPage = false
        songChanged()
        fillPreload()
        record(["type": "advance", "from": from.key, "to": next.key, "reason": m.rawValue, "song": next.songInfo])
        nowPlaying(reset: true)
        sendState()
        return true
    }

    /// AVQueuePlayer moved on to the lined-up song by itself: the current one ended.
    private func followPlayer() {
        guard let cur = current, let pre = preload,
              player.currentItem === pre.playerItem, player.currentItem !== cur.playerItem else { return }
        if !cur.didEnd && (cur.failureHandled || cur.playerItem.status == .failed) {
            // it moved on because the song failed, not because it ended: failed() decides. A failure already
            // dealt with stays where it is, and Play starts the song again from a fresh copy.
            failed(cur, cur.playerItem.error)
            return
        }
        // Only once the song has really ended: ended() marks it and calls this again. The player can also move
        // on when a song breaks off part way (a lost connection is reported while the song still counts as
        // ready), and that news (itemBroke) may come after this.
        guard cur.didEnd else { return }
        let from = cur.item
        guard let next = queue.move(.ended) else { return }
        preload = nil
        if next == pre.item {
            current = pre
            // normally it's playing already; when the lined-up song was swapped for its MP3 version just as the
            // last one ended (put last in an empty queue), it may need starting
            if pre.insertedLast && wantsPlay && player.rate == 0 {
                activateSession()
                player.play()
            }
        } else {
            // the lined-up song wasn't the next one after all (shouldn't happen): play the right one
            put(next, play: wantsPlay)
        }
        currentFromPage = false
        songChanged()
        fillPreload()
        record(["type": "advance", "from": from.key, "to": next.key, "reason": QueueState.Move.ended.rawValue, "song": next.songInfo])
        nowPlaying(reset: true)
        sendState()
    }

    /// The end of the list: stay on the last song, at its start, paused, so Play plays it again.
    private func endOfList(_ cur: Entry) {
        let from = cur.item
        put(from, play: false)
        currentFromPage = false
        songChanged()
        record(["type": "advance", "from": from.key, "to": NSNull(), "reason": QueueState.Move.ended.rawValue])
        nowPlaying(reset: true)
        sendState()
    }

    /// Keeps the next song lined up in the player (not for radio, which doesn't end).
    private func fillPreload() {
        guard let cur = current else { clearPreload(); return }
        let want: Item? = (cur.item.isRadio || cur.didEnd) ? nil : queue.ahead.first
        if let p = preload, let w = want, p.item == w, player.items().contains(p.playerItem) { return }
        clearPreload()
        guard let w = want else { return }
        linePreload(w, fallback: w.fallback != nil && mp3Keys.contains(w.key), retried: false, after: cur, orLast: false)
        if let art = w.art { artwork.fetch(art) { _ in } }
    }

    /// Lines up the next song after `cur` (or last in the queue, `orLast`, when the player has already let go
    /// of `cur`). One of Navidrome's MP3 versions is lined up once the server has finished making it.
    private func linePreload(_ item: Item, fallback: Bool, retried: Bool, after cur: Entry, orLast: Bool) {
        let url = fallback ? (item.fallback ?? item.url) : item.url
        if TranscodeWarmer.isTranscode(url) && !warmer.isSettled(url) {
            let stillWanted: () -> Bool = { [weak self] in
                guard let self = self else { return false }
                return self.current === cur && self.preload == nil && !cur.didEnd && self.queue.ahead.first == item
            }
            warmer.warm(url, within: 60, wanted: stillWanted) { [weak self] in
                guard let self = self, stillWanted() else { return }
                self.linePreload(item, fallback: fallback, retried: retried, after: cur, orLast: orLast)
            }
            return
        }
        let inQueue = player.items().contains(cur.playerItem)
        guard inQueue || orLast else { return }
        let e = Entry(item: item, fallback: fallback)
        e.retried = retried
        watch(e)
        let after: AVPlayerItem? = inQueue ? cur.playerItem : nil
        if player.canInsert(e.playerItem, after: after) {
            player.insert(e.playerItem, after: after)
            e.insertedLast = after == nil
            preload = e
        }
    }

    private func clearPreload() {
        if let p = preload {
            p.statusWatch = nil
            if player.items().contains(p.playerItem) { player.remove(p.playerItem) }
            preload = nil
        }
    }

    private func updateActionAtEnd() {
        // repeat one: stay at the end, and start the song again (see ended)
        player.actionAtItemEnd = (queue.repeatOne && !(current?.item.isRadio ?? true)) ? .none : .advance
    }

    @objc private func itemEnded(_ n: Notification) {
        guard let item = n.object as? AVPlayerItem else { return }
        DispatchQueue.main.async { [weak self] in self?.ended(item) }
    }

    private func ended(_ item: AVPlayerItem) {
        guard let cur = current, cur.playerItem === item, !cur.didEnd else { return }
        // repeat one: again from the start, and each time round counts as a play. Only while the player is still
        // on the song: if Repeat One was switched on just as it ended, after AVQueuePlayer had already moved on
        // to the next one, that's a normal end.
        if queue.repeatOne && !cur.item.isRadio && player.currentItem === cur.playerItem {
            songChanged()
            cur.playerItem.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
                DispatchQueue.main.async {
                    guard let self = self, self.current === cur, self.wantsPlay else { return }
                    self.player.play()
                    self.sendTime()
                }
            }
            return
        }
        cur.didEnd = true
        if let pre = preload, player.items().contains(pre.playerItem) {
            // AVQueuePlayer moves on to it by itself (followPlayer)
            followPlayer()
            // ...and if it somehow doesn't, move on here
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                guard let self = self, self.current === cur else { return }
                if !self.advance(.ended) { self.endOfList(cur) }
            }
            return
        }
        if !advance(.ended) { endOfList(cur) }
    }

    // MARK: - songs that won't play

    private func watch(_ e: Entry) {
        e.statusWatch = e.playerItem.observe(\.status, options: [.new]) { [weak self, weak e] item, _ in
            DispatchQueue.main.async {
                guard let self = self, let e = e else { return }
                switch item.status {
                case .readyToPlay: self.ready(e)
                case .failed: self.failed(e, item.error)
                default: break
                }
            }
        }
    }

    private func ready(_ e: Entry) {
        guard e === current else { return }
        if let t = pendingSeek {
            pendingSeek = nil
            e.playerItem.seek(to: CMTime(seconds: t, preferredTimescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
                DispatchQueue.main.async { self?.sendTime() }
            }
        }
        send(["type": "loaded", "key": e.item.key, "req": queue.lastReq, "d": finite(duration() ?? 0)])
        nowPlaying()
    }

    @objc private func itemBroke(_ n: Notification) {
        guard let item = n.object as? AVPlayerItem else { return }
        let err = n.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let cur = self.current, cur.playerItem === item else { return }
            self.failed(cur, err)
        }
    }

    /// Connection problems (no Wi-Fi, Tailscale off, server down), as opposed to a song the server or the phone
    /// can't play (those are skipped).
    static let connectionErrors: Set<Int> = [
        NSURLErrorTimedOut, NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost,
        NSURLErrorDNSLookupFailed, NSURLErrorNotConnectedToInternet, NSURLErrorInternationalRoamingOff,
        NSURLErrorDataNotAllowed,
    ]
    /// the same problems as the operating system's own error numbers
    static let socketErrors: Set<Int> = [
        Int(ECONNREFUSED), Int(ETIMEDOUT), Int(ENETDOWN), Int(ENETUNREACH), Int(ECONNRESET), Int(EHOSTDOWN),
        Int(EHOSTUNREACH), Int(ENOTCONN), Int(ECONNABORTED),
    ]

    static func isNetworkError(_ error: Error?) -> Bool {
        var e: NSError? = error.map { $0 as NSError }
        for _ in 0..<6 {
            guard let x = e else { return false }
            // CFNetwork's domain uses the same numbers as NSURLError
            if (x.domain == NSURLErrorDomain || x.domain == "kCFErrorDomainCFNetwork") && connectionErrors.contains(x.code) { return true }
            if x.domain == NSPOSIXErrorDomain && socketErrors.contains(x.code) { return true }
            e = x.userInfo[NSUnderlyingErrorKey] as? NSError
        }
        return false
    }

    private func failed(_ e: Entry, _ error: Error?) {
        if e === preload {
            // the lined-up song can't be played: line it up once more after a broken connection (see below), or
            // its MP3 version when the phone can't play the original. Otherwise the move to it fails when the
            // current song ends, and is handled then.
            clearPreload()
            let network = PlayerEngine.isNetworkError(error)
            let retry = network && !e.retried
            // (not the MP3 version after a broken connection: it's on the same server)
            let toMP3 = !network && !e.usingFallback && e.item.fallback != nil
            if toMP3 { mp3Keys.insert(e.item.key) }
            if retry { retriesDone += 1 }
            if retry || toMP3, let cur = current {
                // after the current song, or last if AVQueuePlayer has already let go of it (it just ended)
                linePreload(e.item, fallback: retry ? e.usingFallback : true, retried: retry, after: cur, orLast: true)
            }
            return
        }
        guard e === current, !e.failureHandled else { return }
        e.failureHandled = true
        NSLog("%@", "Encore: couldn't play \(e.item.key): \(String(describing: error))")
        if !wantsPlay {
            // nothing was playing (loaded paused, say after the app was reopened away from home): stay on it
            // quietly; Play tries again
            sendState()
            return
        }
        if !e.retried && PlayerEngine.isNetworkError(error) {
            // Once more from where it was before saying the server can't be reached. A broken connection can be
            // a blip (Wi-Fi or Tailscale changing over), and Navidrome sends a freshly made MP3 version (the
            // fallback, or every song with a lower quality chosen) with a length it estimates a little too high
            // (or, to a second request, with its real length), which AVFoundation also reports as a lost
            // connection. By then the server has the finished MP3 kept, with its exact length.
            retriesDone += 1
            put(e.item, fallback: e.usingFallback, at: e.item.isRadio ? 0 : currentTime(), play: true)
            current?.retried = true
            fillPreload()
            return
        }
        if PlayerEngine.isNetworkError(error) {
            // the server can't be reached: stop here instead of skipping through the list; Play tries again
            wantsPlay = false
            player.pause()
            reportError(e.item.key, "Couldn’t reach the music server.", reason: "network")
            sendState()
            nowPlaying()
            saveState()
            return
        }
        if !e.usingFallback, e.item.fallback != nil {
            // the phone can't play the original file (WMA, for example): ask the server for MP3 instead
            mp3Keys.insert(e.item.key)
            startMP3Version(e, at: currentTime())
            return
        }
        reportError(e.item.key, error?.localizedDescription ?? "The song couldn’t be played.", reason: "unplayable")
        if e.item.isRadio {
            wantsPlay = false
            player.pause()
            sendState()
            nowPlaying()
            return
        }
        errorsInARow += 1
        // moves straight on, so the player doesn't fall silent (and get suspended) while the phone is locked
        if errorsInARow >= 4 || !advance(.skip) {
            wantsPlay = false
            player.pause()
            sendState()
            nowPlaying()
        }
    }

    /// Plays the song's MP3 version once Navidrome has made it (at most 15 s, then anyway), so AVPlayer gets
    /// the finished file with its exact length rather than one being made (see TranscodeWarmer).
    private func startMP3Version(_ e: Entry, at t: Double) {
        guard let f = e.item.fallback else { return }
        mp3Switches += 1
        let stillWanted: () -> Bool = { [weak self] in
            guard let self = self else { return false }
            return self.current === e && self.wantsPlay
        }
        let go: () -> Void = { [weak self] in
            guard let self = self, stillWanted() else { return }
            self.put(e.item, fallback: true, at: t, play: true)
            self.fillPreload()
        }
        if !TranscodeWarmer.isTranscode(f) || warmer.isSettled(f) {
            go()
            return
        }
        // nothing is playing meanwhile: ask iOS for the time, in case the phone is locked
        let time = BackgroundTime.begin("Encore: MP3 version")
        warmer.warm(f, within: 15, wanted: stillWanted) {
            go()
            time.end()
        }
    }

    // MARK: - the clock, plays and listening time

    var isPlaying: Bool { current != nil && player.rate != 0 }
    var isWaiting: Bool { player.timeControlStatus == .waitingToPlayAtSpecifiedRate }

    func currentTime() -> Double {
        if let p = pendingSeek { return p }
        guard let cur = current else { return 0 }
        let s = cur.playerItem.currentTime().seconds
        return s.isFinite ? max(0, s) : 0
    }

    func duration() -> Double? {
        guard let cur = current, !cur.item.isRadio else { return nil }
        if cur.item.duration > 0 { return cur.item.duration }
        let d = cur.playerItem.duration.seconds
        return d.isFinite && d > 0 ? d : nil
    }

    private func tick() {
        guard let cur = current else { lastTick = nil; return }
        let t = currentTime()
        let now = CACurrentMediaTime()
        let id = ObjectIdentifier(cur)
        if player.timeControlStatus == .playing {
            if let l = lastTick, l.entry == id {
                let dt = t - l.t
                let wall = now - l.wall
                // count normal forward playback only: not seeks, not stalls (as the page did)
                if dt > 0 && dt <= wall + 1 {
                    link?.countListening(dt)
                    errorsInARow = 0
                    // a blip an hour into a long song or a station gets its one more try too
                    if cur.retried {
                        cur.heardSinceRetry += dt
                        if cur.heardSinceRetry >= 30 { cur.retried = false }
                    }
                }
            }
            lastTick = (id, t, now)
            if !cur.item.isRadio {
                if !nowSent {
                    nowSent = true
                    scrobble(cur.item, submission: false)
                }
                // a play counts at half the song or 4 minutes, whichever comes first (only while playing)
                if !scrobbled, let d = duration(), d > 0, t >= min(d * 0.5, 240) {
                    scrobbled = true
                    scrobble(cur.item, submission: true)
                }
            }
        } else {
            lastTick = nil
        }
        if now - lastTimeSent >= 1 { sendTime() }
        if now - lastSaved >= 15 { saveTime() }
        if now - lastNowPlayingCheck >= 5 { checkNowPlaying() }
    }

    /// Every 5 seconds while a song is on: Now Playing still shows it (nothing else in the app cleared or
    /// replaced it), and the audio session is still the kind iOS shows there (see keepSessionOurs).
    private func checkNowPlaying() {
        lastNowPlayingCheck = CACurrentMediaTime()
        guard let cur = current else { return }
        let before = PlayerEngine.sessionRestores
        if wantsPlay { PlayerEngine.keepSessionOurs() }
        let restored = PlayerEngine.sessionRestores != before
        let shown = MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyTitle] as? String
        if restored || shown != cur.item.title {
            // (after the session was set back, the song is published again so iOS takes the app as Now Playing)
            NSLog("%@", "Encore: Now Playing showed \(shown ?? "nothing") for \(cur.item.title) (session set back: \(restored)); setting it again")
            nowPlayingRepairs += 1
            if restored { activateSession() }
            nowPlaying(reset: true)
        }
    }

    private func scrobble(_ item: Item, submission: Bool) {
        guard let url = item.scrobbleURL(submission: submission, at: Date()) else { return }
        let req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            let ok = PlayerEngine.subsonicOK(data)
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.scrobbleLog.append((key: item.key, submission: submission, ok: ok))
                if self.scrobbleLog.count > 200 { self.scrobbleLog.removeFirst(self.scrobbleLog.count - 200) }
                if submission && ok { self.record(["type": "scrobbled", "key": item.key]) }
            }
        }.resume()
    }

    static func subsonicOK(_ data: Data?) -> Bool {
        guard let data = data,
              let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let r = o["subsonic-response"] as? [String: Any] else { return false }
        return (r["status"] as? String) == "ok"
    }

    // MARK: - telling the page

    private func send(_ m: [String: Any]) { link?.send(m) }

    private func reportError(_ key: String, _ message: String, reason: String) {
        lastErrorReason = reason
        record(["type": "error", "key": key, "message": message, "reason": reason])
    }

    private func record(_ m: [String: Any]) {
        var m = m
        m["req"] = queue.lastReq
        link?.record(m)
    }

    private func sendTime() {
        guard let cur = current else { return }
        lastTimeSent = CACurrentMediaTime()
        send(["type": "time", "key": cur.item.key, "req": queue.lastReq, "t": finite(currentTime()), "d": finite(duration() ?? 0)])
    }

    private func sendState() {
        guard let cur = current else { return }
        sendTime()
        send(["type": "state", "key": cur.item.key, "req": queue.lastReq, "playing": isPlaying, "waiting": isWaiting])
    }

    private func playStateChanged() {
        sendState()
        let playingNow = player.timeControlStatus == .playing
        // when the music starts, everything about the song again (the system may have dropped it)
        nowPlaying(reset: playingNow && !wasPlaying)
        wasPlaying = playingNow
        checkStallAtEnd()
    }

    /// Navidrome's freshly made MP3 versions (the fallback, or every song with a lower quality chosen) promise
    /// a few more bytes than they send, so the player can sit "waiting" just before the end for bytes that never
    /// come (seen on CI: stuck at 5.9 s of 6). Stuck in a song's last 2 seconds for 3 seconds: it has ended.
    private func checkStallAtEnd() {
        guard let cur = current, wantsPlay, !cur.didEnd, !cur.item.isRadio,
              player.timeControlStatus == .waitingToPlayAtSpecifiedRate,
              let d = duration(), d > 0 else { return }
        let at = currentTime()
        // (past half way too: a song of 2 s or less is otherwise "near its end" while it starts)
        guard at >= d - 2, at >= d * 0.5 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self = self, self.current === cur, self.wantsPlay, !cur.didEnd,
                  self.player.currentItem === cur.playerItem,
                  self.player.timeControlStatus == .waitingToPlayAtSpecifiedRate,
                  abs(self.currentTime() - at) < 0.5 else { return }
            NSLog("%@", "Encore: \(cur.item.key) stalled just before its end; counting it as ended")
            self.finishStalled(cur)
        }
    }

    /// As ended(), for a song the player never quite finished.
    private func finishStalled(_ cur: Entry) {
        stallEnds += 1
        if queue.repeatOne {
            // again from the start, from a fresh copy (by now the server has the finished MP3, exact length)
            put(cur.item, fallback: cur.usingFallback, at: 0, play: true)
            songChanged()
            fillPreload()
            nowPlaying(reset: true)
            sendState()
            return
        }
        cur.didEnd = true
        // the next song starts from a fresh copy rather than the one lined up behind the stuck one
        clearPreload()
        if !advance(.ended) { endOfList(cur) }
    }

    private func finite(_ x: Double) -> Double { x.isFinite ? x : 0 }

    // MARK: - Now Playing on the lock screen

    func nowPlaying(reset: Bool = false) {
        let center = MPNowPlayingInfoCenter.default()
        guard let cur = current else {
            center.nowPlayingInfo = nil
            return
        }
        let it = cur.item
        var info = reset ? [String: Any]() : (center.nowPlayingInfo ?? [:])
        info[MPMediaItemPropertyTitle] = it.title
        info[MPMediaItemPropertyArtist] = it.artist
        info[MPMediaItemPropertyAlbumTitle] = it.album
        info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
        info[MPNowPlayingInfoPropertyIsLiveStream] = it.isRadio
        if let d = duration() { info[MPMediaItemPropertyPlaybackDuration] = d } else { info.removeValue(forKey: MPMediaItemPropertyPlaybackDuration) }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = finite(currentTime())
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying && !isWaiting ? 1.0 : 0.0
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = 1.0
        if let art = it.art {
            if let img = artwork.image(for: art) {
                info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
            } else if reset {
                artwork.fetch(art) { [weak self] img in
                    guard let self = self, let img = img, self.current?.item.key == it.key,
                          var now = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
                    now[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
                    MPNowPlayingInfoCenter.default().nowPlayingInfo = now
                }
            }
        } else {
            info.removeValue(forKey: MPMediaItemPropertyArtwork)
        }
        center.nowPlayingInfo = info
    }

    // MARK: - calls, Siri, headphones

    @objc private func interrupted(_ n: Notification) {
        guard let info = n.userInfo, let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        let options = AVAudioSession.InterruptionOptions(rawValue: info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if type == .began {
                // the system has paused the player
                self.resumeAfterInterruption = self.wantsPlay
            } else {
                if options.contains(.shouldResume) && self.resumeAfterInterruption && self.current != nil {
                    self.activateSession()
                    self.player.play()
                } else if self.resumeAfterInterruption {
                    self.wantsPlay = false
                }
                self.resumeAfterInterruption = false
            }
            self.sendState()
            self.nowPlaying()
        }
    }

    @objc private func routeChanged(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
        if reason == .categoryChange {
            // something set another category (see keepSessionOurs); the app's own change comes here too and is
            // left alone
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                let before = PlayerEngine.sessionRestores
                PlayerEngine.keepSessionOurs()
                if PlayerEngine.sessionRestores != before && self.current != nil {
                    if self.wantsPlay { self.activateSession() }
                    self.nowPlaying(reset: true)
                }
            }
        }
        if reason == .oldDeviceUnavailable {
            // headphones unplugged or disconnected: pause, as the Music app does
            DispatchQueue.main.async { [weak self] in self?.pause() }
        }
    }

    @objc private func mediaServicesReset(_ n: Notification) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            // after a reset the audio objects have to be made again
            let cur = self.current
            let at = self.currentTime()
            self.detach()
            self.player = AVQueuePlayer()
            self.attach(self.player)
            self.preload = nil
            self.current = nil
            PlayerEngine.configureAudioSession()
            if let cur = cur {
                self.put(cur.item, fallback: cur.usingFallback, at: at, play: false)
                self.fillPreload()
                self.sendState()
                self.nowPlaying()
            }
        }
    }

    // MARK: - AirPlay

    /// The AirPlay button is always there in the app, as in the Music app: its list also has the phone's
    /// speaker and Bluetooth headphones.
    var routesAvailable: Bool { true }

    // MARK: - for the test panel

    var debugState: [String: Any] {
        [
            "key": current?.item.key ?? "",
            "title": current?.item.title ?? "",
            "playing": isPlaying,
            "waiting": isWaiting,
            "t": (finite(currentTime()) * 10).rounded() / 10,
            "ahead": queue.ahead.count,
            "aheadKeys": queue.ahead.prefix(5).map { $0.key },
            "back": queue.back.count,
            "req": queue.lastReq,
            "repeatOne": queue.repeatOne,
            "fallback": current?.usingFallback ?? false,
            "preload": preload?.item.key ?? "",
            "errors": errorsInARow,
            "lastError": lastErrorReason,
            "category": AVAudioSession.sharedInstance().category.rawValue,
            "mixes": AVAudioSession.sharedInstance().categoryOptions.contains(.mixWithOthers),
            "sessionRestores": PlayerEngine.sessionRestores,
            "nowPlayingRepairs": nowPlayingRepairs,
            "stallEnds": stallEnds,
            "retries": retriesDone,
            "mp3Switches": mp3Switches,
            "preloadMP3": preload?.usingFallback ?? false,
            "own": current != nil && !currentFromPage,
            "scrobbles": scrobbleLog.filter { $0.submission && $0.ok }.count,
            "nowPlaying": MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyTitle] as? String ?? "",
        ]
    }
}

/// Where the player keeps its place: the list of songs in a file (written when it changes), the time in the
/// song in UserDefaults (written every 15 seconds while playing, and on pause).
final class PlayerStore {
    let file: URL
    let defaults: UserDefaults
    static let timeKey = "encore.playerTime"

    init(file: URL, defaults: UserDefaults) {
        self.file = file
        self.defaults = defaults
    }

    /// The app's own: Application Support/player.json
    static func standard() -> PlayerStore? {
        guard let dir = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                     appropriateFor: nil, create: true) else { return nil }
        return PlayerStore(file: dir.appendingPathComponent("player.json"), defaults: .standard)
    }

    func saveList(_ s: PlayerEngine.Saved) {
        if let data = try? JSONEncoder().encode(s) { try? data.write(to: file, options: .atomic) }
    }

    func loadList() -> PlayerEngine.Saved? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(PlayerEngine.Saved.self, from: data)
    }

    func saveTime(_ t: Double, key: String) {
        defaults.set(["key": key, "t": t] as [String: Any], forKey: PlayerStore.timeKey)
    }

    /// The saved time, if it's for this song (the list and the time are written at different moments).
    func loadTime(key: String) -> Double {
        guard let d = defaults.dictionary(forKey: PlayerStore.timeKey), d["key"] as? String == key,
              let t = (d["t"] as? NSNumber)?.doubleValue, t.isFinite, t > 0 else { return 0 }
        return t
    }

    func clear() {
        try? FileManager.default.removeItem(at: file)
        defaults.removeObject(forKey: PlayerStore.timeKey)
    }
}

/// Cover art for the lock screen, kept for the last few songs.
final class ArtworkCache {
    private let cache = NSCache<NSURL, UIImage>()

    init() { cache.countLimit = 12 }

    func image(for url: URL) -> UIImage? { cache.object(forKey: url as NSURL) }

    func fetch(_ url: URL, done: @escaping (UIImage?) -> Void) {
        if let img = image(for: url) { done(img); return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            let img = data.flatMap { UIImage(data: $0) }
            DispatchQueue.main.async {
                if let img = img { self?.cache.setObject(img, forKey: url as NSURL) }
                done(img)
            }
        }.resume()
    }
}

/// Gets Navidrome's transcodes (`format=` other than raw: the MP3 versions) made before AVPlayer asks for one.
/// A transcode being made is sent with `Accept-Ranges: none` and an estimated length about 2% too high (with
/// estimateContentLength), which leaves AVPlayer waiting for bytes that never come or reporting a lost
/// connection. A HEAD request makes Navidrome make it in the background; once it's finished and kept, the
/// server answers with `Accept-Ranges: bytes` and the exact length (core/stream/media_streamer.go).
final class TranscodeWarmer {
    private struct Waiter {
        let wanted: () -> Bool
        let done: () -> Void
    }
    private var settled = Set<URL>()
    private var waiting: [URL: [Waiter]] = [:]
    /// A long warm-up (a minute) ran out of time: the server doesn't keep its transcodes (cache turned off, or
    /// not Navidrome), so transcodes go to AVPlayer as they are for the rest of the session, without asking.
    private(set) var isOff = false

    static func isTranscode(_ url: URL) -> Bool {
        guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let format = items.first(where: { $0.name == "format" })?.value else { return false }
        return !format.isEmpty && format.lowercased() != "raw"
    }

    /// ready on the server, or given up on (then AVPlayer gets it as it is)
    func isSettled(_ url: URL) -> Bool { isOff || settled.contains(url) }

    /// Calls `done` on the main queue once the server has it finished and kept, or after `within` seconds.
    /// Stops asking (without calling `done`) once no caller still `wanted` it.
    func warm(_ url: URL, within: TimeInterval, wanted: @escaping () -> Bool, done: @escaping () -> Void) {
        if isSettled(url) {
            done()
            return
        }
        let w = Waiter(wanted: wanted, done: done)
        if waiting[url] != nil {
            waiting[url]?.append(w)
            return
        }
        waiting[url] = [w]
        ask(url, attempt: 0, until: Date().addingTimeInterval(within), judging: within >= 60, answered: false)
    }

    /// `judging`: running out of time means the server doesn't keep transcodes (a short wait, for the song
    /// that's meant to be playing, can run out on a long song that's still being made). `answered`: the server
    /// did answer (no answer at all says nothing about its transcodes).
    private func ask(_ url: URL, attempt: Int, until deadline: Date, judging: Bool, answered: Bool) {
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        req.httpMethod = "HEAD"
        URLSession.shared.dataTask(with: req) { [weak self] _, response, _ in
            let http = response as? HTTPURLResponse
            let ranges = http?.value(forHTTPHeaderField: "Accept-Ranges")?.lowercased()
            DispatchQueue.main.async {
                guard let self = self else { return }
                if ranges == "bytes" {
                    self.finish(url)
                    return
                }
                // an error instead of music (a missing or broken file): nothing to wait for
                if let h = http, h.statusCode >= 400 || !(h.mimeType ?? "").lowercased().hasPrefix("audio/") {
                    self.finish(url)
                    return
                }
                // nobody waits for it any more (the list changed, the song moved on): stop asking
                let still = (self.waiting[url] ?? []).filter { $0.wanted() }
                guard !still.isEmpty else {
                    self.waiting[url] = nil
                    return
                }
                self.waiting[url] = still
                let answeredNow = answered || http != nil
                if Date() >= deadline {
                    if judging && answeredNow { self.isOff = true }
                    self.finish(url)
                    return
                }
                // 0.5 s, 1 s, 2 s, then every 4 s: a long song takes the server a while
                let pause = [0.5, 1, 2][min(attempt, 2)] + (attempt > 2 ? 2 : 0)
                DispatchQueue.main.asyncAfter(deadline: .now() + pause) { [weak self] in
                    self?.ask(url, attempt: attempt + 1, until: deadline, judging: judging, answered: answeredNow)
                }
            }
        }.resume()
    }

    private func finish(_ url: URL) {
        if settled.count > 500 { settled.removeAll() }
        settled.insert(url)
        let done = waiting.removeValue(forKey: url) ?? []
        done.forEach { $0.done() }
    }
}

/// A little time for work while the app is in the background with nothing playing.
final class BackgroundTime {
    private var id: UIBackgroundTaskIdentifier = .invalid

    static func begin(_ name: String) -> BackgroundTime {
        let b = BackgroundTime()
        b.id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak b] in b?.end() }
        return b
    }

    func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }

    /// (also when the work holding it is dropped without finishing: iOS ends an app that keeps the time)
    deinit { end() }
}
