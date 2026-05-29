import SwiftUI

struct SignInView: View {
    @EnvironmentObject private var session: AuthSession
    @State private var isSigningIn = false

    var body: some View {
        VStack(spacing: 28) {
            Spacer()

            VStack(spacing: 12) {
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 64, weight: .light))
                    .foregroundStyle(.tint)
                Text("Cortex")
                    .font(.largeTitle.bold())
                Text("AI coding, anywhere. Connect to your personal Cortex container and pick up where you left off.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            Spacer()

            VStack(spacing: 12) {
                Button {
                    Task {
                        isSigningIn = true
                        await session.signIn()
                        isSigningIn = false
                    }
                } label: {
                    HStack {
                        if isSigningIn { ProgressView().tint(.white) }
                        Text(isSigningIn ? "Signing in…" : "Sign in")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSigningIn)

                if let error = session.lastError {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
    }
}
