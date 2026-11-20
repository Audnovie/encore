import XCTest

/// The whole app against a real Navidrome and this commit's Encore page, served the way the home server
/// does it (nginx on one address, /rest/ passed to Navidrome). CI starts those (ios/ci/start_servers.sh)
/// with a test library of short tone-only songs (ios/ci/make_test_music.py).
///
/// The app runs in test mode: a panel shows the player's state and has buttons for the lock screen
/// controls and for holding messages back from the page (as if the phone were locked).
final class IntegrationTests: XCTestCase {
    static let encore = "http://127.0.0.1:4540/"
    static let navidrome = "http://127.0.0.1:4533"
    static let user = "tester", password = "encore-test-pw"

    var app: XCUIApplication!
    private var runs = 0

    override func setUpWithError() throws {
        continueAfterFailure = false
        let up = Self.reachable(Self.encore + "index.html")
        if ProcessInfo.processInfo.environment["ENCORE_CI"] == "1" {
            // on CI the servers must be there: a missing server is a failure, not a skip
            XCTAssertTrue(up, "The test servers aren't running")
            if !up { throw XCTSkip("no servers") }
        } else {
            try XCTSkipUnless(up, "The test servers aren't running (CI starts them)")
        }
    }

    // MARK: - helpers

    static func reachable(_ s: String) -> Bool {
        guard let url = URL(string: s) else { return false }
        let done = DispatchSemaphore(value: 0)
        let ok = Box(false)
        var req = URLRequest(url: url)
        req.timeoutInterval = 5
        URLSession.shared.dataTask(with: req) { _, r, _ in
            ok.value = (r as? HTTPURLResponse)?.statusCode == 200
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 6)
        return ok.value
    }

