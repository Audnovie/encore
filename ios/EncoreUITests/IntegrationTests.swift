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
    /// checked once per run: the first request from a freshly started simulator can take half a minute to go out
    private static var serversUp: Bool?
    private static var onCI: Bool { ProcessInfo.processInfo.environment["ENCORE_CI"] == "1" }

    override func setUpWithError() throws {
        continueAfterFailure = false
        if Self.serversUp == nil { Self.serversUp = Self.reachable(Self.encore + "index.html", within: Self.onCI ? 90 : 3) }
        let up = Self.serversUp == true
        if Self.onCI {
            // on CI the servers must be there: a missing server is a failure, not a skip
            XCTAssertTrue(up, "The test servers aren't running")
            if !up { throw XCTSkip("no servers") }
        } else {
            try XCTSkipUnless(up, "The test servers aren't running (CI starts them)")
        }
    }

    // MARK: - helpers

    /// Whether the address answers 200, trying again until `within` seconds have passed.
    static func reachable(_ s: String, within: TimeInterval) -> Bool {
        guard let url = URL(string: s) else { return false }
        let end = Date().addingTimeInterval(within)
        repeat {
            let done = DispatchSemaphore(value: 0)
            let ok = Box(false)
            var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
            req.timeoutInterval = 10
            URLSession.shared.dataTask(with: req) { _, r, _ in
                ok.value = (r as? HTTPURLResponse)?.statusCode == 200
                done.signal()
            }.resume()
            _ = done.wait(timeout: .now() + 11)
            if ok.value { return true }
            Thread.sleep(forTimeInterval: 1)
        } while Date() < end
        return false
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
        // the test panel numbers its answers from 1 again in each new launch
        runs = 0
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
    /// As waitFor, without failing the test.
    func waitQuietly(_ timeout: TimeInterval, _ cond: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if cond() { return true }
            usleep(250_000)
        }
        return cond()
    }

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
        // a freshly started Navidrome can stall on the first sign-in (CI run 17: its database was busy and the
        // request hung): once more if it didn't work
        if !waitQuietly(30, { page()["signedIn"] as? Bool == true }) {
            shot("sign-in-again")
            js("__t.signIn('\(Self.user)', '\(Self.password)')")
            waitFor(30, "signed in") { page()["signedIn"] as? Bool == true }
        }
        var ids: [String: String] = [:]
        for pair in js("__t.ids()").split(separator: "|") {
            let p = pair.split(separator: "=", maxSplits: 1)
            if p.count == 2 { ids[String(p[0])] = String(p[1]) }
        }
        XCTAssertEqual(ids.count, 8, "test library: \(ids)")
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
        // Back straight after Next: within 3 s of a song's start, Back goes to the song before (as in the
        // Music app), and the song it came back from is next again. That ends where it started, so the two
        // moves are counted in the app's news for the page.
        let seq0 = native()["lastSeq"] as? Int ?? 0
        app.buttons["testNext"].tap()
        app.buttons["testPrev"].tap()
        waitFor(10, "Next then Back: two moves, ending on Song 4 with Song 5 next") {
            let n = native()
            return (n["lastSeq"] as? Int ?? 0) >= seq0 + 2 && n["key"] as? String == s4 && (n["aheadKeys"] as? [String])?.first == s5
        }
        waitFor(10, "the page following the lock screen") { page()["cur"] as? String == s4 }
        app.buttons["testNext"].tap()
        waitFor(10, "Next: Song 5, page following") { native()["key"] as? String == s5 && page()["cur"] as? String == s5 }
        app.buttons["testPrev"].tap()
        waitFor(10, "Back: Song 4 or the start of Song 5 (it depends on how long the check above took)") {
            let n = native()
            return n["key"] as? String == s4 || (n["key"] as? String == s5 && (n["t"] as? Double ?? 9) < 2)
        }
        if native()["key"] as? String == s5 { app.buttons["testPrev"].tap() }
        waitFor(10, "Song 4, page following") { native()["key"] as? String == s4 && page()["cur"] as? String == s4 }
        waitFor(10, "4 s into Song 4") { (native()["t"] as? Double ?? 0) > 4 }
        app.buttons["testPrev"].tap()
        waitFor(5, "Back later in a song: its start") { native()["key"] as? String == s4 && (native()["t"] as? Double ?? 9) < 2 }
        app.buttons["testPause"].tap()
        waitFor(10, "paused, page too") { native()["playing"] as? Bool == false && page()["playing"] as? Bool == false }
        app.buttons["testPlay"].tap()
        waitFor(10, "playing, page too") { native()["playing"] as? Bool == true && page()["playing"] as? Bool == true }
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
        let wma = ids["WMA Song"]!, wma2 = ids["WMA Song 2"]!, s1 = ids["Song 1"]!, s2 = ids["Song 2"]!
        // first in the list: played as Navidrome's MP3 version once the server has made it
        js("__t.playIds(['\(wma)', '\(s2)'])")
        waitFor(25, "the WMA song playing as MP3 from Navidrome") {
            let n = native()
            return n["key"] as? String == wma && n["fallback"] as? Bool == true && (n["t"] as? Double ?? 0) > 0.5
        }
        // ...to its end (6 s), then on to Song 2 by itself, with nothing reported: the app waited for Navidrome to
        // finish making the MP3, so AVPlayer had its exact length
        waitFor(25, "the WMA song played to its end, then Song 2") {
            let n = native()
            return n["key"] as? String == s2 && (n["t"] as? Double ?? 0) > 0.3
        }
        XCTAssertEqual(native()["lastError"] as? String, "", "no error reported for the WMA song")
        XCTAssertEqual(native()["stallEnds"] as? Int, 0, "it really ended: AVPlayer had the finished MP3, exact length")
        // next in the list: its MP3 version is made and lined up while Song 1 plays, then straight on (not
        // switched over once it's playing: the count of those stays as it is)
        let switches = native()["mp3Switches"] as? Int ?? -1
        XCTAssertEqual(switches, 1, "the first WMA song was switched to MP3 as it started")
        js("__t.playIds(['\(s1)', '\(wma2)', '\(s2)'])")
        waitFor(30, "Song 1, then WMA Song 2 as MP3") {
            let n = native()
            return n["key"] as? String == wma2 && n["fallback"] as? Bool == true && (n["t"] as? Double ?? 0) > 0.3
        }
        waitFor(25, "WMA Song 2 played to its end, then Song 2") {
            let n = native()
            return n["key"] as? String == s2 && (n["t"] as? Double ?? 0) > 0.3
        }
        XCTAssertEqual(native()["lastError"] as? String, "")
        XCTAssertEqual(native()["stallEnds"] as? Int, 0)
        XCTAssertEqual(native()["mp3Switches"] as? Int, switches, "WMA Song 2 was lined up as MP3, not switched while playing")
        // Song 2 is already playing, so the skip is told apart by the error reported for the missing song
        js("__t.playIds(['no-such-song', '\(s2)'])")
        waitFor(25, "a song that won't play is reported and skipped") {
            let n = native()
            return n["lastError"] as? String == "unplayable" && n["key"] as? String == s2 && (n["t"] as? Double ?? 0) > 0.3
        }
        waitFor(10, "the page followed") { page()["cur"] as? String == s2 }
    }

    func test6RepeatOneAndTheEnd() {
        launch(fresh: true)
        let ids = signIn()
        let s1 = ids["Song 1"]!
        // Repeat One first (off, all, one), then the 6-second Song 1 on its own: typing in the test panel is
        // slow enough that the song could end before a later change of repeat reached the app
        XCTAssertEqual(js("(__encore.Player.cycleRepeat(), __encore.Player.cycleRepeat(), __encore.Player.repeat)"), "one")
        js("__t.play(0, 1)")
        waitFor(20, "Song 1 playing") { native()["key"] as? String == s1 && (native()["t"] as? Double ?? 0) > 0.5 }
        waitFor(5, "repeat one passed to the app") { native()["repeatOne"] as? Bool == true }
        waitFor(25, "it went round again") { native()["scrobbles"] as? Int ?? 0 >= 2 }
        XCTAssertEqual(native()["key"] as? String, s1)
        XCTAssertEqual(native()["playing"] as? Bool, true)
        js("(__encore.Player.cycleRepeat(), __encore.Player.repeat)")
        waitFor(5, "repeat off") { native()["repeatOne"] as? Bool == false }
        waitFor(15, "stopped at the end of the list") { native()["playing"] as? Bool == false && (native()["t"] as? Double ?? 9) < 0.5 }
        waitFor(10, "the page agrees") { page()["playing"] as? Bool == false && page()["cur"] as? String == s1 }
    }

    func test7FirstScreenAndProblems() {
        launch(fresh: true, address: "")
        XCTAssertTrue(app.otherElements["setupScreen"].waitForExistence(timeout: 10) || app.textFields["addressField"].waitForExistence(timeout: 5))
        let field = app.textFields["addressField"]
        field.tap()
        // nothing listens on 4590 (not port 9: WebKit refuses to load "bad ports" and shows an empty page)
        XCTAssertFalse(Self.reachable("http://127.0.0.1:4590/", within: 0), "something answers on port 4590")
        field.typeText("127.0.0.1:4590")
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

    func test8LowerQuality() {
        launch(fresh: true)
        let ids = signIn()
        let s1 = ids["Song 1"]!, s3 = ids["Song 3"]!
        // "Low" (128 kbps): every song is one of Navidrome's MP3 versions. The next one is made on the server
        // while one plays, so it plays to its real end; only the first can wait at its end (then counts as ended).
        XCTAssertEqual(js("(__encore.Settings.set('quality', '128'), __encore.Settings.get('quality'))"), "128")
        js("__t.play(0, 3)")
        waitFor(25, "Song 1 playing, converted by Navidrome") {
            native()["key"] as? String == s1 && (native()["t"] as? Double ?? 0) > 0.5
        }
        waitFor(45, "on to Song 3 by itself") {
            native()["key"] as? String == s3 && (native()["t"] as? Double ?? 0) > 0.3
        }
        let n = native()
        XCTAssertEqual(n["lastError"] as? String, "", "nothing reported")
        XCTAssertLessThanOrEqual((n["stallEnds"] as? Int ?? 9) + (n["retries"] as? Int ?? 9), 1,
                                 "only the first song (not made in advance) could have waited at its end or broken off")
    }

    /// iOS only shows the app in Control Center (Now Playing) while its audio session is the music kind that
    /// doesn't mix with others: it has to stay that way through the page loading, playing, a reload of the page
    /// and the app going to the background and back.
    func test9AudioSessionStaysMusic() {
        launch(fresh: true)
        let ids = signIn()
        let s4 = ids["Song 4"]!
        func checkSession(_ when: String) {
            let n = native()
            XCTAssertEqual(n["category"] as? String, "AVAudioSessionCategoryPlayback", "category \(when)")
            XCTAssertEqual(n["mixes"] as? Bool, false, "mixes with others \(when)")
            print("ENCORE-DIAG \(when): category=\(n["category"] ?? "?") mixes=\(n["mixes"] ?? "?") restores=\(n["sessionRestores"] ?? "?") repairs=\(n["nowPlayingRepairs"] ?? "?")")
        }
        checkSession("after sign-in")
        js("__t.play(3, 3)")
        waitFor(20, "Song 4 playing") { native()["key"] as? String == s4 && (native()["t"] as? Double ?? 0) > 0.5 }
        checkSession("while playing")
        XCTAssertEqual(native()["nowPlaying"] as? String, "Song 4")
        // the page reloads (as after iOS ends the web view's process in the background); the 20-second songs
        // may move on meanwhile
        js("(setTimeout(() => location.reload(), 300), 'reloading')")
        sleep(2)
        waitFor(30, "the reloaded page says hello and follows") {
            native()["pageReady"] as? Bool == true && page()["cur"] as? String == native()["key"] as? String
        }
        XCTAssertEqual(native()["playing"] as? Bool, true, "the music played on through the reload")
        checkSession("after the page reloaded")
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10))
        sleep(3)
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        waitFor(10, "back in front") { native()["appState"] as? String == "active" }
        checkSession("after the background")
        let n = native()
        XCTAssertEqual(n["nowPlaying"] as? String, n["title"] as? String, "Now Playing shows the song that's playing")
        XCTAssertNotEqual(n["title"] as? String ?? "", "")
        // Going to the background and back while playing doesn't start the session again (only after it had to be
        // set back). A song starting meanwhile can (the 20-second songs may move on).
        let starts = n["activations"] as? Int ?? -1
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10))
        app.activate()
        waitFor(10, "back in front again") { native()["appState"] as? String == "active" }
        let after = native()
        let moved = after["key"] as? String != n["key"] as? String
        XCTAssertLessThanOrEqual((after["activations"] as? Int ?? 99) - starts, moved ? 1 : 0,
                                 "no session start for going to the background and back (moved on: \(moved))")

        // Copy Diagnostics (the same as from the Home Screen icon's menu): what happened, and no addresses
        app.buttons["testDiag"].tap()
        let alert = app.alerts["Diagnostics copied"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "the app says it copied them")
        alert.buttons["OK"].tap()
        let text = app.staticTexts["testCopied"].label
        print("ENCORE-DIAG copied (test 9):\n" + text)
        for want in ["Encore diagnostics, copied", "launch: Encore", "page: loaded", "song: \"Song 4\"", "player: playing",
                     "app: in the background", "app: in front", "session: started", "Audio session: Playback",
                     "Encore's Now Playing info \"Song ", "(set at ", "Lock screen buttons: play on"] {
            XCTAssertTrue(text.contains(want), "the diagnostics have: \(want)")
        }
        XCTAssertFalse(text.contains("built from ?"), "the commit it was built from")
        for never in ["://", "127.0.0.1", Self.password, "u=\(Self.user)"] {
            XCTAssertFalse(text.contains(never), "the diagnostics hold no \(never)")
        }
        XCTAssertNil(text.range(of: #"[?&][a-z]+="#, options: .regularExpression), "nothing like an address's query (sign-in token)")
        let launchLine = text.split(separator: "\n").first { $0.contains(" launch: Encore") } ?? ""
        XCTAssertFalse(launchLine.contains("background"), "a launch isn't noted as the app in the background: \(launchLine)")
    }

    /// Copy Diagnostics from the Home Screen: touch and hold Encore's icon, then the item in its menu. Once with
    /// the app running (playing, in the background), once with it closed.
    func testZCopyDiagnosticsFromTheHomeScreen() {
        launch(fresh: true)
        let ids = signIn()
        let s4 = ids["Song 4"]!
        js("__t.play(3, 3)")
        waitFor(20, "Song 4 playing") { native()["key"] as? String == s4 && (native()["t"] as? Double ?? 0) > 0.5 }
        let copies = native()["copies"] as? Int ?? -1
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10))
        useIconMenu("running")
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15), "Encore came to the front")
        let alert = app.alerts["Diagnostics copied"].firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 15), "the app says it copied them")
        shot("copied-running")
        // (one OK per copy: a tap that seemed ignored may still have arrived late)
        for _ in 1...3 where alert.exists { alert.buttons["OK"].tap(); sleep(1) }
        waitFor(10, "copied") { (native()["copies"] as? Int ?? 0) >= copies + 1 }
        let text = app.staticTexts["testCopied"].label
        XCTAssertTrue(text.hasPrefix("Encore diagnostics, copied"))
        XCTAssertTrue(text.contains("Home Screen menu: Copy Diagnostics"), "the record says where it came from")
        XCTAssertTrue(text.contains("app: in the background"))
        XCTAssertFalse(text.contains("://"))

        // with the app closed: iOS opens it, and it copies them once its screen is there
        app.terminate()
        XCTAssertTrue(app.wait(for: .notRunning, timeout: 10))
        useIconMenu("closed")
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20), "Encore opened")
        let again = app.alerts["Diagnostics copied"].firstMatch
        XCTAssertTrue(again.waitForExistence(timeout: 20), "the app says it copied them")
        shot("copied-closed")
        for _ in 1...3 where again.exists { again.buttons["OK"].tap(); sleep(1) }
    }

    /// From the Home Screen: touch and hold Encore's icon (looking through the Home Screen's pages for it), then
    /// Copy Diagnostics in its menu.
    /// Returns once Encore is in front. The simulator's Home Screen sometimes ignores the tap on the menu item
    /// (seen once on CI: the menu stayed open), so it tries up to 3 times.
    private func useIconMenu(_ when: String) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for attempt in 1...3 {
            // (pressed again on the Home Screen, Home goes back towards its first page, and the search below
            // swipes on from there; it also closes a menu left open)
            XCUIDevice.shared.press(.home)
            sleep(1)
            XCUIDevice.shared.press(.home)
            let icon = springboard.icons["Encore"].firstMatch
            _ = icon.waitForExistence(timeout: 10)
            var swipes = 0
            while !(icon.exists && icon.isHittable) && swipes < 5 {
                springboard.swipeLeft()
                sleep(1)
                swipes += 1
            }
            shot("home-screen-\(when)-\(attempt)")
            guard icon.exists && icon.isHittable else {
                XCTFail("Encore's icon on the Home Screen (after \(swipes) swipes)")
                return
            }
            icon.press(forDuration: 1.2)
            let item = springboard.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Copy Diagnostics")).firstMatch
            guard item.waitForExistence(timeout: 10) else {
                print("ENCORE-DIAG no Copy Diagnostics in the icon's menu (try \(attempt))")
                continue
            }
            shot("icon-menu-\(when)-\(attempt)")
            item.tap()
            if app.wait(for: .runningForeground, timeout: 20) { return }
            print("ENCORE-DIAG the menu's tap didn't open Encore (try \(attempt))")
        }
        XCTFail("Copy Diagnostics in the icon's menu didn't open Encore in 3 tries")
    }
}

/// A value filled in by a network callback (the closure can't change a local variable of the caller).
private final class Box<T> {
    var value: T
    init(_ value: T) { self.value = value }
}