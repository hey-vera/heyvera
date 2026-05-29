import Foundation

enum APIError: LocalizedError {
    case notAuthenticated
    case http(status: Int, message: String)
    case decoding(Error)
    case transport(Error)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "You need to sign in again."
        case let .http(status, message):
            return message.isEmpty ? "Request failed (HTTP \(status))." : message
        case let .decoding(err):
            return "Could not read the server response: \(err.localizedDescription)"
        case let .transport(err):
            return err.localizedDescription
        case .invalidResponse:
            return "Unexpected server response."
        }
    }
}

/// REST client for the Cortex `/api/*` surface. Every request carries the Clerk
/// session token as `Authorization: Bearer <token>`. The token is supplied lazily
/// via a provider closure so it can be refreshed by `AuthSession` between calls.
actor APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    /// Returns a fresh, valid bearer token (or nil when signed out).
    /// Set by AuthSession during startup.
    var tokenProvider: (@Sendable () async -> String?)?

    init(session: URLSession = .shared) {
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    func setTokenProvider(_ provider: @escaping @Sendable () async -> String?) {
        self.tokenProvider = provider
    }

    // MARK: Request building

    private func makeRequest(_ method: String, path: String, query: [URLQueryItem] = [], body: Data? = nil) async throws -> URLRequest {
        guard var components = URLComponents(url: AppConfig.apiBaseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidResponse
        }
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw APIError.invalidResponse }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token = await tokenProvider?() {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return req
    }

    private func send<T: Decodable>(_ req: URLRequest, as type: T.Type) async throws -> T {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.transport(error)
        }
        try validate(response, data: data)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    private func sendNoContent(_ req: URLRequest) async throws {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.transport(error)
        }
        try validate(response, data: data)
    }

    private func validate(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 { throw APIError.notAuthenticated }
            let message = (try? decoder.decode(APIErrorResponse.self, from: data))?.error ?? ""
            throw APIError.http(status: http.statusCode, message: message)
        }
    }

    // MARK: Endpoints

    /// GET /api/auth/status
    func authStatus() async throws -> [ProviderAuthInfo] {
        let req = try await makeRequest("GET", path: "api/auth/status")
        return try await send(req, as: [ProviderAuthInfo].self)
    }

    /// POST /api/auth/start
    func authStart(provider: String, credentialType: String = "subscription") async throws -> AuthStartResponse {
        let body = try encoder.encode(AuthStartRequest(provider: provider, credentialType: credentialType))
        let req = try await makeRequest("POST", path: "api/auth/start", body: body)
        return try await send(req, as: AuthStartResponse.self)
    }

    /// POST /api/auth/submit
    func authSubmit(provider: String, code: String, credentialType: String = "subscription", label: String? = nil) async throws -> AuthSubmitResponse {
        let body = try encoder.encode(AuthSubmitRequest(provider: provider, code: code, label: label, credentialType: credentialType))
        let req = try await makeRequest("POST", path: "api/auth/submit", body: body)
        return try await send(req, as: AuthSubmitResponse.self)
    }

    /// GET /api/projects
    func listProjects() async throws -> [ProjectWorkspace] {
        let req = try await makeRequest("GET", path: "api/projects")
        return try await send(req, as: WorkspaceListResponse.self).workspaces
    }

    /// GET /api/projects/{id}
    func getProject(id: String) async throws -> ProjectWorkspace {
        let req = try await makeRequest("GET", path: "api/projects/\(id)")
        return try await send(req, as: ProjectWorkspace.self)
    }

    /// GET /api/conversations
    func listConversations(limit: Int = 50, offset: Int = 0) async throws -> ConversationListResponse {
        let req = try await makeRequest("GET", path: "api/conversations", query: [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset)),
        ])
        return try await send(req, as: ConversationListResponse.self)
    }

    /// POST /api/conversations
    func createConversation(title: String?) async throws -> Conversation {
        struct Body: Encodable { let title: String? }
        let body = try encoder.encode(Body(title: title))
        let req = try await makeRequest("POST", path: "api/conversations", body: body)
        return try await send(req, as: Conversation.self)
    }

    /// GET /api/conversations/{id}
    func getConversation(id: String) async throws -> ConversationWithMessages {
        let req = try await makeRequest("GET", path: "api/conversations/\(id)")
        return try await send(req, as: ConversationWithMessages.self)
    }

    /// DELETE /api/conversations/{id}
    func deleteConversation(id: String) async throws {
        let req = try await makeRequest("DELETE", path: "api/conversations/\(id)")
        try await sendNoContent(req)
    }

    /// GET /api/user/profile
    func userProfile() async throws -> UserProfile {
        let req = try await makeRequest("GET", path: "api/user/profile")
        return try await send(req, as: UserProfile.self)
    }
}
