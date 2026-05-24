import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  bookmarkPost,
  getPost,
  likePost,
  repostPost,
  unlikePost,
} from '../api/client';
import type { Post } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { PostCard } from '../components/shared/PostCard';

export function PostThreadPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadPost() {
      if (!id) {
        setPost(null);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const response = await getPost(id);
        if (!cancelled) setPost(response);
      } catch (err) {
        if (!cancelled) {
          setPost(null);
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
        className="sticky top-0 z-10 flex h-[53px] items-center gap-6 border-b px-4 backdrop-blur-md"
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
        <PostCard
          post={post}
          onLike={(postId, liked) => void (liked ? likePost(postId) : unlikePost(postId))}
          onRepost={(postId) => void repostPost(postId)}
          onBookmark={(postId) => void bookmarkPost(postId)}
        />
      )}
    </div>
  );
}

export default PostThreadPage;
