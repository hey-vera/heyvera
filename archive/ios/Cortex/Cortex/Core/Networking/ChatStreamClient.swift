import Foundation

/// Streams a chat turn from `POST /api/chat`.
///
/// The backend (crates/api/src/chat.rs) responds with `text/event-stream`. Each SSE
/// `data:` line is a JSON-encoded `StepEvent`. We surface those as an `AsyncThrowingStream`
/// of `ChatStreamEvent` so the UI can append assistant tokens as they arrive.
///
/// Note: although the original brief mentioned WebSockets, the live chat channel in the
/// production backend is Server-Sent Events. `/api/ws` is the worker socket and `/api/mc`
/// is the mission-control observer socket — neither carries user chat. SSE is the correct
/// real-time transport here.
struct ChatStreamClient {
    let tokenProvider: @Sendable () async -> String?

    func stream(message: String, conversationId: String?, filePaths: [String] = []) -> AsyncThrowingStream<ChatStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let url = AppConfig.apiBaseURL.appendingPathComponent("api/chat")
                    var req = URLRequest(url: url)
                    req.httpMethod = "POST"
                    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    req.httpBody = try JSONEncoder().encode(
                        ChatRequestBody(message: message, conversationId: conversationId, filePaths: filePaths)
                    )
                    if let token = await tokenProvider() {
                        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                    }

                    let (bytes, response) = try await URLSession.shared.bytes(for: req)

                    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        // Drain remaining bytes to recover any JSON error envelope.
                        var raw = Data()
                        for try await b in bytes { raw.append(b) }
                        let msg = (try? JSONDecoder().decode(APIErrorResponse.self, from: raw))?.error ?? ""
                        if http.statusCode == 401 {
                            throw APIError.notAuthenticated
                        }
                        throw APIError.http(status: http.statusCode, message: msg)
                    }

                    let decoder = JSONDecoder()
                    // SSE frames are separated by blank lines; each data line carries one JSON event.
                    for try await line in bytes.lines {
                        if Task.isCancelled { break }
                        guard let payload = Self.extractData(from: line) else { continue }
                        guard let data = payload.data(using: .utf8) else { continue }
                        if let event = try? decoder.decode(ChatStreamEvent.self, from: data) {
                            continuation.yield(event)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Extracts the payload from an SSE line. Handles both `data: {...}` framing and
    /// bare JSON lines (axum's SSE encoder prefixes `data:`).
    private static func extractData(from line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return nil }
        if trimmed.hasPrefix("data:") {
            let value = trimmed.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
            return value.isEmpty ? nil : value
        }
        // Tolerate keep-alive comments (": ...") and other SSE fields.
        if trimmed.hasPrefix(":") || trimmed.hasPrefix("event:") || trimmed.hasPrefix("id:") {
            return nil
        }
        // Fallback: a bare JSON object line.
        if trimmed.hasPrefix("{") { return trimmed }
        return nil
    }
}
