import Foundation

// MARK: - Projects
// Mirrors `ProjectWorkspace` in crates/api/src/replit.rs.
// GET /api/projects returns { "workspaces": [ProjectWorkspace] }.

struct ProjectWorkspace: Codable, Identifiable, Hashable {
    let id: String
    let userId: String
    let projectName: String
    let workspaceId: String
    let workspaceUrl: String
    let chatEndpoint: String
    let createdAt: String
    let updatedAt: String
    let status: String

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case projectName = "project_name"
        case workspaceId = "workspace_id"
        case workspaceUrl = "workspace_url"
        case chatEndpoint = "chat_endpoint"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case status
    }
}

struct WorkspaceListResponse: Codable {
    let workspaces: [ProjectWorkspace]
}

// MARK: - Auth status
// Mirrors `ProviderAuthInfo` in crates/api/src/auth.rs (GET /api/auth/status -> [ProviderAuthInfo]).

struct ProviderAuthInfo: Codable, Identifiable, Hashable {
    var id: String { credentialId }
    let provider: String
    let credentialType: String
    let label: String?
    let authenticated: Bool
    let email: String?
    let isDefault: Bool
    let credentialId: String
    let status: String

    enum CodingKeys: String, CodingKey {
        case provider
        case credentialType = "credential_type"
        case label
        case authenticated
        case email
        case isDefault = "is_default"
        case credentialId = "credential_id"
        case status
    }
}

// POST /api/auth/start
struct AuthStartRequest: Codable {
    let provider: String
    let credentialType: String?
    enum CodingKeys: String, CodingKey {
        case provider
        case credentialType = "credential_type"
    }
}

struct AuthStartResponse: Codable {
    let provider: String
    let authUrl: String?
    let deviceCode: String?
    let message: String
    enum CodingKeys: String, CodingKey {
        case provider
        case authUrl = "auth_url"
        case deviceCode = "device_code"
        case message
    }
}

// POST /api/auth/submit
struct AuthSubmitRequest: Codable {
    let provider: String
    let code: String
    let label: String?
    let credentialType: String?
    enum CodingKeys: String, CodingKey {
        case provider, code, label
        case credentialType = "credential_type"
    }
}

struct AuthSubmitResponse: Codable {
    let success: Bool
    let message: String
    let credentialId: String?
    enum CodingKeys: String, CodingKey {
        case success, message
        case credentialId = "credential_id"
    }
}

// MARK: - Conversations
// Mirrors crates/api/src/db.rs Conversation / Message and conversations.rs responses.

struct Conversation: Codable, Identifiable, Hashable {
    let id: String
    let userId: String
    let title: String?
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case title
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct ConversationSummary: Codable, Identifiable, Hashable {
    let id: String
    let title: String?
    let updatedAt: String
    let messageCount: Int
    let lastMessagePreview: String?

    enum CodingKeys: String, CodingKey {
        case id, title
        case updatedAt = "updated_at"
        case messageCount = "message_count"
        case lastMessagePreview = "last_message_preview"
    }
}

struct ConversationListResponse: Codable {
    let conversations: [ConversationSummary]
    let total: Int
}

struct ChatMessage: Codable, Identifiable, Hashable {
    let id: String
    let conversationId: String
    let role: String
    let content: String
    let provider: String?
    let model: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case conversationId = "conversation_id"
        case role, content, provider, model
        case createdAt = "created_at"
    }
}

// GET /api/conversations/{id} -> Conversation fields flattened + messages array.
struct ConversationWithMessages: Codable {
    let id: String
    let userId: String
    let title: String?
    let createdAt: String
    let updatedAt: String
    let messages: [ChatMessage]

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case title
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case messages
    }
}

// MARK: - User profile
// Mirrors `UserProfile` in crates/api/src/user.rs (GET /api/user/profile).

struct UserProfile: Codable {
    let userId: String
    let githubLinked: Bool
    let selectedRepos: [String]

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case githubLinked = "github_linked"
        case selectedRepos = "selected_repos"
    }
}

// MARK: - SSE chat stream events
// Mirrors `StepEvent` in crates/api/src/state.rs — `#[serde(tag = "type", rename_all = "snake_case")]`.
// Emitted by POST /api/chat as text/event-stream data lines.

enum ChatStreamEvent: Decodable {
    case started(stepId: String, provider: String, model: String)
    case output(stepId: String, line: String)
    case completed(stepId: String, exitCode: Int)
    case failed(stepId: String, error: String)

    private enum CodingKeys: String, CodingKey {
        case type
        case stepId = "step_id"
        case provider, model, line
        case exitCode = "exit_code"
        case error
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "started":
            self = .started(
                stepId: try c.decode(String.self, forKey: .stepId),
                provider: try c.decodeIfPresent(String.self, forKey: .provider) ?? "",
                model: try c.decodeIfPresent(String.self, forKey: .model) ?? ""
            )
        case "output":
            self = .output(
                stepId: try c.decode(String.self, forKey: .stepId),
                line: try c.decodeIfPresent(String.self, forKey: .line) ?? ""
            )
        case "completed":
            self = .completed(
                stepId: try c.decode(String.self, forKey: .stepId),
                exitCode: try c.decodeIfPresent(Int.self, forKey: .exitCode) ?? 0
            )
        case "failed":
            self = .failed(
                stepId: try c.decode(String.self, forKey: .stepId),
                error: try c.decodeIfPresent(String.self, forKey: .error) ?? "unknown error"
            )
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: c, debugDescription: "unknown StepEvent type: \(type)")
        }
    }
}

// Request body for POST /api/chat — mirrors `ChatRequest` in crates/api/src/chat.rs.
struct ChatRequestBody: Codable {
    let message: String
    let conversationId: String?
    let filePaths: [String]

    enum CodingKeys: String, CodingKey {
        case message
        case conversationId = "conversation_id"
        case filePaths = "file_paths"
    }

    init(message: String, conversationId: String?, filePaths: [String] = []) {
        self.message = message
        self.conversationId = conversationId
        self.filePaths = filePaths
    }
}

// MARK: - Error envelope
// Mirrors `ErrorResponse { error: String }`.
struct APIErrorResponse: Codable {
    let error: String
}
