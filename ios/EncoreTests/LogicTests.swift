import XCTest
@testable import Encore

private func item(_ key: String, duration: Double = 100) -> Item {
    Item(key: key, url: URL(string: "http://music.test/rest/stream?id=\(key)")!, title: "Song \(key)", duration: duration)
}

final class QueueStateTests: XCTestCase {
    func testLoadTakesTheSongAndForgetsTheOldComingSongs() {
        var q = QueueState()
        XCTAssertTrue(q.load(item("a"), req: 1, restore: false))
        XCTAssertTrue(q.upcoming(key: "a", req: 1, items: [item("b"), item("c")], back: [], repeatOne: false))
        XCTAssertTrue(q.load(item("x"), req: 2, restore: false))
        XCTAssertEqual(q.current?.key, "x")
        XCTAssertEqual(q.ahead.count, 0)
        XCTAssertEqual(q.lastReq, 2)
    }

    func testRestoreIsOnlyTakenWhenNothingIsPlaying() {
        var q = QueueState()
        XCTAssertTrue(q.load(item("a"), req: 1, restore: true), "nothing loaded yet: take the restored song")
        XCTAssertFalse(q.load(item("old"), req: 1, restore: true), "a reloaded page's restore doesn't replace the playing song")
        XCTAssertEqual(q.current?.key, "a")
        XCTAssertEqual(q.lastReq, 1, "the request number is still noted")
    }

    func testRequestNumbersCanStartOverAfterThePageReloads() {
        var q = QueueState()
        _ = q.load(item("a"), req: 40, restore: false)
        _ = q.load(item("b"), req: 1, restore: false)
        XCTAssertEqual(q.lastReq, 1)
    }

    func testComingSongsOnlyForTheSongTheAppIsOn() {
        var q = QueueState()
        _ = q.load(item("a"), req: 3, restore: false)
        XCTAssertFalse(q.upcoming(key: "b", req: 3, items: [item("z")], back: [], repeatOne: false), "for another song")
        XCTAssertFalse(q.upcoming(key: "a", req: 2, items: [item("z")], back: [], repeatOne: false), "for an older request")
        XCTAssertTrue(q.ahead.isEmpty)
        XCTAssertTrue(q.upcoming(key: "a", req: 3, items: [item("b")], back: [item("p")], repeatOne: true))
        XCTAssertEqual(q.ahead.map(\.key), ["b"])
        XCTAssertEqual(q.back.map(\.key), ["p"])
        XCTAssertTrue(q.repeatOne)
    }

    func testMovingOnAndBack() {
        var q = QueueState()
        _ = q.load(item("b"), req: 1, restore: false)
        _ = q.upcoming(key: "b", req: 1, items: [item("c"), item("d")], back: [item("a")], repeatOne: false)
        XCTAssertEqual(q.move(.ended)?.key, "c")
        XCTAssertEqual(q.back.map(\.key), ["a", "b"])
        XCTAssertEqual(q.ahead.map(\.key), ["d"])
        XCTAssertEqual(q.move(.prev)?.key, "b")
        XCTAssertEqual(q.ahead.map(\.key), ["c", "d"], "the song you came back from is next again")
        XCTAssertEqual(q.move(.prev)?.key, "a")
        XCTAssertNil(q.move(.prev), "nothing further back")
        XCTAssertEqual(q.current?.key, "a")
        XCTAssertEqual(q.move(.next)?.key, "b")
        XCTAssertEqual(q.move(.skip)?.key, "c")
        XCTAssertEqual(q.move(.ended)?.key, "d")
        XCTAssertNil(q.move(.ended), "the end of the list")
        XCTAssertEqual(q.current?.key, "d")
    }

    func testBackListIsLimited() {
        var q = QueueState()
        _ = q.load(item("0"), req: 1, restore: false)
        _ = q.upcoming(key: "0", req: 1, items: (1...80).map { item("\($0)") }, back: [], repeatOne: false)
        for _ in 1...80 { _ = q.move(.ended) }
        XCTAssertEqual(q.back.count, QueueState.backLimit)
        XCTAssertEqual(q.back.last?.key, "79")
    }

