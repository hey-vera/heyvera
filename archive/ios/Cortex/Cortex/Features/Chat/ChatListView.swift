import SwiftUI

@MainActor
final class ChatListViewModel: ObservableObject {
    @Published var conversations: [ConversationSummary] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            conversations = try await APIClient.shared.listConversations().conversations
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
    }

    func delete(_ summary: ConversationSummary) async {
        do {
            try await APIClient.shared.deleteConversation(id: summary.id)
            conversations.removeAll { $0.id == summary.id }
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

struct ChatListView: View {
    @StateObject private var viewModel = ChatListViewModel()
    @State private var newChatId: String?
    @State private var showNewChat = false

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading && viewModel.conversations.isEmpty {
                    ProgressView("Loading chats…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.conversations.isEmpty {
                    ContentUnavailableViewCompat(
                        title: "No chats yet",
                        systemImage: "bubble.left.and.bubble.right",
                        description: viewModel.errorMessage ?? "Start a new conversation to get coding help."
                    )
                } else {
                    List {
                        ForEach(viewModel.conversations) { conv in
                            NavigationLink(value: conv) {
                                ConversationRow(summary: conv)
                            }
                        }
                        .onDelete { indexSet in
                            let targets = indexSet.map { viewModel.conversations[$0] }
                            Task { for t in targets { await viewModel.delete(t) } }
                        }
                    }
                }
            }
            .navigationTitle("Chats")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showNewChat = true } label: {
                        Image(systemName: "square.and.pencil")
                    }
                }
            }
            .navigationDestination(for: ConversationSummary.self) { conv in
                ChatView(conversationId: conv.id, title: conv.title ?? "Chat")
            }
            .navigationDestination(isPresented: $showNewChat) {
                ChatView(conversationId: nil, title: "New Chat")
            }
            .refreshable { await viewModel.load() }
            .task { await viewModel.load() }
        }
    }
}

private struct ConversationRow: View {
    let summary: ConversationSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(summary.title ?? "Untitled")
                .font(.headline)
                .lineLimit(1)
            if let preview = summary.lastMessagePreview, !preview.isEmpty {
                Text(preview)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Text("\(summary.messageCount) messages")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }
}
