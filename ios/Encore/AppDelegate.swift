import AVFoundation
import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        PlayerEngine.configureAudioSession()
        application.beginReceivingRemoteControlEvents()
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: windowScene)
        w.rootViewController = RootViewController()
        w.makeKeyAndVisible()
        window = w
    }
}

/// Where Encore is (the address you'd open in Safari), remembered between launches.
enum Address {
    static let key = "address"

    static var saved: URL? {
        get { UserDefaults.standard.string(forKey: key).flatMap(normalize) }
        set { UserDefaults.standard.set(newValue?.absoluteString, forKey: key) }
    }

    /// "10.0.0.5:4534" -> http://10.0.0.5:4534/. Nil when it isn't a web address.
    static func normalize(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty, !s.contains(" ") else { return nil }
        let lower = s.lowercased()
        if lower.contains("://") {
            guard lower.hasPrefix("http://") || lower.hasPrefix("https://") else { return nil }
        } else {
            s = "http://" + s
        }
        guard var c = URLComponents(string: s), let host = c.host, !host.isEmpty,
              let scheme = c.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
        c.scheme = scheme
        if c.path.isEmpty { c.path = "/" }
        // the address of Encore's page, not of a file or the music server's API
        if c.path.lowercased().hasSuffix("/rest") || c.path.lowercased().hasSuffix("/rest/") { return nil }
        c.query = nil
        c.fragment = nil
        return c.url
    }

    /// Same scheme, host and port: a page of Encore itself.
    static func sameSite(_ a: URL, _ b: URL) -> Bool {
        a.scheme?.lowercased() == b.scheme?.lowercased() && a.host?.lowercased() == b.host?.lowercased()
            && effectivePort(a) == effectivePort(b)
    }

    private static func effectivePort(_ u: URL) -> Int {
        u.port ?? (u.scheme?.lowercased() == "https" ? 443 : 80)
    }
}

/// Switched on by the UI tests (debug builds only): a panel showing the player and buttons for the lock
/// screen controls.
enum TestMode {
    static var on: Bool {
        #if DEBUG
        return UserDefaults.standard.bool(forKey: "EncoreTestMode")
        #else
        return false
        #endif
    }
}