    func testBackNeverGoesToAStation() {
        var q = QueueState()
        let radio = Item(key: "radio:1", url: URL(string: "http://radio.test/live")!, isRadio: true)
        _ = q.load(radio, req: 1, restore: false)
        _ = q.upcoming(key: "radio:1", req: 1, items: [item("a")], back: [item("p")], repeatOne: false)
        XCTAssertEqual(q.move(.next)?.key, "a")
        XCTAssertEqual(q.back.map(\.key), ["p"], "like the page's history")
        XCTAssertEqual(q.move(.prev)?.key, "p")
    }

    func testARequestTheAppCouldntTakeStillCounts() {
        var q = QueueState()
        _ = q.load(item("a"), req: 1, restore: false)
        q.note(req: 2)
        XCTAssertEqual(q.lastReq, 2)
        XCTAssertFalse(q.upcoming(key: "a", req: 1, items: [item("b")], back: [], repeatOne: false), "older than the page's latest")
    }

    func testStopKeepsTheRequestNumber() {
        var q = QueueState()
        _ = q.load(item("a"), req: 7, restore: false)
        q.stop()
        XCTAssertNil(q.current)
        XCTAssertEqual(q.lastReq, 7)
        XCTAssertTrue(q.load(item("b"), req: 8, restore: true), "after Sign Out the restore is taken again")
    }
}

final class EventLogTests: XCTestCase {
    func testNumbersAndConfirming() {
        var log = EventLog()
        XCTAssertEqual(log.add(["type": "advance", "from": "a", "to": "b"]), 1)
        XCTAssertEqual(log.add(["type": "scrobbled", "key": "a"]), 2)
        XCTAssertEqual(log.add(["type": "advance", "from": "b", "to": NSNull()]), 3)
        XCTAssertEqual(log.messages.map { $0["seq"] as? Int }, [1, 2, 3])
        XCTAssertTrue(log.messages[2]["to"] is NSNull)
        log.ack(2)
        XCTAssertEqual(log.messages.map { $0["seq"] as? Int }, [3])
        log.ack(99)
        XCTAssertTrue(log.events.isEmpty)
        XCTAssertEqual(log.add(["type": "x"]), 4, "numbers keep going up")
    }

    func testMessagesThatArentJSONAreDropped() {
        var log = EventLog()
        XCTAssertEqual(log.add(["type": "time", "t": Double.nan]), 0)
        XCTAssertTrue(log.events.isEmpty)
        XCTAssertEqual(log.add(["type": "ok"]), 1)
    }

    func testOldestDroppedWhenFull() {
        var log = EventLog()
        for i in 0..<(EventLog.capacity + 10) { log.add(["type": "n", "i": i]) }
        XCTAssertEqual(log.events.count, EventLog.capacity)
        XCTAssertEqual(log.events.first?.seq, 11)
    }

    func testListeningBecomesOneMessage() {
        var log = EventLog()
        log.addListening(10.25, day: "2026-11-18")
        log.addListening(4.5, day: "2026-11-18")
        log.addListening(2, day: "2026-11-19")
        log.addListening(-1, day: "2026-11-19")
        log.addListening(.infinity, day: "2026-11-19")
        XCTAssertEqual(log.pendingListening, 16.75, accuracy: 0.0001)
        log.flushListening()
        XCTAssertEqual(log.pendingListening, 0)
        let m = log.messages.last
        XCTAssertEqual(m?["type"] as? String, "listened")
        let days = m?["days"] as? [String: Double]
        XCTAssertEqual(days?["2026-11-18"] ?? 0, 14.75, accuracy: 0.0001)
        XCTAssertEqual(days?["2026-11-19"] ?? 0, 2, accuracy: 0.0001)
        log.flushListening()
        XCTAssertEqual(log.events.count, 1, "nothing new: no message")
    }

