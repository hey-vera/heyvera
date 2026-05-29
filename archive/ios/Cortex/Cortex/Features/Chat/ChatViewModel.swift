import Foundation

/// A message rendered in the chat transcript. `isStreaming` marks the assistant
/// bubble currently receiving SSE tokens.
struct ChatBubble: Identifiable, Equatable {
    let id: String
    var role: String          // "user" | "assistant" | "system"
    var content: String
    var isStreaming: Bool
    var provider: String?
    var model: String?

    var isUser: Bool { role == "user" }
}

@MainActor
final class ChatViewModel: ObservableObject {
    @Published private(set) var bubbles: [ChatBubble] = []
    @Published private(set) var isSending = false
    @Published var errorMessage: String?

    private(set) var conversationId: String?
    private var streamTask: Task<Void, Never>?
    private let stream: ChatStreamClient

    init(conversationId: String?) {
        self.conversationId = conversationId
        self.stream = ChatStreamClient(tokenProvider: AuthSession.shared.tokenProviderClosure)
    }

    /// Loads existing history for a saved conversation.
    func loadHistory() async {
        guard let id = conversationId else { return }
        do {
            let conv = try await APIClient.shared.getConversation(id: id)
            bubbles = conv.messages.map {
                ChatBubble(id: $0.id, role: $0.role, content: $0.content,
                           isStreaming: false, provider: $0.provider, model: $0.model)
            }
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Sends a user message and streams the assistant reply via SSE.
    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return }

        errorMessage = nil
        isSending = true

        let userBubble = ChatBubble(id: UUID().uuidString, role: "user", content: trimmed, isStreaming: false)
        bubbles.append(userBubble)

        let assistantId = UUID().uuidString
        bubbles.append(ChatBubble(id: assistantId, role: "assistant", content: "", isStreaming: true))

        streamTask = Task {
            // Ensure a conversation exists so the backend persists the turn.
            await ensureConversation(seedTitle: trimmed)

            do {
                let events = stream.stream(message: trimmed, conversationId: conversationId)
                for try await event in events {
                    apply(event, to: assistantId)
                }
                finishStreaming(assistantId)
            } catch is CancellationError {
                finishStreaming(assistantId)
            } catch {
                let message = (error as? APIError)?.errorDescription ?? error.localizedDescription
                appendError(message, to: assistantId)
            }
            isSending = false
        }
    }

    func cancel() {
        streamTask?.cancel()
        streamTask = nil
        isSending = false
    }

    // MARK: Internals

    private func ensureConversation(seedTitle: String) async {
        guard conversationId == nil else { return }
        do {
            let title = String(seedTitle.prefix(60))
            let conv = try await APIClient.shared.createConversation(title: title)
            conversationId = conv.id
        } catch {
            // Non-fatal: chat still streams, just won't be persisted server-side.
        }
    }

    private func apply(_ event: ChatStreamEvent, to assistantId: String) {
        guard let idx = bubbles.firstIndex(where: { $0.id == assistantId }) else { return }
        switch event {
        case let .started(_, provider, model):
            bubbles[idx].provider = provider
            bubbles[idx].model = model
        case let .output(_, line):
            bubbles[idx].content += line
        case .completed:
            bubbles[idx].isStreaming = false
        case let .failed(_, error):
            if bubbles[idx].content.isEmpty {
                bubbles[idx].content = "⚠️ \(error)"
            } else {
                bubbles[idx].content += "\n\n⚠️ \(error)"
            }
            bubbles[idx].isStreaming = false
        }
    }

    private func finishStreaming(_ assistantId: String) {
        guard let idx = bubbles.firstIndex(where: { $0.id == assistantId }) else { return }
        bubbles[idx].isStreaming = false
        if bubbles[idx].content.isEmpty {
            bubbles[idx].content = "(no response)"
        }
    }

    private func appendError(_ message: String, to assistantId: String) {
        guard let idx = bubbles.firstIndex(where: { $0.id == assistantId }) else { return }
        bubbles[idx].content = bubbles[idx].content.isEmpty ? "⚠️ \(message)" : bubbles[idx].content
        bubbles[idx].isStreaming = false
        errorMessage = message
    }
}
