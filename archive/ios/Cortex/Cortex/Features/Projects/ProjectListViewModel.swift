import Foundation

@MainActor
final class ProjectListViewModel: ObservableObject {
    @Published var projects: [ProjectWorkspace] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            projects = try await APIClient.shared.listProjects()
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
    }
}