    func testDayKeyUsesThePhonesTimeZone() {
        let d = Date(timeIntervalSince1970: 1_794_970_000) // 2026-11-18 02:46:40 UTC
        XCTAssertEqual(EventLog.dayKey(d, timeZone: TimeZone(identifier: "UTC")!), "2026-11-18")
        XCTAssertEqual(EventLog.dayKey(d, timeZone: TimeZone(identifier: "Pacific/Honolulu")!), "2026-11-17")
        XCTAssertEqual(EventLog.dayKey(d, timeZone: TimeZone(identifier: "Asia/Tokyo")!), "2026-11-18")
    }

    func testSavedAndLoaded() {
        let suite = "encore.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        var log = EventLog()
        log.add(["type": "advance", "from": "a", "to": "b", "reason": "ended", "req": 3])
        log.addListening(12, day: "2026-11-18")
        log.save(to: defaults, key: "k")
        var back = EventLog.load(from: defaults, key: "k")
        XCTAssertEqual(back, log)
        XCTAssertEqual(back.add(["type": "x"]), 2, "numbering carries on after a relaunch")
        XCTAssertEqual(EventLog.load(from: defaults, key: "missing"), EventLog())
        defaults.set(Data("not json".utf8), forKey: "bad")
        XCTAssertEqual(EventLog.load(from: defaults, key: "bad"), EventLog(), "a damaged copy starts afresh")
    }
}

final class ItemTests: XCTestCase {
    func testReadsTheHelloFromThePage() {
        let d: [String: Any] = [
            "key": "s1", "url": "http://10.0.0.5:4534/rest/stream?u=t&id=s1",
            "fallback": "http://10.0.0.5:4534/rest/stream?u=t&id=s1&format=mp3&maxBitRate=320",
            "title": "Night Swim", "artist": "Velvet Comet", "album": "Duets",
            "art": "http://10.0.0.5:4534/rest/getCoverArt?id=al-1&size=600",
            "duration": NSNumber(value: 98), "isRadio": NSNumber(value: false),
            "scrobble": "http://10.0.0.5:4534/rest/scrobble?u=t&id=s1",
        ]
        let it = Item(d)
        XCTAssertEqual(it?.key, "s1")
        XCTAssertEqual(it?.duration, 98)
        XCTAssertEqual(it?.isRadio, false)
        XCTAssertEqual(it?.fallback?.query?.contains("format=mp3"), true)
        XCTAssertEqual(it?.art?.host, "10.0.0.5")
    }

    func testRejectsWhatItCantPlay() {
        XCTAssertNil(Item(["url": "http://x.test/a"]), "no key")
        XCTAssertNil(Item(["key": "a"]), "no address")
        XCTAssertNil(Item(["key": "a", "url": "file:///etc/hosts"]))
        XCTAssertNil(Item(["key": "a", "url": "javascript:alert(1)"]))
        XCTAssertNil(Item("not a dictionary"))
        let it = Item(["key": "a", "url": "https://x.test/a", "fallback": "", "art": "ftp://x.test/a.jpg", "duration": "abc"])
        XCTAssertNotNil(it)
        XCTAssertNil(it?.fallback)
        XCTAssertNil(it?.art)
        XCTAssertEqual(it?.duration, 0)
        XCTAssertEqual(Item.list([["key": "a", "url": "http://x.test/a"], ["key": ""], 5] as [Any]).count, 1)
    }

