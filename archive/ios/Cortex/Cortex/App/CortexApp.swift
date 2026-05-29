import SwiftUI

@main
struct CortexApp: App {
    @StateObject private var session = AuthSession.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .task {
                    await session.restoreFromKeychain()
                }
                // Handle the OAuth redirect (cortexapp://auth-callback?...).
                .onOpenURL { url in
                    session.handleRedirect(url)
                }
        }
    }
}
