import Foundation

/// News for the page that mustn't be lost while it sleeps: the app moved on to another song, a play was
/// registered with the server, listening time. Each message gets a number (seq) and is kept, and saved,
/// until the page confirms it has it. Whenever any are sent, all the unconfirmed ones go, oldest first, so
/// the page sees them in order (it skips numbers it already has).
struct EventLog: Codable, Equatable {
    struct Event: Codable, Equatable {
        let seq: Int
        /// the message as JSON
        let body: Data
    }

    static let capacity = 2000

    private(set) var nextSeq = 1
    private(set) var events: [Event] = []
    /// Listening seconds per day (YYYY-MM-DD, the phone's own calendar) not yet turned into a message.
    private(set) var listening: [String: Double] = [:]

    /// Adds a message and returns its number. Messages that can't be written as JSON are dropped (returns 0).
    @discardableResult
    mutating func add(_ message: [String: Any]) -> Int {
        var m = message
        let seq = nextSeq
        m["seq"] = seq
        guard JSONSerialization.isValidJSONObject(m), let data = try? JSONSerialization.data(withJSONObject: m) else { return 0 }
        nextSeq += 1
        events.append(Event(seq: seq, body: data))
        if events.count > EventLog.capacity { events.removeFirst(events.count - EventLog.capacity) }
        return seq
    }

    /// The page has everything up to `seq`.
    mutating func ack(_ seq: Int) {
        events.removeAll { $0.seq <= seq }
    }

    var messages: [[String: Any]] {
        events.compactMap { (try? JSONSerialization.jsonObject(with: $0.body)) as? [String: Any] }
    }

    mutating func addListening(_ seconds: Double, day: String) {
        guard seconds > 0, seconds.isFinite else { return }
        listening[day, default: 0] += seconds
    }

    var pendingListening: Double { listening.values.reduce(0, +) }

    /// Turns the counted listening time into a message.
    mutating func flushListening() {
        guard !listening.isEmpty else { return }
        let days = listening.mapValues { ($0 * 1000).rounded() / 1000 }
        listening = [:]
        add(["type": "listened", "days": days])
    }

    /// The day as the page writes it: YYYY-MM-DD in the phone's time zone.
    static func dayKey(_ date: Date, timeZone: TimeZone = .current) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let c = cal.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    // MARK: saving

    static func load(from defaults: UserDefaults, key: String) -> EventLog {
        guard let data = defaults.data(forKey: key), let log = try? JSONDecoder().decode(EventLog.self, from: data) else { return EventLog() }
        return log
    }

    func save(to defaults: UserDefaults, key: String) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: key) }
    }
}
