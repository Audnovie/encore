import AVFoundation
import MediaPlayer
import XCTest
@testable import Encore

/// The real player (AVQueuePlayer) with short tone files written by the test, and a stand-in for the page.
/// Plays are "registered" with a stand-in server (StubServer) instead of Navidrome.
final class PlayerEngineTests: XCTestCase {
    private var dir: URL!
    private var engine: PlayerEngine!
    private var page: FakePage!

    override func setUpWithError() throws {
        continueAfterFailure = false
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("encore-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        URLProtocol.registerClass(StubServer.self)
        StubServer.reset()
        PlayerEngine.configureAudioSession()
        engine = PlayerEngine()
        page = FakePage()
        engine.link = page
    }

    override func tearDownWithError() throws {
        engine?.stop()
        engine = nil
        URLProtocol.unregisterClass(StubServer.self)
        try? FileManager.default.removeItem(at: dir)
    }

    // MARK: - helpers

    private func tone(_ name: String, seconds: Double, freq: Double = 440) throws -> URL {
        let url = dir.appendingPathComponent(name + ".wav")
        try writeWAV(url, seconds: seconds, freq: freq)
        return url
    }

    private func song(_ key: String, _ url: URL, seconds: Double, fallback: URL? = nil) -> Item {
        Item(key: key, url: url, fallback: fallback, title: "Song \(key)", artist: "Test", album: "Tests", duration: seconds,
             scrobble: URL(string: "http://stub.test/rest/scrobble?u=t&id=\(key)"))
    }

    @discardableResult
    private func waitUntil(_ timeout: TimeInterval, _ what: String, _ cond: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if cond() { return true }
            RunLoop.main.run(until: Date().addingTimeInterval(0.05))
        }
        if cond() { return true }
        XCTFail("waited \(timeout)s for: \(what). Player: \(engine.debugState)")
        return false
    }

    private func pause(_ seconds: TimeInterval) {
        RunLoop.main.run(until: Date().addingTimeInterval(seconds))
    }

    /// The first thing every test checks: does time move? (A Mac runner without an audio device won't play.)
    private func waitForSound() {
        waitUntil(10, "the song to start playing (time moving). If this fails on CI, the runner may have no audio output device") {
            engine.isPlaying && engine.currentTime() > 0.2
        }
    }

    // MARK: - tests