    func testDetailsPassedBackToThePage() {
        let it = Item(["key": "s1", "url": "http://h.test/rest/stream?id=s1", "title": "T", "artist": "A", "album": "L",
                       "duration": NSNumber(value: 120), "coverArt": "al-9", "artistId": "ar-2", "albumId": "al-9"] as [String: Any])!
        let info = it.songInfo
        XCTAssertEqual(info["id"] as? String, "s1")
        XCTAssertEqual(info["coverArt"] as? String, "al-9")
        XCTAssertEqual(info["artistId"] as? String, "ar-2")
        XCTAssertEqual(info["duration"] as? Double, 120)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(info))
        let bare = Item(key: "x", url: URL(string: "http://h.test/x")!)
        XCTAssertEqual(bare.songInfo["coverArt"] as? String, "", "missing details are empty, not missing")
    }

    func testOldSavedItemsStillLoad() throws {
        // saved before coverArt/artistId/albumId existed
        let json = #"{"key":"a","url":"http://h.test/a","title":"","artist":"","album":"","duration":5,"isRadio":false}"#
        let it = try JSONDecoder().decode(Item.self, from: Data(json.utf8))
        XCTAssertEqual(it.key, "a")
        XCTAssertNil(it.coverArt)
    }

    func testRadio() {
        let it = Item(["key": "radio:1", "url": "http://radio.test/live", "isRadio": true] as [String: Any])
        XCTAssertEqual(it?.isRadio, true)
    }

    func testScrobbleAddress() {
        let it = Item(key: "s1", url: URL(string: "http://h.test/rest/stream?id=s1")!,
                      scrobble: URL(string: "http://h.test/rest/scrobble?u=t&t=abc&s=salt&v=1.16.1&c=Encore&f=json&id=s1")!)
        let date = Date(timeIntervalSince1970: 1_795_000_000.25)
        let u = it.scrobbleURL(submission: true, at: date)
        let q = URLComponents(url: u!, resolvingAgainstBaseURL: false)!.queryItems!
        XCTAssertEqual(q.first { $0.name == "submission" }?.value, "true")
        XCTAssertEqual(q.first { $0.name == "time" }?.value, "1795000000250")
        XCTAssertEqual(q.first { $0.name == "id" }?.value, "s1")
        XCTAssertEqual(q.first { $0.name == "t" }?.value, "abc")
        XCTAssertEqual(q.filter { $0.name == "submission" }.count, 1)
        let now = it.scrobbleURL(submission: false, at: date)!
        XCTAssertTrue(now.absoluteString.contains("submission=false"))
        XCTAssertNil(Item(key: "x", url: URL(string: "http://h.test/x")!).scrobbleURL(submission: true, at: date))
    }
}

final class AddressTests: XCTestCase {
    func testAddressesAsTyped() {
        XCTAssertEqual(Address.normalize("192.168.1.20:4534")?.absoluteString, "http://192.168.1.20:4534/")
        XCTAssertEqual(Address.normalize("  http://100.64.1.2:4534  ")?.absoluteString, "http://100.64.1.2:4534/")
        XCTAssertEqual(Address.normalize("HTTP://Music.Example.com:4534/")?.absoluteString, "http://Music.Example.com:4534/")
        XCTAssertEqual(Address.normalize("https://encore.example.com/app/")?.absoluteString, "https://encore.example.com/app/")
        XCTAssertEqual(Address.normalize("http://192.168.1.20:4534/?x=1#y")?.absoluteString, "http://192.168.1.20:4534/")
    }

    func testNotAddresses() {
        XCTAssertNil(Address.normalize(""))
        XCTAssertNil(Address.normalize("   "))
        XCTAssertNil(Address.normalize("my server"))
        XCTAssertNil(Address.normalize("ftp://192.168.1.20"))
        XCTAssertNil(Address.normalize("http://"))
        XCTAssertNil(Address.normalize("http://192.168.1.20:4533/rest"), "Navidrome's API, not Encore")
    }

    func testSameSite() {
        let home = URL(string: "http://192.168.1.20:4534/")!
        XCTAssertTrue(Address.sameSite(URL(string: "http://192.168.1.20:4534/index.html")!, home))
        XCTAssertFalse(Address.sameSite(URL(string: "http://192.168.1.20:4533/")!, home))
        XCTAssertFalse(Address.sameSite(URL(string: "https://192.168.1.20:4534/")!, home))
        XCTAssertTrue(Address.sameSite(URL(string: "http://example.com/a")!, URL(string: "http://EXAMPLE.com:80/")!))
    }
}
