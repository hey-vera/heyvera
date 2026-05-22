import { useEffect, useState } from 'react';
import {
  bookmarkPost,
  createPost,
  getFeed,
  getFollowingFeed,
  likePost,
  repostPost,
  unlikePost,
} from '../api/client';
import type { Post } from '../api/types';
import { LoadingState, EmptyState, ErrorState } from '../components/shared/AsyncStates';
import { PostCard } from '../components/shared/PostCard';

const TABS = ['For you', 'Following'] as const;
type Tab = typeof TABS[number];

export function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>('For you');
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadFeed() {
      setLoading(true);
      setError(null);
      try {
        const response = activeTab === 'For you' ? await getFeed() : await getFollowingFeed();
        if (!cancelled) setPosts(response.posts);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load feed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadFeed();
    return () => {
      cancelled = true;
    };
  }, [activeTab, reloadKey]);

  const submitPost = async () => {
    const trimmed = content.trim();
    if (!trimmed || posting) return;

    setPosting(true);
    try {
      const post = await createPost(trimmed);
      setPosts((current) => [post, ...current]);
      setContent('');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="sticky top-0 z-10 flex border-b bg-black/80 backdrop-blur-md" style={{ borderColor: 'var(--border-primary)' }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-4 text-[15px] font-medium transition-colors hover:bg-white/5"
            style={{ color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          >
            <span className="relative inline-block">
              {tab}
              {activeTab === tab && (
                <span className="absolute -bottom-[17px] left-0 right-0 h-[4px] rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
              )}
            </span>
          </button>
        ))}
      </div>

      <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="flex gap-3">
          <div className="h-10 w-10 flex-shrink-0 rounded-full" style={{ backgroundColor: 'var(--border-primary)' }} />

          <div className="flex-1">
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value.slice(0, 280))}
              placeholder="What's happening?"
              rows={2}
              className="w-full resize-none bg-transparent text-[20px] leading-normal outline-none"
              style={{ color: 'var(--text-primary)' }}
            />

            <div className="mt-2 flex items-center justify-between border-t pt-2" style={{ borderColor: 'var(--border-primary)' }}>
              <span className="text-[13px]" style={{ color: content.length > 260 ? 'var(--color-danger)' : 'var(--text-secondary)' }}>
                {content.length}/280
              </span>

              <button
                type="button"
                onClick={submitPost}
                disabled={!content.trim() || posting}
                className="rounded-full px-4 py-1.5 text-[15px] font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)', color: '#000' }}
              >
                {posting ? 'Posting' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {loading && <LoadingState label="Loading feed" />}
      {!loading && error && <ErrorState detail={error} onRetry={() => setReloadKey((key) => key + 1)} />}
      {!loading && !error && posts.length === 0 && (
        <EmptyState title="No posts yet" detail="When there is activity in this feed, it will appear here." />
      )}
      {!loading && !error && posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onLike={(id, liked) => void (liked ? likePost(id) : unlikePost(id))}
          onRepost={(id) => void repostPost(id)}
          onBookmark={(id) => void bookmarkPost(id)}
        />
      ))}
    </div>
  );
}

export default HomePage;
