import SwiftUI

struct ProjectListView: View {
    @StateObject private var viewModel = ProjectListViewModel()

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading && viewModel.projects.isEmpty {
                    ProgressView("Loading projects…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = viewModel.errorMessage, viewModel.projects.isEmpty {
                    ContentUnavailableViewCompat(
                        title: "Couldn't load projects",
                        systemImage: "exclamationmark.triangle",
                        description: error
                    )
                } else if viewModel.projects.isEmpty {
                    ContentUnavailableViewCompat(
                        title: "No projects yet",
                        systemImage: "folder",
                        description: "Create a project on the web to see it here."
                    )
                } else {
                    List(viewModel.projects) { project in
                        NavigationLink(value: project) {
                            ProjectRow(project: project)
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Projects")
            .navigationDestination(for: ProjectWorkspace.self) { project in
                ProjectDetailView(project: project)
            }
            .refreshable { await viewModel.load() }
            .task { await viewModel.load() }
        }
    }
}

private struct ProjectRow: View {
    let project: ProjectWorkspace

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "shippingbox.fill")
                .foregroundStyle(.tint)
                .font(.title3)
            VStack(alignment: .leading, spacing: 2) {
                Text(project.projectName)
                    .font(.headline)
                Text(project.status.capitalized)
                    .font(.caption)
                    .foregroundStyle(statusColor)
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }

    private var statusColor: Color {
        switch project.status {
        case "active": return .green
        case "error": return .red
        default: return .secondary
        }
    }
}

/// Project detail: shows metadata and entry points into chat and the file viewer.
struct ProjectDetailView: View {
    let project: ProjectWorkspace

    var body: some View {
        List {
            Section("Workspace") {
                LabeledContent("Name", value: project.projectName)
                LabeledContent("Status", value: project.status.capitalized)
                LabeledContent("Workspace ID", value: project.workspaceId)
            }

            Section {
                NavigationLink {
                    FileBrowserView(project: project)
                } label: {
                    Label("Browse files", systemImage: "doc.text.magnifyingglass")
                }
                NavigationLink {
                    ChatView(conversationId: nil, title: project.projectName)
                } label: {
                    Label("Open chat", systemImage: "bubble.left.and.bubble.right")
                }
            }
        }
        .navigationTitle(project.projectName)
        .navigationBarTitleDisplayMode(.inline)
    }
}