    /// A Subsonic call to Navidrome from the test itself.
    static func subsonic(_ endpoint: String, _ params: [String: String] = [:]) -> [String: Any] {
        var c = URLComponents(string: navidrome + "/rest/" + endpoint)!
        c.queryItems = ["u": user, "p": password, "v": "1.16.1", "c": "uitest", "f": "json"].merging(params) { $1 }
            .map { URLQueryItem(name: $0.key, value: $0.value) }
        let done = DispatchSemaphore(value: 0)
        let out = Box<[String: Any]>([:])
        URLSession.shared.dataTask(with: c.url!) { data, _, _ in
            if let data = data, let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                out.value = o["subsonic-response"] as? [String: Any] ?? [:]
            }
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 10)
        return out.value
    }

    static func playCount(_ id: String) -> Int {
        ((subsonic("getSong", ["id": id])["song"] as? [String: Any])?["playCount"] as? Int) ?? 0
    }

    static func nowPlayingIds() -> [String] {
        let np = subsonic("getNowPlaying")["nowPlaying"] as? [String: Any]
        return (np?["entry"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String }
    }

    func launch(fresh: Bool, address: String = IntegrationTests.encore) {
        app = XCUIApplication()
        app.launchArguments = ["-address", address, "-EncoreTestMode", "YES"] + (fresh ? ["-EncoreFreshStart", "YES"] : [])
        app.launch()
    }

    /// The player's state, from the test panel.
    func native() -> [String: Any] {
        let label = app.staticTexts["testState"].label
        return (try? JSONSerialization.jsonObject(with: Data(label.utf8))) as? [String: Any] ?? [:]
    }

    /// Runs JavaScript in the page and returns what it gave back, as text.
    @discardableResult
    func js(_ code: String, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) -> String {
        runs += 1
        let field = app.textFields["testJS"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "test panel", file: file, line: line)
        field.tap()
        field.typeText(code)
        app.buttons["testRun"].tap()
        let result = app.staticTexts["testResult"]
        let prefix = "\(runs): "
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            let l = result.label
            if l.hasPrefix(prefix) && l != prefix + "…" { return String(l.dropFirst(prefix.count)) }
            usleep(100_000)
        }
        XCTFail("no answer from the page for: \(code)", file: file, line: line)
        return ""
    }

    /// The page's own idea of what's playing.
    func page() -> [String: Any] {
        let s = js("__t.state()")
        return (try? JSONSerialization.jsonObject(with: Data(s.utf8))) as? [String: Any] ?? [:]
    }

    @discardableResult
    func waitFor(_ timeout: TimeInterval, _ what: String, file: StaticString = #filePath, line: UInt = #line, _ cond: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if cond() { return true }
            usleep(250_000)
        }
        if cond() { return true }
        shot("timeout-\(what.prefix(30))")
        XCTFail("waited \(Int(timeout))s for: \(what). Player: \(native())", file: file, line: line)
        return false
    }

    func shot(_ name: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    /// Signs in (fresh launch) and returns the test songs' ids by title.
    func signIn() -> [String: String] {
        XCTAssertTrue(waitFor(30, "the page to say hello") { native()["pageReady"] as? Bool == true })
        js("__t.signIn('\(Self.user)', '\(Self.password)')")
        waitFor(20, "signed in") { page()["signedIn"] as? Bool == true }
        var ids: [String: String] = [:]
        for pair in js("__t.ids()").split(separator: "|") {
            let p = pair.split(separator: "=", maxSplits: 1)
            if p.count == 2 { ids[String(p[0])] = String(p[1]) }
        }
        XCTAssertEqual(ids.count, 7, "test library: \(ids)")
        return ids
    }

    // MARK: - tests

    func test1PlaysAndMovesOnWhileInTheBackground() {
        launch(fresh: true)
        let ids = signIn()
        let s1 = ids["Song 1"]!, s2 = ids["Song 2"]!, s3 = ids["Song 3"]!
        let before = (Self.playCount(s1), Self.playCount(s2))
        XCTAssertEqual(js("__t.play(0, 3)"), [s1, s2, s3].joined(separator: ","))
        waitFor(20, "Song 1 playing, its time moving (no audio output on the runner would stop it)") {
            let n = native()
            return n["key"] as? String == s1 && n["playing"] as? Bool == true && (n["t"] as? Double ?? 0) > 1
        }
        XCTAssertEqual(native()["ahead"] as? Int, 2, "the app knows the two coming songs")
        XCTAssertEqual(native()["nowPlaying"] as? String, "Song 1", "lock screen shows it")
        shot("playing")

        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10))
        // Song 1 and 2 are 6 s long: the app moves on to Song 3 by itself, and tells Navidrome
        waitFor(40, "Navidrome to show Song 3 playing (the app moved on in the background)") { Self.nowPlayingIds().contains(s3) }
        waitFor(20, "both plays counted") { Self.playCount(s1) > before.0 && Self.playCount(s2) > before.1 }

        app.activate()
        waitFor(15, "the app in front again") { native()["appState"] as? String == "active" }
        waitFor(15, "the page caught up with Song 3 (or the end after it)") { page()["cur"] as? String == s3 }
        let p = page()
        let hist = p["hist"] as? [String] ?? []
        XCTAssertEqual(Array(hist.suffix(2)), [s1, s2], "the page's history has the songs played in the background")
        XCTAssertEqual(p["req"] as? Int, 1, "the page loaded only the first song itself")
        shot("caught-up")
    }

    func test2LockScreenButtons() {
        launch(fresh: true)
        let ids = signIn()
        let s4 = ids["Song 4"]!, s5 = ids["Song 5"]!
        js("__t.play(3, 3)")
        waitFor(20, "Song 4 playing") { native()["key"] as? String == s4 && (native()["t"] as? Double ?? 0) > 0.5 }
        app.buttons["testNext"].tap()
        waitFor(10, "Next: Song 5, page following") { native()["key"] as? String == s5 && page()["cur"] as? String == s5 }
        app.buttons["testPrev"].tap()
        waitFor(10, "Back at the start of a song: Song 4") { native()["key"] as? String == s4 && page()["cur"] as? String == s4 }
        waitFor(10, "4 s into Song 4") { (native()["t"] as? Double ?? 0) > 4 }
        app.buttons["testPrev"].tap()
        waitFor(5, "Back later in a song: its start") { native()["key"] as? String == s4 && (native()["t"] as? Double ?? 9) < 2 }
        app.buttons["testPause"].tap()
        waitFor(5, "paused, page too") { native()["playing"] as? Bool == false && page()["playing"] as? Bool == false }
        app.buttons["testPlay"].tap()
        waitFor(5, "playing, page too") { native()["playing"] as? Bool == true && page()["playing"] as? Bool == true }
        XCTAssertEqual(page()["req"] as? Int, 1, "the page didn't load anything itself")
    }

    func test3PageAsleepCatchesUp() {
        launch(fresh: true)
        let ids = signIn()
        let s1 = ids["Song 1"]!, s2 = ids["Song 2"]!, s3 = ids["Song 3"]!
        js("__t.play(0, 3)")
        waitFor(20, "Song 1 playing") { native()["key"] as? String == s1 && (native()["t"] as? Double ?? 0) > 0.5 }
        app.buttons["testFreeze"].tap()
        waitFor(30, "the app on Song 3") { native()["key"] as? String == s3 }
        XCTAssertEqual(page()["cur"] as? String, s1, "the page heard nothing while 'asleep'")
        XCTAssertGreaterThan(native()["unconfirmed"] as? Int ?? 0, 0, "news kept for it")
        app.buttons["testThaw"].tap()
        waitFor(10, "the page caught up") { page()["cur"] as? String == s3 }
        XCTAssertEqual(Array((page()["hist"] as? [String] ?? []).suffix(2)), [s1, s2])
        waitFor(5, "news confirmed") { native()["unconfirmed"] as? Int == 0 }
    }

    func test4ReopenedAppCatchesUp() {
        launch(fresh: true)
        let ids = signIn()
        let s1 = ids["Song 1"]!, s2 = ids["Song 2"]!
        js("__t.play(0, 3)")
        waitFor(20, "Song 1 playing") { native()["key"] as? String == s1 && (native()["t"] as? Double ?? 0) > 0.5 }
        app.buttons["testFreeze"].tap()
        waitFor(20, "the app on Song 2") { native()["key"] as? String == s2 }
        app.buttons["testPause"].tap()
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10))
        sleep(2)
        app.terminate()
        launch(fresh: false)
        waitFor(30, "the page to say hello") { native()["pageReady"] as? Bool == true }
        waitFor(15, "the reopened page replayed the move to Song 2") { page()["cur"] as? String == s2 }
        waitFor(10, "and the app has Song 2 loaded, paused") { native()["key"] as? String == s2 && native()["playing"] as? Bool == false }
    }

    func test5FallbackAndSongsThatWontPlay() {
        launch(fresh: true)
        let ids = signIn()
        let wma = ids["WMA Song"]!, s2 = ids["Song 2"]!
        js("__t.playIds(['\(wma)', '\(s2)'])")
        waitFor(25, "the WMA song playing as MP3 from Navidrome") {
            let n = native()
            return n["key"] as? String == wma && n["fallback"] as? Bool == true && (n["t"] as? Double ?? 0) > 0.5
        }
        js("__t.playIds(['no-such-song', '\(s2)'])")
        waitFor(25, "a song that won't play is skipped") { native()["key"] as? String == s2 && (native()["t"] as? Double ?? 0) > 0.3 }
        waitFor(10, "the page followed") { page()["cur"] as? String == s2 }
    }

    func test6RepeatOneAndTheEnd() {
        launch(fresh: true)
        let ids = signIn()
        let s1 = ids["Song 1"]!
        js("__t.play(0, 1)")
        waitFor(20, "Song 1 playing") { native()["key"] as? String == s1 && (native()["t"] as? Double ?? 0) > 0.5 }
        js("(__encore.Player.cycleRepeat(), __encore.Player.cycleRepeat(), __encore.Player.repeat)")
        waitFor(5, "repeat one passed to the app") { native()["repeatOne"] as? Bool == true }
        waitFor(15, "it went round again") { native()["scrobbles"] as? Int ?? 0 >= 2 }
        XCTAssertEqual(native()["key"] as? String, s1)
        XCTAssertEqual(native()["playing"] as? Bool, true)
        js("(__encore.Player.cycleRepeat(), __encore.Player.repeat)")
        waitFor(5, "repeat off") { native()["repeatOne"] as? Bool == false }
        waitFor(15, "stopped at the end of the list") { native()["playing"] as? Bool == false && (native()["t"] as? Double ?? 9) < 0.5 }
        waitFor(5, "the page agrees") { page()["playing"] as? Bool == false && page()["cur"] as? String == s1 }
    }

    func test7FirstScreenAndProblems() {
        launch(fresh: true, address: "")
        XCTAssertTrue(app.otherElements["setupScreen"].waitForExistence(timeout: 10) || app.textFields["addressField"].waitForExistence(timeout: 5))
        let field = app.textFields["addressField"]
        field.tap()
        field.typeText("127.0.0.1:9")
        app.buttons["connectButton"].tap()
        XCTAssertTrue(app.staticTexts["problemTitle"].waitForExistence(timeout: 30))
        XCTAssertEqual(app.staticTexts["problemTitle"].label, "Can’t reach Encore")
        shot("unreachable")
        app.buttons["Change Address"].tap()
        let f2 = app.textFields["addressField"]
        XCTAssertTrue(f2.waitForExistence(timeout: 5))
        f2.tap()
        if let v = f2.value as? String, !v.isEmpty {
            f2.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: v.count))
        }
        f2.typeText("127.0.0.1:4533")
        app.buttons["connectButton"].tap()
        XCTAssertTrue(waitFor(25, "Navidrome's own page: 'This isn't Encore'") {
            app.staticTexts["problemTitle"].exists && app.staticTexts["problemTitle"].label == "This isn’t Encore"
        })
        shot("not-encore")
    }
}

/// A value filled in by a network callback (the closure can't change a local variable of the caller).
private final class Box<T> {
    var value: T
    init(_ value: T) { self.value = value }
}