    func testMovesOnByItselfAndRegistersPlays() throws {
        let a = song("a", try tone("a", seconds: 1.5, freq: 330), seconds: 1.5)
        let b = song("b", try tone("b", seconds: 1.5, freq: 440), seconds: 1.5)
        let c = song("c", try tone("c", seconds: 1.5, freq: 550), seconds: 1.5)
        engine.load(a, req: 1, startAt: 0, autoplay: true, restore: false)
        engine.upcoming(key: "a", req: 1, items: [b, c], back: [], repeatOne: false)
        waitForSound()
        XCTAssertEqual(engine.preload?.item.key, "b", "the next song is lined up")
        waitUntil(8, "song c to start") { engine.current?.item.key == "c" }
        XCTAssertEqual(page.advances.map { "\($0.from)>\($0.to ?? "-"):\($0.reason)" }, ["a>b:ended", "b>c:ended"])
        XCTAssertTrue(page.advances.allSatisfy { $0.req == 1 }, "stamped with the page's request")
        waitUntil(8, "the end of the list") { page.advances.count == 3 }
        XCTAssertEqual(page.advances.last?.to, nil)
        XCTAssertEqual(engine.current?.item.key, "c", "stays on the last song")
        XCTAssertFalse(engine.isPlaying, "paused at the end")
        XCTAssertLessThan(engine.currentTime(), 0.5, "at its start")
        // plays: now-playing at the start and the play itself at half way, for each song
        waitUntil(5, "plays registered") { page.scrobbled.count == 3 }
        XCTAssertEqual(page.scrobbled, ["a", "b", "c"])
        let subs = StubServer.requests.compactMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems }
        XCTAssertEqual(subs.filter { $0.contains(URLQueryItem(name: "submission", value: "true")) }.count, 3)
        XCTAssertEqual(subs.filter { $0.contains(URLQueryItem(name: "submission", value: "false")) }.count, 3)
        // listening time: about 4.5 s
        XCTAssertEqual(page.listened, 4.5, accuracy: 1.2)
    }

    func testRepeatOneStartsTheSongAgain() throws {
        let a = song("a", try tone("a", seconds: 1.2), seconds: 1.2)
        let b = song("b", try tone("b", seconds: 1.2), seconds: 1.2)
        engine.load(a, req: 1, startAt: 0, autoplay: true, restore: false)
        engine.upcoming(key: "a", req: 1, items: [b], back: [], repeatOne: true)
        waitForSound()
        pause(3.2)
        XCTAssertEqual(engine.current?.item.key, "a")
        XCTAssertTrue(engine.isPlaying)
        XCTAssertTrue(page.advances.isEmpty, "no moving on")
        waitUntil(3, "each time round counted") { page.scrobbled.count >= 2 }
        // repeat off again: moves on at the end
        engine.upcoming(key: "a", req: 1, items: [b], back: [], repeatOne: false)
        waitUntil(4, "song b") { engine.current?.item.key == "b" }
    }

    func testLockScreenNextAndBack() throws {
        let a = song("a", try tone("a", seconds: 8), seconds: 8)
        let b = song("b", try tone("b", seconds: 8), seconds: 8)
        let c = song("c", try tone("c", seconds: 8), seconds: 8)
        engine.load(b, req: 4, startAt: 0, autoplay: true, restore: false)
        engine.upcoming(key: "b", req: 4, items: [c], back: [a], repeatOne: false)
        waitForSound()
        engine.remoteNext()
        XCTAssertEqual(engine.current?.item.key, "c")
        waitForSound()
        engine.remotePrevious()
        XCTAssertEqual(engine.current?.item.key, "b", "back near the start: the song before")
        XCTAssertEqual(engine.queue.ahead.first?.key, "c")
        waitUntil(6, "3.5 s into b") { engine.currentTime() > 3.5 }
        engine.remotePrevious()
        XCTAssertEqual(engine.current?.item.key, "b", "later in a song: its start")
        waitUntil(2, "back at the start") { engine.currentTime() < 1 }
        engine.remoteNext()
        engine.remoteNext()
        XCTAssertEqual(engine.current?.item.key, "c")
        XCTAssertFalse(engine.isPlaying, "Next on the last song: stopped at its start")
        XCTAssertEqual(page.advances.map(\.reason), ["next", "prev", "next"])
        engine.play()
        waitForSound()
        engine.pause()
        XCTAssertFalse(engine.isPlaying)
        XCTAssertFalse(engine.wantsPlay)
    }

    func testFallsBackToTheMP3VersionThenSkipsWhatWontPlay() throws {
        let broken = dir.appendingPathComponent("broken.wav")
        try Data("this is not audio".utf8).write(to: broken)
        let good = try tone("good", seconds: 1.2)
        let x = song("x", broken, seconds: 1.2, fallback: good)
        engine.load(x, req: 1, startAt: 0, autoplay: true, restore: false)
        waitForSound()
        XCTAssertEqual(engine.current?.usingFallback, true, "played the MP3 version")
        XCTAssertTrue(page.errors.isEmpty)

        let y = song("y", broken, seconds: 1.2)
        let z = song("z", try tone("z", seconds: 3), seconds: 3)
        engine.load(y, req: 2, startAt: 0, autoplay: true, restore: false)
        engine.upcoming(key: "y", req: 2, items: [z], back: [], repeatOne: false)
        waitUntil(8, "skipped to z") { engine.current?.item.key == "z" }
        XCTAssertEqual(page.errors, ["y"])
        XCTAssertEqual(page.advances.last?.reason, "skip")
        waitForSound()
    }

    func testASongThatWontLoadWhilePausedIsLeftAlone() throws {
        let broken = dir.appendingPathComponent("broken2.wav")
        try Data("not audio either".utf8).write(to: broken)
        let y = song("y", broken, seconds: 2)
        let z = song("z", try tone("z", seconds: 3), seconds: 3)
        engine.load(y, req: 1, startAt: 0, autoplay: false, restore: false)
        engine.upcoming(key: "y", req: 1, items: [z], back: [], repeatOne: false)
        pause(2)
        XCTAssertEqual(engine.current?.item.key, "y", "stays on it")
        XCTAssertTrue(page.errors.isEmpty, "no message while nothing was playing")
        XCTAssertTrue(page.advances.isEmpty, "no skipping while nothing was playing")
        engine.play()                        // Play tries again; now it's reported and skipped
        waitUntil(8, "skipped to z after Play") { engine.current?.item.key == "z" }
        XCTAssertEqual(page.errors, ["y"])
    }

    func testCantReachTheServerStopsInsteadOfSkipping() throws {
        let gone = Item(key: "n", url: URL(string: "http://127.0.0.1:9/rest/stream?id=n")!,
                        fallback: URL(string: "http://127.0.0.1:9/rest/stream?id=n&format=mp3")!, title: "Song n", duration: 30)
        let z = song("z", try tone("z", seconds: 3), seconds: 3)
        engine.load(gone, req: 1, startAt: 0, autoplay: true, restore: false)
        engine.upcoming(key: "n", req: 1, items: [z], back: [], repeatOne: false)
        waitUntil(30, "the connection error to be reported") { !page.errors.isEmpty }
        XCTAssertEqual(page.errors, ["n"])
        XCTAssertEqual(engine.current?.item.key, "n", "it stays on the song")
        XCTAssertTrue(page.advances.isEmpty, "no skipping through the list")
        XCTAssertFalse(engine.wantsPlay)
        XCTAssertEqual(engine.current?.usingFallback, false, "the MP3 version is on the same server: not tried")
    }

    func testRecognisesConnectionProblems() {
        let refused = NSError(domain: AVFoundationErrorDomain, code: -11800,
                              userInfo: [NSUnderlyingErrorKey: NSError(domain: NSURLErrorDomain, code: NSURLErrorCannotConnectToHost)])
        XCTAssertTrue(PlayerEngine.isNetworkError(refused))
        XCTAssertTrue(PlayerEngine.isNetworkError(NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut)))
        XCTAssertFalse(PlayerEngine.isNetworkError(NSError(domain: AVFoundationErrorDomain, code: -11828)), "a file it can't open")
        XCTAssertFalse(PlayerEngine.isNetworkError(NSError(domain: NSURLErrorDomain, code: NSURLErrorResourceUnavailable)),
                       "the server answered, just not with the song")
        XCTAssertFalse(PlayerEngine.isNetworkError(nil))
        XCTAssertTrue(PlayerEngine.isNetworkError(NSError(domain: AVFoundationErrorDomain, code: -11800,
                                                          userInfo: [NSUnderlyingErrorKey: NSError(domain: NSPOSIXErrorDomain, code: Int(ECONNREFUSED))])))
        XCTAssertTrue(PlayerEngine.isNetworkError(NSError(domain: "kCFErrorDomainCFNetwork", code: NSURLErrorCannotConnectToHost)))
    }

    func testAPlayIsntCountedAgainWhenStartingPastHalfway() throws {
        let a = song("a", try tone("a", seconds: 4), seconds: 4)
        engine.load(a, req: 1, startAt: 2.5, autoplay: true, restore: true)
        waitForSound()
        waitUntil(6, "the end") { page.advances.count == 1 }
        pause(0.5)
        XCTAssertTrue(page.scrobbled.isEmpty, "the play was counted before the app was closed")
        let subs = StubServer.requests.compactMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems }
        XCTAssertEqual(subs.filter { $0.contains(URLQueryItem(name: "submission", value: "false")) }.count, 1, "now playing is still sent")
    }

    func testSnapshotSaysWhoChoseTheSong() throws {
        let a = song("a", try tone("a", seconds: 8), seconds: 8)
        let b = song("b", try tone("b", seconds: 8), seconds: 8)
        engine.load(a, req: 3, startAt: 0, autoplay: true, restore: false)
        engine.upcoming(key: "a", req: 3, items: [b], back: [], repeatOne: false)
        waitForSound()
        XCTAssertEqual(engine.snapshot()["own"] as? Bool, false, "the page's own request")
        engine.remoteNext()
        let snap = engine.snapshot()
        XCTAssertEqual(snap["own"] as? Bool, true, "the app moved on by itself")
        XCTAssertEqual((snap["song"] as? [String: Any])?["id"] as? String, "b")
        XCTAssertEqual((page.recorded.last { $0["type"] as? String == "advance" }?["song"] as? [String: Any])?["title"] as? String, "Song b")
        XCTAssertTrue(JSONSerialization.isValidJSONObject(snap))
    }

    func testRestoreDoesntReplaceThePlayingSong() throws {
        let a = song("a", try tone("a", seconds: 5), seconds: 5)
        let old = song("old", try tone("old", seconds: 5), seconds: 5)
        engine.load(a, req: 9, startAt: 0, autoplay: true, restore: false)
        waitForSound()
        engine.load(old, req: 1, startAt: 2, autoplay: false, restore: true)
        XCTAssertEqual(engine.current?.item.key, "a")
        XCTAssertTrue(engine.isPlaying)
        XCTAssertEqual(engine.snapshot()["req"] as? Int, 1, "but the new page's request number is noted")
        // coming songs sent for another song are ignored
        engine.upcoming(key: "old", req: 1, items: [old], back: [], repeatOne: false)
        XCTAssertTrue(engine.queue.ahead.isEmpty)
    }

    func testRestoreLoadsPausedWhereItWas() throws {
        let a = song("a", try tone("a", seconds: 6), seconds: 6)
        engine.load(a, req: 1, startAt: 3, autoplay: false, restore: true)
        waitUntil(5, "ready") { engine.current?.playerItem.status == .readyToPlay }
        waitUntil(3, "at 3 s") { abs(engine.currentTime() - 3) < 0.3 }
        XCTAssertFalse(engine.isPlaying)
        let snap = engine.snapshot()
        XCTAssertEqual(snap["key"] as? String, "a")
        XCTAssertEqual(snap["playing"] as? Bool, false)
        XCTAssertEqual(snap["ready"] as? Bool, true)
    }

    func testKeepsItsPlaceForTheNextLaunch() throws {
        let suite = "encore.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = PlayerStore(file: dir.appendingPathComponent("player.json"), defaults: defaults)
        let a = song("a", try tone("a", seconds: 8), seconds: 8)
        let b = song("b", try tone("b", seconds: 8), seconds: 8)
        engine.store = store
        engine.load(a, req: 5, startAt: 0, autoplay: true, restore: false)
        engine.upcoming(key: "a", req: 5, items: [b], back: [], repeatOne: false)
        waitForSound()
        waitUntil(5, "2 s in") { engine.currentTime() > 2 }
        engine.pause()
        let at = engine.currentTime()
        XCTAssertEqual(store.loadList()?.current.key, "a")
        XCTAssertEqual(store.loadList()?.ahead.map(\.key), ["b"])
        XCTAssertEqual(store.loadTime(key: "a"), at, accuracy: 0.3, "Pause notes the time")
        XCTAssertEqual(store.loadTime(key: "b"), 0, "a time for another song isn't used")

        // a new launch
        let again = PlayerEngine()
        again.store = store
        again.resumeSaved()
        XCTAssertEqual(again.current?.item.key, "a")
        XCTAssertEqual(again.queue.ahead.map(\.key), ["b"])
        XCTAssertFalse(again.isPlaying, "ready but paused")
        XCTAssertEqual(again.snapshot()["req"] as? Int, 0, "the page's numbers start again")
        XCTAssertEqual(again.snapshot()["own"] as? Bool, true, "its own place: the page goes to it")
        XCTAssertEqual(again.currentTime(), at, accuracy: 0.6)
        again.play()                        // Play on the lock screen, before the page has loaded
        waitUntil(10, "playing after the relaunch") { again.isPlaying && again.currentTime() > at + 0.3 }
        again.remoteNext()
        XCTAssertEqual(again.current?.item.key, "b", "Next works too")
        again.stop()
        XCTAssertNil(store.loadList(), "Sign Out (stop) forgets the place")
    }

    func testPlayAfterTheConnectionBrokeMidSongStartsItAgain() throws {
        let a = song("a", try tone("a", seconds: 8), seconds: 8)
        engine.load(a, req: 1, startAt: 0, autoplay: true, restore: false)
        waitForSound()
        // as AVFoundation reports a stream that broke off part way (the song itself still "ready")
        let lost = NSError(domain: NSURLErrorDomain, code: NSURLErrorNetworkConnectionLost)
        NotificationCenter.default.post(name: .AVPlayerItemFailedToPlayToEndTime, object: engine.current?.playerItem,
                                        userInfo: [AVPlayerItemFailedToPlayToEndTimeErrorKey: lost])
        waitUntil(3, "stopped with a message") { !engine.wantsPlay && page.errors == ["a"] }
        XCTAssertEqual(page.recorded.last { $0["type"] as? String == "error" }?["reason"] as? String, "network")
        let broken = engine.current?.playerItem
        engine.play()
        XCTAssertFalse(engine.current?.playerItem === broken, "Play starts it again from a fresh copy")
        waitUntil(6, "playing again") { engine.isPlaying && engine.currentTime() > 0.5 }
    }

    func testStopClearsEverything() throws {
        let a = song("a", try tone("a", seconds: 5), seconds: 5)
        engine.load(a, req: 1, startAt: 0, autoplay: true, restore: false)
        waitForSound()
        engine.stop()
        XCTAssertNil(engine.current)
        XCTAssertFalse(engine.isPlaying)
        XCTAssertEqual(engine.snapshot()["key"] as? String, "")
        XCTAssertNil(MPNowPlayingInfoCenter.default().nowPlayingInfo)
    }

    func testNowPlayingOnTheLockScreen() throws {
        let a = song("a", try tone("a", seconds: 5), seconds: 5)
        engine.load(a, req: 1, startAt: 0, autoplay: true, restore: false)
        waitForSound()
        let info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        XCTAssertEqual(info[MPMediaItemPropertyTitle] as? String, "Song a")
        XCTAssertEqual(info[MPMediaItemPropertyArtist] as? String, "Test")
        XCTAssertEqual(info[MPMediaItemPropertyPlaybackDuration] as? Double, 5)
    }
}

