import Foundation

/// Central configuration for the Cortex iOS app.
///
/// The backend is the production Cortex API at `cortex.heyvera.org`, which serves
/// both the `/api/*` REST surface and the SSE chat stream. Authentication is a
/// Clerk-issued JWT presented as `Authorization: Bearer <token>` on every request
/// (mirrors the web frontend in `web/src/api`).
enum AppConfig {
    /// Base URL for the Cortex API. Overridable at runtime for local development
    /// via the `CORTEX_API_BASE` environment variable (e.g. http://localhost:3001).
    static let apiBaseURL: URL = {
        if let override = ProcessInfo.processInfo.environment["CORTEX_API_BASE"],
           let url = URL(string: override) {
            return url
        }
        return URL(string: "https://cortex.heyvera.org")!
    }()

    /// Clerk publishable key. Read from the bundle's `CLERK_PUBLISHABLE_KEY`
    /// Info.plist entry or environment. The web app uses `VITE_CLERK_PUBLISHABLE_KEY`.
    static let clerkPublishableKey: String = {
        if let key = Bundle.main.object(forInfoDictionaryKey: "CLERK_PUBLISHABLE_KEY") as? String,
           !key.isEmpty {
            return key
        }
        return ProcessInfo.processInfo.environment["CLERK_PUBLISHABLE_KEY"] ?? ""
    }()

    /// Custom URL scheme registered in Info.plist for OAuth / hosted sign-in redirects.
    static let oauthCallbackScheme = "cortexapp"
    static let oauthCallbackURL = "cortexapp://auth-callback"

    /// Keychain service identifier for stored credentials.
    static let keychainService = "org.heyvera.cortex"
}
