import { SignInButton } from '@clerk/clerk-react';
import { MessageCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export function MessagesPage() {
  const { authEnabled, isSignedIn } = useAuth();

  return (
    <div
      className="relative z-20 flex min-h-screen w-full"
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      <div className="flex w-full flex-col">
        <div className="sticky top-[var(--top-bar-height)] z-10 border-b bg-black/80 px-4 py-3 backdrop-blur-md lg:top-0" style={{ borderColor: 'var(--border-primary)' }}>
          <h1 className="text-[20px] font-bold">Messages</h1>
        </div>

        {authEnabled && !isSignedIn ? (
          <SignedOutMessagesPrompt />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div>
              <div
                className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
              >
                <MessageCircle className="h-7 w-7" aria-hidden="true" />
              </div>
              <p className="text-[20px] font-bold">Messages are coming soon</p>
              <p className="mt-1 text-[15px]" style={{ color: 'var(--text-secondary)' }}>
                Direct messaging is not available yet. Check back later.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SignedOutMessagesPrompt() {
  return (
    <div className="px-4 py-8">
      <h2 className="text-[20px] font-bold">Sign in to see messages</h2>
      <p className="mt-2 text-[15px]" style={{ color: 'var(--text-secondary)' }}>
        Your conversations and replies will appear here after you sign in.
      </p>
      <SignInButton mode="modal">
        <button
          type="button"
          className="mt-5 rounded-full px-5 py-2 text-[15px] font-bold"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
        >
          Sign in
        </button>
      </SignInButton>
    </div>
  );
}

export default MessagesPage;
