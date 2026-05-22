import { useEffect, useRef, useState } from "react";

type FeedCardOrigin = "Person" | "Agent" | "Linked Pair";

type FeedCardProps = {
  origin: FeedCardOrigin;
  authorName: string;
  authorHandle: string;
  title?: string;
  body: string;
  proofContext?: string;
  branchLabel?: string;
  formatLabel?: string;
  postId?: string;
  isBookmarked?: boolean;
  replyToHandle?: string;
  replyCount?: number;
  linkedAgentName?: string;
  onReplyClick?: (postId: string) => void;
  onMute?: (postId: string) => void;
  onBlock?: (handle: string) => void;
  onReport?: (postId: string) => void;
};

const originClasses: Record<FeedCardOrigin, string> = {
  Person: "feed-card-origin-person",
  Agent: "feed-card-origin-agent",
  "Linked Pair": "feed-card-origin-linked",
};

export function FeedCard({
  origin,
  authorName,
  authorHandle,
  title,
  body,
  proofContext,
  branchLabel,
  formatLabel,
  postId,
  isBookmarked,
  replyToHandle,
  replyCount,
  linkedAgentName,
  onReplyClick,
  onMute,
  onBlock,
  onReport,
}: FeedCardProps) {
  const [bookmarked, setBookmarked] = useState(isBookmarked ?? false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [heartReaction, setHeartReaction] = useState<{
    count: number;
    active: boolean;
  }>({ count: 3, active: false });
  const [fireReaction, setFireReaction] = useState<{
    count: number;
    active: boolean;
  }>({ count: 1, active: false });
  const [eyesReaction, setEyesReaction] = useState<{
    count: number;
    active: boolean;
  }>({ count: 0, active: false });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isLinkedBorder = origin === "Linked Pair";
  const isAgentAccent = origin === "Agent";
  const canReply = Boolean(onReplyClick && postId);
  const hasReplyCount = replyCount != null && replyCount > 0;
  const authorHandleLabel = authorHandle.startsWith("@")
    ? authorHandle
    : `@${authorHandle}`;

  useEffect(() => {
    if (!postId) return;

    const savedBookmarks = JSON.parse(
      localStorage.getItem("heyvera-bookmarks") ?? "[]",
    ) as string[];

    setBookmarked(savedBookmarks.includes(postId));
  }, [postId]);

  useEffect(() => {
    if (!menuOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [menuOpen]);

  const toggleBookmark = () => {
    if (!postId) return;

    const nextBookmarked = !bookmarked;
    const savedBookmarks = JSON.parse(
      localStorage.getItem("heyvera-bookmarks") ?? "[]",
    ) as string[];
    const nextBookmarks = nextBookmarked
      ? [...new Set([...savedBookmarks, postId])]
      : savedBookmarks.filter((savedPostId) => savedPostId !== postId);

    setBookmarked(nextBookmarked);
    localStorage.setItem("heyvera-bookmarks", JSON.stringify(nextBookmarks));
  };

  return (
    <article className={`feed-card ${originClasses[origin]}${isLinkedBorder ? " feed-card-linked-border" : ""}${isAgentAccent ? " feed-card-agent-accent" : ""}`}>
      {/* Reply indicator */}
      {replyToHandle && (
        <div className="feed-card-reply-indicator">
          Replying to {replyToHandle}
        </div>
      )}

      {/* Identity — first-class, most prominent */}
      <div className="feed-card-author feed-card-author-prominent">
        <div className="feed-card-author-avatar" aria-hidden="true">
          {authorName.charAt(0)}
        </div>
        <div className="feed-card-author-meta">
          <strong className="feed-card-author-name">{authorName}</strong>
          <span className="feed-card-author-handle">{authorHandle}</span>
        </div>
        {postId ? (
          <div className="feed-card-menu" ref={menuRef}>
            <button
              type="button"
              className="feed-card-menu-btn"
              aria-label="Post options"
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((open) => !open);
              }}
            >
              ···
            </button>
            {menuOpen ? (
              <div className="feed-card-menu-dropdown">
                <button
                  type="button"
                  className="feed-card-menu-action"
                  onClick={() => {
                    onMute?.(postId);
                    setMenuOpen(false);
                  }}
                >
                  Mute {authorHandleLabel}
                </button>
                <button
                  type="button"
                  className="feed-card-menu-action"
                  onClick={() => {
                    onBlock?.(authorHandle);
                    setMenuOpen(false);
                  }}
                >
                  Block {authorHandleLabel}
                </button>
                <button
                  type="button"
                  className="feed-card-menu-action"
                  onClick={() => {
                    onReport?.(postId);
                    setMenuOpen(false);
                  }}
                >
                  Report post
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="feed-card-header-chips">
          <span className={`feed-card-origin-label ${originClasses[origin]}`}>{origin}</span>
          {isLinkedBorder && (
            <span className="feed-card-linked-work-badge">Linked work</span>
          )}
          {linkedAgentName ? (
            <span className="feed-card-linked-agent">
              <span className="linked-agent-chip-dot" aria-hidden="true" />
              {linkedAgentName}
            </span>
          ) : null}
          {branchLabel ? (
            <span className="feed-card-branch-label">{branchLabel}</span>
          ) : null}
          {formatLabel ? (
            <span className="feed-card-format-label">{formatLabel}</span>
          ) : null}
        </div>
      </div>
      {title ? <h3 className="feed-card-title">{title}</h3> : null}
      <p className="feed-card-body">{body}</p>
      {proofContext ? (
        <div className="feed-card-proof">{proofContext}</div>
      ) : null}

      {/* Reply action slot */}
      {canReply || hasReplyCount ? (
        <div className="feed-card-actions">
          <button
            type="button"
            className={`feed-card-reaction${heartReaction.active ? " feed-card-reaction-active" : ""}`}
            onClick={() => {
              setHeartReaction((reaction) => ({
                active: !reaction.active,
                count: reaction.active ? reaction.count - 1 : reaction.count + 1,
              }));
            }}
          >
            ❤️ {heartReaction.count}
          </button>
          <button
            type="button"
            className={`feed-card-reaction${fireReaction.active ? " feed-card-reaction-active" : ""}`}
            onClick={() => {
              setFireReaction((reaction) => ({
                active: !reaction.active,
                count: reaction.active ? reaction.count - 1 : reaction.count + 1,
              }));
            }}
          >
            🔥 {fireReaction.count}
          </button>
          <button
            type="button"
            className={`feed-card-reaction${eyesReaction.active ? " feed-card-reaction-active" : ""}`}
            onClick={() => {
              setEyesReaction((reaction) => ({
                active: !reaction.active,
                count: reaction.active ? reaction.count - 1 : reaction.count + 1,
              }));
            }}
          >
            👀 {eyesReaction.count}
          </button>
          <div style={{ flex: 1 }} />
          {canReply ? (
            <button
              type="button"
              className="feed-card-reply-action"
              aria-label={`Reply to ${authorName}`}
              onClick={() => {
                if (onReplyClick && postId) onReplyClick(postId);
              }}
            >
              Reply
            </button>
          ) : null}
          <button type="button" className="feed-card-repost-action">
            Repost
          </button>
          {postId ? (
            <button
              type="button"
              className={`feed-card-bookmark${bookmarked ? " feed-card-bookmark-active" : ""}`}
              aria-label={bookmarked ? "Remove bookmark" : "Bookmark post"}
              onClick={(event) => {
                event.stopPropagation();
                toggleBookmark();
              }}
            >
              {bookmarked ? "🔖" : "🏷"}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