/// Stands in for the page: collects what the player tells it.
final class FakePage: PageLink {
    struct Advance { let from: String; let to: String?; let reason: String; let req: Int }
    var sent: [[String: Any]] = []
    var recorded: [[String: Any]] = []
    var listened: Double = 0

    func send(_ message: [String: Any]) { sent.append(message) }
    func record(_ message: [String: Any]) { recorded.append(message) }
    func countListening(_ seconds: Double) { listened += seconds }

    var advances: [Advance] {
        recorded.filter { $0["type"] as? String == "advance" }.map {
            Advance(from: $0["from"] as? String ?? "", to: $0["to"] as? String, reason: $0["reason"] as? String ?? "", req: $0["req"] as? Int ?? -1)
        }
    }
    var scrobbled: [String] { recorded.filter { $0["type"] as? String == "scrobbled" }.compactMap { $0["key"] as? String } }
    var errors: [String] { recorded.filter { $0["type"] as? String == "error" }.compactMap { $0["key"] as? String } }
}

/// Answers the scrobble requests like Navidrome does.
final class StubServer: URLProtocol {
    private static let lock = NSLock()
    private static var _requests: [URL] = []
    static var requests: [URL] { lock.lock(); defer { lock.unlock() }; return _requests }
    static func reset() { lock.lock(); _requests = []; lock.unlock() }

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "stub.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        StubServer.lock.lock(); StubServer._requests.append(url); StubServer.lock.unlock()
        let body = Data(#"{"subsonic-response":{"status":"ok","version":"1.16.1"}}"#.utf8)
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// A mono 16-bit tone.
func writeWAV(_ url: URL, seconds: Double, freq: Double) throws {
    let rate = 22050
    let n = Int(Double(rate) * seconds)
    var d = Data()
    func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
    func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
    d.append(contentsOf: Array("RIFF".utf8)); u32(UInt32(36 + n * 2)); d.append(contentsOf: Array("WAVE".utf8))
    d.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
    d.append(contentsOf: Array("data".utf8)); u32(UInt32(n * 2))
    for i in 0..<n {
        let s = Int16(sin(2 * Double.pi * freq * Double(i) / Double(rate)) * 6000)
        u16(UInt16(bitPattern: s))
    }
    try d.write(to: url)
}
