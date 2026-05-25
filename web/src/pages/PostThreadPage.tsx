import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { feedPostToPost, fetchHomeFeed } from '../api/social';
import type { Post } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { PostCard } from '../components/shared/PostCard';

export function PostThreadPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [replies, setReplies] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
        const response = await fetchHomeFeed(50);
        const allPosts = response.feed.map(feedPostToPost);
        const postResponse = allPosts.find((p) => p.id === id) ?? null;

        if (!postResponse) {
          if (!cancelled) {
            setPost(null);
            setReplies([]);
            setError(null);
          }
          return;
        }

        const directReplies = allPosts
          .filter((feedPost) => feedPost.reply_to === postResponse.id && feedPost.id !== postResponse.id)
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
        className="sticky top-[var(--top-bar-height)] z-10 flex h-[53px] items-center gap-6 border-b px-4 backdrop-blur-md lg:top-0"
        style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 80%, transparent)', borderColor: 'var(--border-primary)' }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate(-1)}
          className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/10"
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
          <ThreadPost post={post} hasConnector={replies.length > 0} />
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
}

interface ThreadReplyProps {
  post: Post;
  isLast: boolean;
}

function ThreadPost({ post, hasConnector }: ThreadPostProps) {
  return (
    <div className="relative">
      {hasConnector && <ConnectorLine className="top-16 bottom-0" />}
      <PostCard post={post} onLike={handleLike} onRepost={handleRepost} onBookmark={handleBookmark} />
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

function handleLike(_postId: string, _liked: boolean, _token: string) {
  console.warn('[PostThreadPage] like/unlike interaction endpoint not yet available');
}

function handleRepost(_postId: string, _reposted: boolean, _token: string) {
  console.warn('[PostThreadPage] repost interaction endpoint not yet available');
}

function handleBookmark(_postId: string, _bookmarked: boolean, _token: string) {
  console.warn('[PostThreadPage] bookmark interaction endpoint not yet available');
}
