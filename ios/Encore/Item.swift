import Foundation

/// A song or radio station the page asked the app to play, as the page described it.
struct Item: Equatable, Codable {
    let key: String
    let url: URL
    /// An MP3 version to try when the phone can't play the original file.
    let fallback: URL?
    let title: String
    let artist: String
    let album: String
    let art: URL?
    let duration: Double
    let isRadio: Bool
    /// Where to register a play; the app adds `submission` and `time`.
    let scrobble: URL?
    /// Passed back to the page with the app's news, so it can show a song it no longer has in its lists.
    let coverArt: String?
    let artistId: String?
    let albumId: String?

    init(key: String, url: URL, fallback: URL? = nil, title: String = "", artist: String = "", album: String = "",
         art: URL? = nil, duration: Double = 0, isRadio: Bool = false, scrobble: URL? = nil,
         coverArt: String? = nil, artistId: String? = nil, albumId: String? = nil) {
        self.key = key
        self.url = url
        self.fallback = fallback
        self.title = title
        self.artist = artist
        self.album = album
        self.art = art
        self.duration = duration
        self.isRadio = isRadio
        self.scrobble = scrobble
        self.coverArt = coverArt
        self.artistId = artistId
        self.albumId = albumId
    }

    /// Reads an item from a message the page sent. Nil when it has no key or no usable address.
    init?(_ any: Any?) {
        guard let d = any as? [String: Any],
              let key = d["key"] as? String, !key.isEmpty,
              let url = Item.webURL(d["url"]) else { return nil }
        self.init(key: key,
                  url: url,
                  fallback: Item.webURL(d["fallback"]),
                  title: d["title"] as? String ?? "",
                  artist: d["artist"] as? String ?? "",
                  album: d["album"] as? String ?? "",
                  art: Item.webURL(d["art"]),
                  duration: max(0, Item.number(d["duration"]) ?? 0),
                  isRadio: (d["isRadio"] as? NSNumber)?.boolValue ?? false,
                  scrobble: Item.webURL(d["scrobble"]),
                  coverArt: d["coverArt"] as? String,
                  artistId: d["artistId"] as? String,
                  albumId: d["albumId"] as? String)
    }

    /// The song as the page describes songs (enough to show it).
    var songInfo: [String: Any] {
        [
            "id": key, "title": title, "artist": artist, "album": album, "duration": duration.isFinite ? duration : 0,
            "coverArt": coverArt ?? "", "artistId": artistId ?? "", "albumId": albumId ?? "",
            "isRadio": isRadio, "url": url.absoluteString,
        ]
    }

    static func list(_ any: Any?) -> [Item] {
        (any as? [Any] ?? []).compactMap { Item($0) }
    }

    /// Only http and https addresses with a host.
    static func webURL(_ any: Any?) -> URL? {
        guard let s = any as? String, !s.isEmpty, let u = URL(string: s),
              let scheme = u.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = u.host, !host.isEmpty else { return nil }
        return u
    }

    /// A finite number from a message (the page's numbers arrive as NSNumber).
    static func number(_ any: Any?) -> Double? {
        let v: Double?
        switch any {
        case let n as NSNumber: v = n.doubleValue
        case let s as String: v = Double(s)
        default: v = nil
        }
        guard let x = v, x.isFinite else { return nil }
        return x
    }

    /// The scrobble address with `submission` and `time` (milliseconds) added.
    func scrobbleURL(submission: Bool, at date: Date) -> URL? {
        guard let s = scrobble, var c = URLComponents(url: s, resolvingAgainstBaseURL: false) else { return nil }
        var q = (c.queryItems ?? []).filter { $0.name != "submission" && $0.name != "time" }
        q.append(URLQueryItem(name: "submission", value: submission ? "true" : "false"))
        q.append(URLQueryItem(name: "time", value: String(Int64((date.timeIntervalSince1970 * 1000).rounded()))))
        c.queryItems = q
        return c.url
    }
}
