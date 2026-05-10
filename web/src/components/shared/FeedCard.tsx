type FeedCardOrigin = "Person" | "Agent" | "Linked Pair";

type FeedCardProps = {
  origin: FeedCardOrigin;
  authorName: string;
  authorHandle: string;
  title: string;
  body: string;
  proofContext?: string;
  branchLabel?: string;
  formatLabel?: string;
  postId?: string;
  replyToHandle?: string;
  replyCount?: number;
  linkedAgentName?: string;
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
  replyToHandle,
  replyCount,
  linkedAgentName,
}: FeedCardProps) {
  return (
    <article className={`feed-card ${originClasses[origin]}`}>
      {/* Reply indicator */}
      {replyToHandle && (
        <div className="feed-card-reply-indicator">
          Replying to @{replyToHandle}
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
        <div className="feed-card-header-chips">
          <span className={`feed-card-origin-label ${originClasses[origin]}`}>{origin}</span>
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
      <h3 className="feed-card-title">{title}</h3>
      <p className="feed-card-body">{body}</p>
      {proofContext ? (
        <div className="feed-card-proof">{proofContext}</div>
      ) : null}

      {/* Reply action slot */}
      <div className="feed-card-actions">
        <button type="button" className="feed-card-reply-action" aria-label="Reply">
          Reply
        </button>
        {replyCount != null && replyCount > 0 && (
          <span className="feed-card-reply-count">
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </span>
        )}
      </div>
    </article>
  );
}
