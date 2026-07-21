import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { bookmarkPost, createPost, feedPostToPost, fetchMyProfile, fetchSinglePost, likePost, repostPost, unbookmarkPost, unlikePost, unrepostPost } from '../api/social';
import type { FeedPost } from '../api/social';
import type { Post } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { PostCard } from '../components/shared/PostCard';
import { useAuth } from '../hooks/useAuth';

export function PostThreadPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [replies, setReplies] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const softRefreshCounts = () => setReloadKey((key) => key + 1);

  const appendOptimisticReply = (created: FeedPost) => {
    const mapped = feedPostToPost(created);
    setReplies((current) => {
      if (current.some((r) => r.id === mapped.id)) return current;
      return [...current, mapped];
    });
    setPost((current) =>
      current
        ? { ...current, reply_count: Math.max(0, (current.reply_count ?? 0) + 1) }
        : current,
    );
  };

  useEffect(() => {
    let cancelled = false;

    async function loadPost() {
      if (!id) {
        setPost(null);
        setReplies([]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const response = await fetchSinglePost(id);
        const postResponse = feedPostToPost(response.post);
        const directReplies = response.replies
          .map(feedPostToPost)
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        if (!cancelled) {
          setPost(postResponse);
          setReplies(directReplies);
        }
      } catch (err) {
        if (!cancelled) {
          setPost(null);
          setReplies([]);
          setError(err instanceof Error ? err.message : 'Unable to load post');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPost();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <header
        className="sticky top-[var(--top-bar-height)] z-10 flex h-[53px] items-center gap-6 border-b px-4 backdrop-blur-md"
        style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 80%, transparent)', borderColor: 'var(--border-primary)' }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate(-1)}
          className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full transition-colors hover-overlay"
          style={{ color: 'var(--text-primary)' }}
        >
          <ArrowLeft size={20} strokeWidth={2.25} />
        </button>
        <h1 className="text-[20px] font-bold leading-6" style={{ color: 'var(--text-primary)' }}>
          Post
        </h1>
      </header>

      {loading && <LoadingState label="Loading post" />}
      {!loading && error && <ErrorState title="Post unavailable" detail={error} onRetry={() => setReloadKey((key) => key + 1)} />}
      {!loading && !error && !post && (
        <EmptyState title="Post not found" detail="This post may have been deleted or is no longer available." />
      )}
      {!loading && !error && post && (
        <section aria-label="Post thread">
          <ThreadPost
            post={post}
            hasConnector={replies.length > 0}
            onReplyPosted={softRefreshCounts}
          />
          <InlineReplyCompose
            postId={post.id}
            authorHandle={post.author.handle}
            authEnabled={authEnabled}
            isSignedIn={isSignedIn}
            getToken={getToken}
            onReplyCreated={appendOptimisticReply}
          />
          {replies.length > 0 ? (
            replies.map((reply, index) => (
              <ThreadReply
                key={reply.id}
                post={reply}
                isLast={index === replies.length - 1}
              />
            ))
          ) : (
            <EmptyState title="No replies yet" detail="Replies to this post will appear here." />
          )}
        </section>
      )}
    </div>
  );
}

export default PostThreadPage;

interface ThreadPostProps {
  post: Post;
  hasConnector: boolean;
  onReplyPosted: () => void;
}

interface ThreadReplyProps {
  post: Post;
  isLast: boolean;
}

function ThreadPost({ post, hasConnector, onReplyPosted }: ThreadPostProps) {
  return (
    <div className="relative">
      {hasConnector && <ConnectorLine className="top-16 bottom-0" />}
      <PostCard
        post={post}
        onLike={handleLike}
        onRepost={handleRepost}
        onBookmark={handleBookmark}
        onReply={onReplyPosted}
      />
    </div>
  );
}

function ThreadReply({ post, isLast }: ThreadReplyProps) {
  return (
    <div className="relative">
      <ConnectorLine className={isLast ? 'top-0 h-9' : 'top-0 bottom-0'} />
      <PostCard post={post} onLike={handleLike} onRepost={handleRepost} onBookmark={handleBookmark} />
    </div>
  );
}

interface ConnectorLineProps {
  className: string;
}

function ConnectorLine({ className }: ConnectorLineProps) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute left-9 w-px ${className}`}
      style={{ backgroundColor: 'var(--border-secondary)' }}
    />
  );
}

function InlineReplyCompose({
  postId,
  authorHandle,
  authEnabled,
  isSignedIn,
  getToken,
  onReplyCreated,
}: {
  postId: string;
  authorHandle: string;
  authEnabled: boolean;
  isSignedIn: boolean;
  getToken: () => Promise<string | null>;
  onReplyCreated: (created: FeedPost) => void;
}) {
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canPost = text.trim().length > 0 && !posting && text.length <= 280;

  const submit = async () => {
    if (!canPost) return;
    if (!authEnabled || !isSignedIn) { setErr('Sign in to reply'); return; }
    const token = await getToken();
    if (!token) { setErr('Sign in to reply'); return; }

    setPosting(true);
    setErr(null);
    try {
      await fetchMyProfile(token);
      const result = await createPost(token, { body: text.trim(), replyToPostId: postId });
      setText('');
      // Append immediately — no full thread reload required.
      onReplyCreated(result.post);
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : '';
      if (msg.includes('404') || msg.includes('not found')) {
        setErr('Create your profile first');
      } else {
        setErr(e instanceof Error ? e.message : 'Reply failed');
      }
    } finally {
      setPosting(false);
    }
  };

  return (
    <div
      className="border-b px-4 py-3"
      style={{ borderColor: 'var(--border-primary)' }}
    >
      <div className="text-[13px] mb-2" style={{ color: 'var(--text-secondary)' }}>
        Replying to <span style={{ color: 'var(--accent)' }}>@{authorHandle}</span>
      </div>
      <div className="flex gap-3">
        <textarea
          placeholder="Post your reply"
          className="flex-1 resize-none border-none bg-transparent text-[15px] outline-none placeholder:text-[var(--text-secondary)]"
          style={{ color: 'var(--text-primary)', minHeight: '44px' }}
          value={text}
          onChange={(e) => { setText(e.target.value.slice(0, 280)); setErr(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(); }}
          maxLength={280}
          disabled={posting}
          rows={1}
        />
        <button
          type="button"
          className="self-end rounded-full px-4 py-1.5 text-sm font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
          disabled={!canPost}
          onClick={() => void submit()}
        >
          {posting ? 'Replying' : 'Reply'}
        </button>
      </div>
      {text.length > 0 && (
        <div className="mt-1 text-right text-[13px]" style={{ color: 280 - text.length <= 20 ? 'var(--color-danger)' : 'var(--text-secondary)' }}>
          {280 - text.length}
        </div>
      )}
      {err && <p className="mt-1 text-[13px]" style={{ color: 'var(--color-danger)' }}>{err}</p>}
    </div>
  );
}

function handleLike(postId: string, liked: boolean, token: string) {
  void (liked ? likePost(token, postId) : unlikePost(token, postId));
}

function handleRepost(postId: string, reposted: boolean, token: string) {
  void (reposted ? repostPost : unrepostPost)(token, postId);
}

function handleBookmark(postId: string, bookmarked: boolean, token: string) {
  void (bookmarked ? bookmarkPost(token, postId) : unbookmarkPost(token, postId));
}
