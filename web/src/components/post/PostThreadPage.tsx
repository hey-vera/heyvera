import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { type FeedPost } from "../../api/social";
import { ComposeModal } from "../compose/ComposeModal";
import type { ShellState } from "../../hooks/useShellState";
import { useAuthContext } from "../../hooks/useAuthContext";

type PostThreadPageProps = {
  shellState: ShellState;
};

type PostNode = {
  post: FeedPost;
  replies: PostNode[];
};

async function fetchPublicFeed(): Promise<FeedPost[]> {
  const res = await fetch("/v1/feed?limit=50");
  if (!res.ok) return [];
  const data = await res.json() as { feed?: FeedPost[] };
  return data.feed ?? [];
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears >= 1) return `${diffYears} year${diffYears === 1 ? "" : "s"} ago`;
  if (diffMonths >= 1) return `${diffMonths} month${diffMonths === 1 ? "" : "s"} ago`;
  if (diffWeeks >= 1) return `${diffWeeks} week${diffWeeks === 1 ? "" : "s"} ago`;
  if (diffDays >= 1) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  if (diffHr >= 1) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  if (diffMin >= 1) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  return "just now";
}

function buildReplyTree(posts: FeedPost[], parentId: string): PostNode[] {
  return posts
    .filter((post) => post.replyToPostId === parentId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((post) => ({
      post,
      replies: buildReplyTree(posts, post.id),
    }));
}

function countReplies(nodes: PostNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countReplies(node.replies), 0);
}

function PostCard({
  post,
  isRoot = false,
  depth = 0,
  showReplyButton,
  onReply,
}: {
  post: FeedPost;
  isRoot?: boolean;
  depth?: number;
  showReplyButton: boolean;
  onReply: (postId: string) => void;
}) {
  return (
    <article
      className={`thread-post-card${isRoot ? " thread-post-card-root" : ""}`}
      data-depth={depth}
    >
      <header className="thread-post-card-header">
        <div className="thread-post-card-author">
          <strong className="thread-post-card-display-name">
            {post.author.displayName}
          </strong>
          <span className="thread-post-card-handle">@{post.author.handle}</span>
          {post.linkedAgent && (
            <span className="thread-post-card-agent">{post.linkedAgent.agentName}</span>
          )}
        </div>
        <time
          className="thread-post-card-time"
          dateTime={post.createdAt}
          title={new Date(post.createdAt).toLocaleString()}
        >
          {formatRelativeTime(post.createdAt)}
        </time>
      </header>

      <p className="thread-post-card-body">{post.body}</p>

      {showReplyButton && (
        <div className="thread-post-card-actions">
          <button
            type="button"
            className="thread-post-card-reply-button"
            onClick={() => onReply(post.id)}
          >
            Reply
          </button>
        </div>
      )}
    </article>
  );
}

function ReplyBranch({
  nodes,
  depth,
  showReplyButton,
  onReply,
}: {
  nodes: PostNode[];
  depth: number;
  showReplyButton: boolean;
  onReply: (postId: string) => void;
}) {
  if (nodes.length === 0) return null;

  return (
    <div className={`thread-reply-group thread-reply-group-depth-${depth}`}>
      {nodes.map((node) => (
        <div key={node.post.id} className="thread-reply-item">
          <div className="thread-reply-line" aria-hidden="true" />
          <div className="thread-reply-content">
            <PostCard
              post={node.post}
              depth={depth}
              showReplyButton={showReplyButton}
              onReply={onReply}
            />
            <ReplyBranch
              nodes={node.replies}
              depth={depth + 1}
              showReplyButton={showReplyButton}
              onReply={onReply}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PostThreadPage({ shellState }: PostThreadPageProps) {
  const { id: postId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { refreshCounter } = useAuthContext();

  const [loading, setLoading] = useState(true);
  const [rootPost, setRootPost] = useState<FeedPost | null>(null);
  const [replyTree, setReplyTree] = useState<PostNode[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyToPostId, setReplyToPostId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function loadThread() {
      if (!postId) {
        if (!cancelled) {
          setRootPost(null);
          setReplyTree([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);

      try {
        const feed = await fetchPublicFeed();
        if (cancelled) return;

        const matchedPost = feed.find((post) => post.id === postId) ?? null;
        setRootPost(matchedPost);
        setReplyTree(matchedPost ? buildReplyTree(feed, matchedPost.id) : []);
      } catch {
        if (!cancelled) {
          setRootPost(null);
          setReplyTree([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadThread();

    return () => {
      cancelled = true;
    };
  }, [postId, refreshCounter]);

  const canReply = shellState === "ready";
  const replyCount = countReplies(replyTree);

  function handleReply(targetPostId: string) {
    setReplyToPostId(targetPostId);
    setComposeOpen(true);
  }

  function handleCloseCompose() {
    setComposeOpen(false);
    setReplyToPostId(undefined);
  }

  if (loading) {
    return (
      <section className="thread-page" aria-busy="true">
        <button
          type="button"
          className="thread-back-button"
          onClick={() => navigate(-1)}
        >
          Back
        </button>
        <div className="thread-loading">Loading thread...</div>
      </section>
    );
  }

  if (!rootPost) {
    return (
      <section className="thread-page">
        <button
          type="button"
          className="thread-back-button"
          onClick={() => navigate(-1)}
        >
          Back
        </button>
        <div className="thread-empty-state">
          <h1 className="thread-empty-title">Post not found</h1>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="thread-page">
        <button
          type="button"
          className="thread-back-button"
          onClick={() => navigate(-1)}
        >
          Back
        </button>

        <div className="thread-root-post">
          <PostCard
            post={rootPost}
            isRoot
            showReplyButton={canReply}
            onReply={handleReply}
          />
        </div>

        <section className="thread-replies-section" aria-labelledby="thread-replies-heading">
          <div className="thread-replies-header">
            <h2 id="thread-replies-heading" className="thread-replies-title">
              Replies
            </h2>
            <span className="thread-replies-count">{replyCount}</span>
          </div>

          {replyTree.length > 0 ? (
            <ReplyBranch
              nodes={replyTree}
              depth={1}
              showReplyButton={canReply}
              onReply={handleReply}
            />
          ) : (
            <p className="thread-replies-empty">No replies yet.</p>
          )}
        </section>
      </section>

      {canReply && (
        <ComposeModal
          isOpen={composeOpen}
          onClose={handleCloseCompose}
          replyToPostId={replyToPostId}
        />
      )}
    </>
  );
}
