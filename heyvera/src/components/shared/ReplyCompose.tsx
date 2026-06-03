import { useState } from 'react';
import { X } from 'lucide-react';
import { createPost, fetchMyProfile } from '../../api/social';
import type { Post } from '../../api/types';
import { useAuth } from '../../hooks/useAuth';

interface ReplyComposeProps {
  replyToPost: Post;
  onClose: () => void;
  onReplyCreated?: (replyPost: any) => void;
}

const REPLY_MAX_CHARS = 280;

export function ReplyCompose({ replyToPost, onClose, onReplyCreated }: ReplyComposeProps) {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [replyText, setReplyText] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingChars = REPLY_MAX_CHARS - replyText.length;
  const canPost = replyText.trim().length > 0 && !isPosting && remainingChars >= 0;

  const handleSubmitReply = async () => {
    if (!canPost) return;

    setIsPosting(true);
    setError(null);

    try {
      if (!authEnabled || !isSignedIn) {
        setError('Sign in to reply to posts.');
        return;
      }

      const token = await getToken();
      if (!token) {
        setError('Sign in again to reply.');
        return;
      }

      // Check if user has profile
      try {
        await fetchMyProfile(token);
      } catch (profileErr: unknown) {
        const msg = profileErr instanceof Error ? profileErr.message.toLowerCase() : '';
        if (msg.includes('404') || msg.includes('not found')) {
          setError('Create your profile before replying to posts.');
          return;
        }
        throw profileErr;
      }

      const result = await createPost(token, {
        body: replyText.trim(),
        replyToPostId: replyToPost.id,
      });

      // Notify parent component about new reply
      onReplyCreated?.(result.post);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reply failed. Try again.');
    } finally {
      setIsPosting(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      void handleSubmitReply();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-16"
      style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 60%, transparent)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[600px] overflow-hidden rounded-2xl"
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
            aria-label="Close reply"
            type="button"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            className="rounded-full px-5 py-1.5 text-sm font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
            disabled={!canPost}
            onClick={handleSubmitReply}
            type="button"
          >
            {isPosting ? 'Replying' : 'Reply'}
          </button>
        </div>

        {/* Original Post Preview */}
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-primary)' }}>
          <div className="flex gap-3">
            {/* Avatar */}
            <div className="shrink-0">
              {replyToPost.author.avatar_url ? (
                <img
                  src={replyToPost.author.avatar_url}
                  alt={replyToPost.author.display_name}
                  className="h-8 w-8 rounded-full object-cover"
                  style={{ backgroundColor: 'var(--border-primary)' }}
                />
              ) : (
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-xs"
                  style={{ backgroundColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
                >
                  {replyToPost.author.display_name.charAt(0)}
                </div>
              )}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-sm">
                <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                  {replyToPost.author.display_name}
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  @{replyToPost.author.handle}
                </span>
              </div>
              <p className="mt-1 text-sm line-clamp-3" style={{ color: 'var(--text-primary)' }}>
                {replyToPost.content}
              </p>
            </div>
          </div>

          <div className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Replying to <span style={{ color: 'var(--accent)' }}>@{replyToPost.author.handle}</span>
          </div>
        </div>

        {/* Reply Compose */}
        <div className="px-4 pb-4 pt-3">
          <textarea
            placeholder="Post your reply"
            autoFocus
            className="w-full resize-none border-none bg-transparent text-xl outline-none placeholder:text-[var(--text-secondary)]"
            style={{ color: 'var(--text-primary)', minHeight: '120px' }}
            value={replyText}
            onChange={(event) => {
              setReplyText(event.target.value.slice(0, REPLY_MAX_CHARS));
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            maxLength={REPLY_MAX_CHARS}
            disabled={isPosting}
          />

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
