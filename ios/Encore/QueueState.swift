import Foundation

/// What's playing, what comes next and where Back goes: the part of the player that works without audio,
/// so it can be tested on its own.
///
/// The page decides the order. It sends the coming songs (`ahead`) and the songs before (`back`) each time
/// they change, and the app moves through them by itself while the page sleeps (the phone is locked).
struct QueueState {
    enum Move: String {
        case ended   // the song finished
        case next    // Next on the lock screen
        case prev    // Back on the lock screen
        case skip    // the song couldn't be played
    }

    static let backLimit = 50

    private(set) var current: Item?
    private(set) var ahead: [Item] = []
    private(set) var back: [Item] = []
    private(set) var repeatOne = false
    /// The page numbers the songs it asks for. The app stamps its messages with the newest number it has
    /// seen, so the page can tell news about an older request from news about its latest one.
    private(set) var lastReq = 0

    /// The page asks for a song. `restore` means it's only the song the page was on when it last closed:
    /// when the app is already playing something, it keeps playing that (and the page catches up).
    /// Returns whether the song was taken.
    mutating func load(_ item: Item, req: Int, restore: Bool) -> Bool {
        lastReq = req
        if restore && current != nil { return false }
        current = item
        ahead = []
        return true
    }

    /// The page's coming songs. Only taken when they're for the song the app is on and the page's latest
    /// request (otherwise the app moved on in the meantime, and the page sends a new list once it hears).
    mutating func upcoming(key: String, req: Int, items: [Item], back: [Item], repeatOne: Bool) -> Bool {
        guard let cur = current, cur.key == key, req == lastReq else { return false }
        ahead = items
        self.back = Array(back.suffix(QueueState.backLimit))
        self.repeatOne = repeatOne
        return true
    }

    /// Moves on (or back). Returns the song moved to, or nil when there's nothing there.
    mutating func move(_ m: Move) -> Item? {
        guard let cur = current else { return nil }
        if m == .prev {
            guard let p = back.popLast() else { return nil }
            // the song you came back from plays next again, as it does on the page
            ahead.insert(cur, at: 0)
            current = p
            return p
        }
        guard !ahead.isEmpty else { return nil }
        let n = ahead.removeFirst()
        // like the page's history, Back never goes to a radio station
        if !cur.isRadio { back.append(cur) }
        if back.count > QueueState.backLimit { back.removeFirst(back.count - QueueState.backLimit) }
        current = n
        return n
    }

    /// Back to where the player was when the app was closed, so the lock screen works before the page has
    /// loaded. The request number isn't kept: the page's numbers start again when it loads.
    mutating func resume(current: Item, ahead: [Item], back: [Item], repeatOne: Bool) {
        self.current = current
        self.ahead = ahead
        self.back = Array(back.suffix(QueueState.backLimit))
        self.repeatOne = repeatOne
    }

    /// A request the app couldn't take (it still counts as the page's latest).
    mutating func note(req: Int) {
        lastReq = req
    }

    mutating func stop() {
        current = nil
        ahead = []
        back = []
        repeatOne = false
    }
}
