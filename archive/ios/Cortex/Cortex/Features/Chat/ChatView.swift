import SwiftUI

struct ChatView: View {
    @StateObject private var viewModel: ChatViewModel
    @State private var draft = ""
    @FocusState private var inputFocused: Bool
    private let title: String

    init(conversationId: String?, title: String) {
        _viewModel = StateObject(wrappedValue: ChatViewModel(conversationId: conversationId))
        self.title = title
    }

    var body: some View {
        VStack(spacing: 0) {
            transcript
            Divider()
            composer
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.loadHistory() }
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if viewModel.bubbles.isEmpty {
                        Text("Ask Cortex to build, debug, explore, or review code.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 48)
                    }
                    ForEach(viewModel.bubbles) { bubble in
                        MessageBubbleView(bubble: bubble)
                            .id(bubble.id)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 16)
            }
            .onChange(of: viewModel.bubbles.last?.content) { _ in
                if let last = viewModel.bubbles.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Message Cortex…", text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .focused($inputFocused)

            if viewModel.isSending {
                Button(role: .destructive) {
                    viewModel.cancel()
                } label: {
                    Image(systemName: "stop.circle.fill")
                        .font(.title)
                }
            } else {
                Button {
                    let text = draft
                    draft = ""
                    viewModel.send(text)
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title)
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(12)
    }
}

private struct MessageBubbleView: View {
    let bubble: ChatBubble

    var body: some View {
        HStack {
            if bubble.isUser { Spacer(minLength: 40) }
            VStack(alignment: bubble.isUser ? .trailing : .leading, spacing: 4) {
                Text(bubble.content.isEmpty && bubble.isStreaming ? "…" : bubble.content)
                    .textSelection(.enabled)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(bubble.isUser ? Color.accentColor : Color(.secondarySystemBackground))
                    .foregroundStyle(bubble.isUser ? Color.white : Color.primary)
                    .clipShape(RoundedRectangle(cornerRadius: 16))

                if bubble.isStreaming {
                    HStack(spacing: 4) {
                        ProgressView().controlSize(.mini)
                        if let model = bubble.model, !model.isEmpty {
                            Text(model).font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                }
            }
            if !bubble.isUser { Spacer(minLength: 40) }
        }
    }
}
