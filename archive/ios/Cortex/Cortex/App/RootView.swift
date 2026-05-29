import SwiftUI

/// Top-level router: shows the sign-in flow until a Clerk session token is present,
/// then the authenticated tab shell.
struct RootView: View {
    @EnvironmentObject private var session: AuthSession

    var body: some View {
        Group {
            switch session.state {
            case .unknown:
                ProgressView("Loading…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .signedOut:
                SignInView()
            case .signedIn:
                MainTabView()
            }
        }
        .animation(.default, value: session.state)
    }
}

/// Authenticated app shell. The MVP centers on browsing projects and chatting.
struct MainTabView: View {
    var body: some View {
        TabView {
            ProjectListView()
                .tabItem { Label("Projects", systemImage: "folder") }

            ChatListView()
                .tabItem { Label("Chats", systemImage: "bubble.left.and.bubble.right") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}
