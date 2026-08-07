import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  bookmarkPost,
  createPost,
  feedPostToPost,
  fetchMyProfile,
  fetchRelatedPosts,
  fetchSinglePost,
  likePost,
  repostPost,
  unbookmarkPost,
  unlikePost,
  unrepostPost,
} from '../api/social';
import type { FeedPost } from '../api/social';
import type { Post } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { PostCard } from '../components/shared/PostCard';
import { useAuth } from '../hooks/useAuth';
import {
  buildReplyTree,
  flattenTreeForRender,
  parentHandleFor,
} from '../utils/threadTree';
import {
  shouldShowThreadCapNotice,
  THREAD_CAP_NOTICE,
} from '../utils/threadCapNotice';

export function PostThreadPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [replies, setReplies] = useState<Post[]>([]);
  const [repliesTruncated, setRepliesTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [relatedPosts, setRelatedPosts] = useState<Post[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState<string | null>(null);
  const [relatedReloadKey, setRelatedReloadKey] = useState(0);

  const softRefreshCounts = () => setReloadKey((key) => key + 1);

  const appendOptimisticReply = (created: FeedPost) => {
    const mapped = feedPostToPost(created);
    setReplies((current) => {
      if (current.some((r) => r.id === mapped.id)) return current;
      const next = [...current, mapped];
      // Bump parent reply_count when replying to a nested post.
      const parentId = mapped.reply_to;
      if (parentId && parentId !== id) {
        return next.map((r) =>
          r.id === parentId
            ? { ...r, reply_count: Math.max(0, (r.reply_count ?? 0) + 1) }
            : r,
        );
      }
      return next;
    });
    setPost((current) =>
      current
        ? { ...current, reply_count: Math.max(0, (current.reply_count ?? 0) + 1) }
        : current,
    );
    setReplyTargetId(null);
  };

  useEffect(() => {
    let cancelled = false;

    async function loadPost() {
      if (!id) {
        setPost(null);
        setReplies([]);
        setRepliesTruncated(false);
        setError(null);
        setLoading(false);
        setRelatedPosts([]);
        setRelatedError(null);
        setRelatedLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const token = authEnabled && isSignedIn ? await getToken() : null;
        const response = await fetchSinglePost(id, token);
        const postResponse = feedPostToPost(response.post);
        // Flat descendant list from BE; tree built client-side.
        const allReplies = response.replies.map(feedPostToPost);

        if (!cancelled) {
          setPost(postResponse);
          setReplies(allReplies);
          setRepliesTruncated(response.repliesTruncated === true);
          setReplyTargetId(null);
        }
      } catch (err) {
        if (!cancelled) {
          setPost(null);
          setReplies([]);
          setRepliesTruncated(false);
          setError(err instanceof Error ? err.message : 'Unable to load post');
          setRelatedPosts([]);
          setRelatedError(null);
          setRelatedLoading(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPost();
    return () => {
      cancelled = true;
    };
  }, [authEnabled, getToken, id, isSignedIn, reloadKey]);

  // Related discovery loads after the thread is available (honest heuristic, not ML).
  useEffect(() => {
    let cancelled = false;

    async function loadRelated() {
      if (!id || !post) {
        setRelatedPosts([]);
        setRelatedError(null);
        setRelatedLoading(false);
        return;
      }

      setRelatedLoading(true);
      setRelatedError(null);
      try {
        const token = authEnabled && isSignedIn ? await getToken() : null;
        const response = await fetchRelatedPosts(id, 8, token);
        if (!cancelled) {
          setRelatedPosts((response.posts ?? []).map(feedPostToPost));
        }
      } catch (err) {
        if (!cancelled) {
          setRelatedPosts([]);
          setRelatedError(
            err instanceof Error ? err.message : 'Unable to load related posts',
          );
        }
      } finally {
        if (!cancelled) setRelatedLoading(false);
      }
    }

    void loadRelated();
    return () => {
      cancelled = true;
    };
  }, [authEnabled, getToken, id, isSignedIn, post?.id, relatedReloadKey]);

  const repliesById = useMemo(() => {
    const map = new Map<string, Post>();
    for (const r of replies) map.set(r.id, r);
    return map;
  }, [replies]);

  const flattenedReplies = useMemo(() => {
    if (!id || replies.length === 0) return [];
    const tree = buildReplyTree(replies, id);
    return flattenTreeForRender(tree);
  }, [id, replies]);

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
      {!loading && !error && post && id && (
        <section aria-label="Post thread">
          <ThreadPost
            post={post}
            hasConnector={replies.length > 0}
            onReplyPosted={softRefreshCounts}
            onDelete={() => {
              // Root deleted — leave the thread view.
              navigate(-1);
            }}
          />
          {/* Root-level compose always available (targets root post). */}
          <InlineReplyCompose
            postId={post.id}
            authorHandle={post.author.handle}
            authEnabled={authEnabled}
            isSignedIn={isSignedIn}
            getToken={getToken}
            onReplyCreated={appendOptimisticReply}
          />
          {flattenedReplies.length > 0 ? (
            flattenedReplies.map((item) => {
              const parentHandle = parentHandleFor(
                item.post.reply_to,
                id,
                post.author.handle,
                repliesById,
              );
              const showReplyingTo =
                Boolean(item.post.reply_to) && item.post.reply_to !== id && parentHandle;

              return (
                <div key={item.post.id}>
                  <ThreadReply
                    post={item.post}
                    visualDepth={item.visualDepth}
                    isLast={item.isLastSibling}
                    replyingToHandle={showReplyingTo ? parentHandle : null}
                    onReplyPosted={() => {
                      // PostCard modal reply → soft reload to pick up nested placement.
                      softRefreshCounts();
                    }}
                    onFocusInlineReply={() =>
                      setReplyTargetId((cur) => (cur === item.post.id ? null : item.post.id))
                    }
                    onDelete={(deletedId) => {
                      setReplies((current) => current.filter((r) => r.id !== deletedId));
                      setReplyTargetId((cur) => (cur === deletedId ? null : cur));
                    }}
                  />
                  {replyTargetId === item.post.id && (
                    <div style={{ paddingLeft: `${Math.min(item.visualDepth + 1, 4) * 12}px` }}>
                      <InlineReplyCompose
                        postId={item.post.id}
                        authorHandle={item.post.author.handle}
                        authEnabled={authEnabled}
                        isSignedIn={isSignedIn}
                        getToken={getToken}
                        onReplyCreated={appendOptimisticReply}
                        onCancel={() => setReplyTargetId(null)}
                      />
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <EmptyState title="No replies yet" detail="Replies to this post will appear here." />
          )}
          {/* Honest cap notice only — no fake Show more / pagination. */}
          {shouldShowThreadCapNotice(repliesTruncated) && (
            <div
              role="status"
              className="border-b px-4 py-4 text-center"
              style={{ borderColor: 'var(--border-primary)' }}
            >
              <p className="text-[14px] leading-5" style={{ color: 'var(--text-secondary)' }}>
                {THREAD_CAP_NOTICE}
              </p>
            </div>
          )}

          {/* Related: shared hashtags + same author + recency (not AI/ML). */}
          <section
            aria-label="Related posts"
            className="border-t"
            style={{ borderColor: 'var(--border-primary)' }}
          >
            <div className="px-4 py-3">
              <h2 className="text-[17px] font-bold leading-5" style={{ color: 'var(--text-primary)' }}>
                Related
              </h2>
              <p className="mt-1 text-[13px] leading-4" style={{ color: 'var(--text-secondary)' }}>
                Similar posts by shared tags and the same author.
              </p>
            </div>
            {relatedLoading && <LoadingState label="Loading related posts" />}
            {!relatedLoading && relatedError && (
              <ErrorState
                title="Related posts unavailable"
                detail={relatedError}
                onRetry={() => setRelatedReloadKey((key) => key + 1)}
              />
            )}
            {!relatedLoading && !relatedError && relatedPosts.length === 0 && (
              <EmptyState
                title="No related posts yet"
                detail="When more posts share tags or come from this author, they will show up here."
              />
            )}
            {!relatedLoading &&
              !relatedError &&
              relatedPosts.map((related) => (
                <PostCard
                  key={related.id}
                  post={related}
                  onLike={handleLike}
                  onRepost={handleRepost}
                  onBookmark={handleBookmark}
                />
              ))}
          </section>
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
  onDelete?: (id: string) => void;
}

interface ThreadReplyProps {
  post: Post;
  visualDepth: number;
  isLast: boolean;
  replyingToHandle: string | null;
  onReplyPosted: () => void;
  onFocusInlineReply: () => void;
  onDelete?: (id: string) => void;
}

function ThreadPost({ post, hasConnector, onReplyPosted, onDelete }: ThreadPostProps) {
  return (
    <div className="relative">
      {hasConnector && <ConnectorLine className="top-16 bottom-0" />}
      <PostCard
        post={post}
        onLike={handleLike}
        onRepost={handleRepost}
        onBookmark={handleBookmark}
        onReply={onReplyPosted}
        onDelete={onDelete}
      />
    </div>
  );
}

function ThreadReply({
  post,
  visualDepth,
  isLast,
  replyingToHandle,
  onReplyPosted,
  onFocusInlineReply,
  onDelete,
}: ThreadReplyProps) {
  const pad = visualDepth * 12;
  return (
    <div className="relative" style={{ paddingLeft: `${pad}px` }}>
      {visualDepth === 0 && (
        <ConnectorLine className={isLast ? 'top-0 h-9' : 'top-0 bottom-0'} />
      )}
      {replyingToHandle && (
        <div
          className="px-4 pt-2 text-[13px]"
          style={{ color: 'var(--text-secondary)' }}
        >
          Replying to <span style={{ color: 'var(--accent)' }}>@{replyingToHandle}</span>
        </div>
      )}
      {/* Inline target control — PostCard also has modal reply; both valid. */}
      <div className="flex justify-end px-4 pt-1">
        <button
          type="button"
          className="text-[12px] font-medium"
          style={{ color: 'var(--accent)' }}
          onClick={onFocusInlineReply}
        >
          Reply here
        </button>
      </div>
      <PostCard
        post={post}
        onLike={handleLike}
        onRepost={handleRepost}
        onBookmark={handleBookmark}
        onReply={onReplyPosted}
        onDelete={onDelete}
      />
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
  onCancel,
}: {
  postId: string;
  authorHandle: string;
  authEnabled: boolean;
  isSignedIn: boolean;
  getToken: () => Promise<string | null>;
  onReplyCreated: (created: FeedPost) => void;
  onCancel?: () => void;
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
      // Append immediately under the correct parent via replyToPostId.
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
      <div className="flex items-center justify-between text-[13px] mb-2" style={{ color: 'var(--text-secondary)' }}>
        <span>
          Replying to <span style={{ color: 'var(--accent)' }}>@{authorHandle}</span>
        </span>
        {onCancel && (
          <button
            type="button"
            className="text-[13px] font-medium"
            style={{ color: 'var(--text-secondary)' }}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
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
  return liked ? likePost(token, postId) : unlikePost(token, postId);
}

function handleRepost(postId: string, reposted: boolean, token: string) {
  return (reposted ? repostPost : unrepostPost)(token, postId);
}

function handleBookmark(postId: string, bookmarked: boolean, token: string) {
  return bookmarked ? bookmarkPost(token, postId) : unbookmarkPost(token, postId);
}
