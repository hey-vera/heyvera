import Foundation
import SwiftUI
import AuthenticationServices

/// Owns the user's authentication state and the Clerk session token.
///
/// Sign-in uses Clerk's hosted account portal opened in an `ASWebAuthenticationSession`.
/// On success Clerk redirects to `cortexapp://auth-callback#__clerk_db_jwt=<token>` (or a
/// `?token=` query param, depending on Clerk configuration), which we parse and store in
/// the Keychain. Every API call then presents this JWT as `Authorization: Bearer <token>`.
///
/// The token is a short-lived Clerk JWT; `validToken()` checks expiry and the UI prompts
/// re-auth when it lapses. (Clerk's native iOS SDK can be dropped in later to auto-refresh;
/// the token-provider seam is already in place.)
@MainActor
final class AuthSession: ObservableObject {
    enum State: Equatable {
        case unknown
        case signedOut
        case signedIn(userId: String)
    }

    static let shared = AuthSession()

    @Published private(set) var state: State = .unknown
    @Published var lastError: String?

    private var token: String?
    private var tokenExpiry: Date?
    private var authContextProvider = WebAuthPresentationContext()

    private init() {
        // Wire the API + chat clients to read the current token lazily.
        Task {
            await APIClient.shared.setTokenProvider { [weak self] in
                await self?.validToken()
            }
        }
    }

    var tokenProviderClosure: @Sendable () async -> String? {
        { [weak self] in await self?.validToken() }
    }

    // MARK: Token access

    /// Returns the cached token if still valid, else nil.
    func validToken() async -> String? {
        if let token, let expiry = tokenExpiry, expiry > Date().addingTimeInterval(30) {
            return token
        }
        if let token, tokenExpiry == nil {
            return token // No expiry info; optimistically use it.
        }
        return nil
    }

    // MARK: Lifecycle

    func restoreFromKeychain() async {
        guard let stored = KeychainStore.get(.sessionToken) else {
            state = .signedOut
            return
        }
        token = stored
        tokenExpiry = Self.parseJWTExpiry(stored)
        if let expiry = tokenExpiry, expiry <= Date() {
            // Expired — clear and require re-auth.
            signOut()
            return
        }
        let userId = KeychainStore.get(.userId) ?? Self.parseJWTSubject(stored) ?? "unknown"
        state = .signedIn(userId: userId)
    }

    /// Launches Clerk hosted sign-in. The portal URL is derived from the publishable key.
    func signIn() async {
        lastError = nil
        guard let authURL = Self.clerkHostedSignInURL() else {
            lastError = "Clerk publishable key is not configured."
            return
        }

        do {
            let callback = try await runWebAuth(url: authURL)
            guard let jwt = Self.extractToken(from: callback) else {
                lastError = "Sign-in did not return a session token."
                return
            }
            persist(token: jwt)
        } catch let err as ASWebAuthenticationSessionError where err.code == .canceledLogin {
            // User dismissed the sheet — no error to surface.
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Handles a deep link delivered to the app (when sign-in completes out-of-band).
    func handleRedirect(_ url: URL) {
        guard url.scheme == AppConfig.oauthCallbackScheme,
              let jwt = Self.extractToken(from: url) else { return }
        persist(token: jwt)
    }

    func signOut() {
        token = nil
        tokenExpiry = nil
        KeychainStore.clearAll()
        state = .signedOut
    }

    // MARK: Internals

    private func persist(token jwt: String) {
        token = jwt
        tokenExpiry = Self.parseJWTExpiry(jwt)
        let userId = Self.parseJWTSubject(jwt) ?? "unknown"
        KeychainStore.set(jwt, for: .sessionToken)
        KeychainStore.set(userId, for: .userId)
        if let expiry = tokenExpiry {
            KeychainStore.set(String(expiry.timeIntervalSince1970), for: .sessionTokenExpiry)
        }
        state = .signedIn(userId: userId)
    }

    private func runWebAuth(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: AppConfig.oauthCallbackScheme
            ) { callbackURL, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: APIError.invalidResponse)
                }
            }
            session.presentationContextProvider = authContextProvider
            session.prefersEphemeralWebBrowserSession = false
            if !session.start() {
                continuation.resume(throwing: APIError.invalidResponse)
            }
        }
    }

    // MARK: Clerk helpers

    /// Builds the Clerk hosted sign-in URL from the publishable key.
    /// Clerk publishable keys encode the Frontend API host as base64 after the `pk_(live|test)_` prefix.
    static func clerkHostedSignInURL() -> URL? {
        let key = AppConfig.clerkPublishableKey
        guard !key.isEmpty else { return nil }
        let parts = key.split(separator: "_", maxSplits: 2)
        guard parts.count == 3 else { return nil }
        let encoded = String(parts[2])
        guard let host = decodeClerkHost(encoded) else { return nil }
        // Clerk Account Portal sign-in with a redirect back to our scheme.
        var comps = URLComponents()
        comps.scheme = "https"
        comps.host = host.replacingOccurrences(of: "$", with: "")
        comps.path = "/v1/client/sign_in"
        comps.queryItems = [
            URLQueryItem(name: "redirect_url", value: AppConfig.oauthCallbackURL),
        ]
        return comps.url
    }

    private static func decodeClerkHost(_ encoded: String) -> String? {
        var b64 = encoded.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64.append("=") }
        guard let data = Data(base64Encoded: b64), let host = String(data: data, encoding: .utf8) else {
            return nil
        }
        return host.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Extracts a JWT from the redirect URL fragment or query.
    /// Clerk commonly returns `#__clerk_db_jwt=...`; we also accept `?token=` / `?__session=`.
    static func extractToken(from url: URL) -> String? {
        let candidateKeys = ["__clerk_db_jwt", "token", "__session", "jwt"]

        if let fragment = url.fragment {
            if let v = value(forAny: candidateKeys, inQueryString: fragment) { return v }
        }
        if let query = url.query {
            if let v = value(forAny: candidateKeys, inQueryString: query) { return v }
        }
        return nil
    }

    private static func value(forAny keys: [String], inQueryString qs: String) -> String? {
        let pairs = qs.split(separator: "&")
        for pair in pairs {
            let kv = pair.split(separator: "=", maxSplits: 1)
            guard kv.count == 2 else { continue }
            let key = String(kv[0])
            if keys.contains(key) {
                return String(kv[1]).removingPercentEncoding
            }
        }
        return nil
    }

    // MARK: JWT decoding (claims only — verification happens server-side)

    static func parseJWTExpiry(_ jwt: String) -> Date? {
        guard let claims = decodeJWTClaims(jwt), let exp = claims["exp"] as? Double else { return nil }
        return Date(timeIntervalSince1970: exp)
    }

    static func parseJWTSubject(_ jwt: String) -> String? {
        decodeJWTClaims(jwt)?["sub"] as? String
    }

    private static func decodeJWTClaims(_ jwt: String) -> [String: Any]? {
        let segments = jwt.split(separator: ".")
        guard segments.count >= 2 else { return nil }
        var b64 = String(segments[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64.append("=") }
        guard let data = Data(base64Encoded: b64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return json
    }
}

/// Provides the presentation anchor for ASWebAuthenticationSession.
private final class WebAuthPresentationContext: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        return scene?.keyWindow ?? ASPresentationAnchor()
    }
}

private extension UIWindowScene {
    var keyWindow: UIWindow? { windows.first { $0.isKeyWindow } ?? windows.first }
}
