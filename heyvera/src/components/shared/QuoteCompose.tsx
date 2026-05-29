import { useState } from 'react';
import { X } from 'lucide-react';
import { createPost, fetchMyProfile } from '../../api/social';
import type { Post } from '../../api/types';
import { useAuth } from '../../hooks/useAuth';

interface QuoteComposeProps {
  quotedPost: Post;
  onClose: () => void;
  onQuoteCreated?: () => void;
}

const QUOTE_MAX_CHARS = 280;

export function QuoteCompose({ quotedPost, onClose, onQuoteCreated }: QuoteComposeProps) {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [text, setText] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingChars = QUOTE_MAX_CHARS - text.length;
  const canPost = text.trim().length > 0 && !isPosting && remainingChars >= 0;

  const handleSubmit = async () => {
    if (!canPost) return;

    setIsPosting(true);
    setError(null);

    try {
      if (!authEnabled || !isSignedIn) {
        setError('Sign in to quote posts.');
        return;
      }

      const token = await getToken();
      if (!token) {
        setError('Sign in again to quote.');
        return;
      }

      try {
        await fetchMyProfile(token);
      } catch (profileErr: unknown) {
        const msg = profileErr instanceof Error ? profileErr.message.toLowerCase() : '';
        if (msg.includes('404') || msg.includes('not found')) {
          setError('Create your profile before quoting posts.');
          return;
        }
        throw profileErr;
      }

      await createPost(token, {
        body: text.trim(),
        quotePostId: quotedPost.id,
      });

      onQuoteCreated?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Quote failed. Try again.');
    } finally {
      setIsPosting(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      void handleSubmit();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-16"
      style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 60%, transparent)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[600px] overflow-hidden rounded-2xl animate-scale-in"
        style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--border-primary)' }}
        >
          <button
            onClick={onClose}
            className="rounded-full p-2 transition-colors hover-overlay"
            style={{ color: 'var(--text-primary)' }}
            aria-label="Close"
            type="button"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            className="rounded-full px-5 py-1.5 text-sm font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
            disabled={!canPost}
            onClick={handleSubmit}
            type="button"
          >
            {isPosting ? 'Posting' : 'Post'}
          </button>
        </div>

        {/* Compose area */}
        <div className="px-4 pb-3 pt-3">
          <textarea
            placeholder="Add a comment"
            autoFocus
            className="w-full resize-none border-none bg-transparent text-xl outline-none placeholder:text-[var(--text-secondary)]"
            style={{ color: 'var(--text-primary)', minHeight: '80px' }}
            value={text}
            onChange={(event) => {
              setText(event.target.value.slice(0, QUOTE_MAX_CHARS));
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            maxLength={QUOTE_MAX_CHARS}
            disabled={isPosting}
          />

          {/* Quoted post preview */}
          <div
            className="mt-2 rounded-2xl border p-3"
            style={{ borderColor: 'var(--border-primary)' }}
          >
            <div className="flex items-center gap-2">
              {quotedPost.author.avatar_url ? (
                <img
                  src={quotedPost.author.avatar_url}
                  alt={quotedPost.author.display_name}
                  className="h-5 w-5 rounded-full object-cover"
                  style={{ backgroundColor: 'var(--border-primary)' }}
                />
              ) : (
                <div
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[10px]"
                  style={{ backgroundColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
                >
                  {quotedPost.author.display_name.charAt(0)}
                </div>
              )}
              <span className="text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>
                {quotedPost.author.display_name}
              </span>
              <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                @{quotedPost.author.handle}
              </span>
            </div>
            <p className="mt-1 line-clamp-3 text-[13px]" style={{ color: 'var(--text-primary)' }}>
              {quotedPost.content}
            </p>
          </div>

          {error && (
            <p className="mt-2 text-sm" style={{ color: 'var(--color-danger)' }}>
              {error}
            </p>
          )}

          <div className="mt-3 flex justify-end">
            <span
              className="text-sm"
              style={{ color: remainingChars <= 20 ? 'var(--color-danger)' : 'var(--text-secondary)' }}
              aria-live="polite"
            >
              {remainingChars}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
