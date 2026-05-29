import SwiftUI

@MainActor
final class SettingsViewModel: ObservableObject {
    @Published var credentials: [ProviderAuthInfo] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            credentials = try await APIClient.shared.authStatus()
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
    }
}

struct SettingsView: View {
    @EnvironmentObject private var session: AuthSession
    @StateObject private var viewModel = SettingsViewModel()

    var body: some View {
        NavigationStack {
            List {
                Section("Account") {
                    if case let .signedIn(userId) = session.state {
                        LabeledContent("User ID", value: userId)
                    }
                }

                Section("Connected providers") {
                    if viewModel.isLoading {
                        ProgressView()
                    } else if viewModel.credentials.isEmpty {
                        Text(viewModel.errorMessage ?? "No providers connected. Connect a Claude or OpenAI subscription on the web to enable chat.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(viewModel.credentials) { cred in
                            CredentialRow(credential: cred)
                        }
                    }
                }

                Section {
                    Button(role: .destructive) {
                        session.signOut()
                    } label: {
                        Text("Sign out")
                    }
                }
            }
            .navigationTitle("Settings")
            .refreshable { await viewModel.load() }
            .task { await viewModel.load() }
        }
    }
}

private struct CredentialRow: View {
    let credential: ProviderAuthInfo

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(credential.label ?? credential.provider.capitalized)
                    .font(.headline)
                Text("\(credential.provider) · \(credential.credentialType)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if credential.isDefault {
                Text("Default")
                    .font(.caption2)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color.accentColor.opacity(0.15))
                    .clipShape(Capsule())
            }
            Image(systemName: credential.authenticated ? "checkmark.circle.fill" : "exclamationmark.circle")
                .foregroundStyle(credential.authenticated ? .green : .orange)
        }
    }
}
