import SwiftUI

/// A node in the read-only project file tree.
struct FileNode: Identifiable, Hashable {
    let id: String      // full path
    let name: String
    let isDirectory: Bool
    var path: String { id }
}

/// Abstraction over the backend's file source.
///
/// The production Cortex backend does not yet expose a per-project file-listing
/// REST endpoint — project files live inside the user's isolated Replit workspace
/// (see `ProjectWorkspace.workspaceUrl` / crates/api/src/replit.rs). This protocol
/// is the seam: when a `GET /api/projects/{id}/files` (and `.../files/{path}`) route
/// ships, implement `LiveFileService` against it and the UI works unchanged.
protocol FileService {
    func list(projectId: String, path: String) async throws -> [FileNode]
    func read(projectId: String, path: String) async throws -> String
}

enum FileServiceError: LocalizedError {
    case notAvailable
    var errorDescription: String? {
        "Inline file browsing isn't available from the backend yet. Open the workspace to view files."
    }
}

/// Placeholder until a file API exists. Surfaces a clear "open workspace" path.
struct UnavailableFileService: FileService {
    func list(projectId: String, path: String) async throws -> [FileNode] {
        throw FileServiceError.notAvailable
    }
    func read(projectId: String, path: String) async throws -> String {
        throw FileServiceError.notAvailable
    }
}

@MainActor
final class FileBrowserViewModel: ObservableObject {
    @Published var nodes: [FileNode] = []
    @Published var isLoading = false
    @Published var unavailable = false
    @Published var errorMessage: String?

    private let service: FileService
    private let projectId: String

    init(projectId: String, service: FileService = UnavailableFileService()) {
        self.projectId = projectId
        self.service = service
    }

    func load(path: String = "") async {
        isLoading = true
        errorMessage = nil
        unavailable = false
        do {
            nodes = try await service.list(projectId: projectId, path: path)
        } catch is FileServiceError {
            unavailable = true
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
    }
}

struct FileBrowserView: View {
    let project: ProjectWorkspace
    @StateObject private var viewModel: FileBrowserViewModel
    @Environment(\.openURL) private var openURL

    init(project: ProjectWorkspace) {
        self.project = project
        _viewModel = StateObject(wrappedValue: FileBrowserViewModel(projectId: project.id))
    }

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView("Loading files…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.unavailable {
                workspaceFallback
            } else if let error = viewModel.errorMessage {
                ContentUnavailableViewCompat(
                    title: "Couldn't load files",
                    systemImage: "exclamationmark.triangle",
                    description: error
                )
            } else {
                List(viewModel.nodes) { node in
                    if node.isDirectory {
                        NavigationLink(value: node) {
                            Label(node.name, systemImage: "folder")
                        }
                    } else {
                        NavigationLink {
                            FileViewerView(project: project, node: node)
                        } label: {
                            Label(node.name, systemImage: "doc.text")
                        }
                    }
                }
            }
        }
        .navigationTitle("Files")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: FileNode.self) { dir in
            FileBrowserSubdirectoryView(project: project, directory: dir)
        }
        .task { await viewModel.load() }
    }

    private var workspaceFallback: some View {
        VStack(spacing: 16) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 44))
                .foregroundStyle(.secondary)
            Text("Files live in your workspace")
                .font(.headline)
            Text("Inline file browsing from the API isn't available yet. You can open this project's workspace to view its files.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            if let url = URL(string: project.workspaceUrl) {
                Button {
                    openURL(url)
                } label: {
                    Label("Open workspace", systemImage: "arrow.up.right.square")
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Lists the contents of a subdirectory (pushed when tapping a folder).
struct FileBrowserSubdirectoryView: View {
    let project: ProjectWorkspace
    let directory: FileNode
    @StateObject private var viewModel: FileBrowserViewModel

    init(project: ProjectWorkspace, directory: FileNode) {
        self.project = project
        self.directory = directory
        _viewModel = StateObject(wrappedValue: FileBrowserViewModel(projectId: project.id))
    }

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(viewModel.nodes) { node in
                    if node.isDirectory {
                        NavigationLink(value: node) {
                            Label(node.name, systemImage: "folder")
                        }
                    } else {
                        NavigationLink {
                            FileViewerView(project: project, node: node)
                        } label: {
                            Label(node.name, systemImage: "doc.text")
                        }
                    }
                }
            }
        }
        .navigationTitle(directory.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.load(path: directory.path) }
    }
}

/// Read-only viewer for a single file's contents.
struct FileViewerView: View {
    let project: ProjectWorkspace
    let node: FileNode
    @State private var content = ""
    @State private var isLoading = true
    @State private var errorMessage: String?

    private let service: FileService = UnavailableFileService()

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            if isLoading {
                ProgressView().padding()
            } else if let error = errorMessage {
                Text(error).foregroundStyle(.secondary).padding()
            } else {
                Text(content)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
        }
        .navigationTitle(node.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do {
                content = try await service.read(projectId: project.id, path: node.path)
            } catch {
                errorMessage = (error as? FileServiceError)?.errorDescription
                    ?? (error as? APIError)?.errorDescription
                    ?? error.localizedDescription
            }
            isLoading = false
        }
    }
}
