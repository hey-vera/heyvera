import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bookmark,
  Copy,
  Heart,
  Link,
  MessageCircle,
  Quote,
  Repeat2,
  Share,
} from 'lucide-react';
import type { Post } from '../../api/types';

interface PostCardProps {
  post: Post;
  onLike?: (id: string, liked: boolean) => void;
  onRepost?: (id: string, reposted: boolean) => void;
  onBookmark?: (id: string, bookmarked: boolean) => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatCount(n: number): string {
  if (n === 0) return '';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function PostCard({ post, onLike, onRepost, onBookmark }: PostCardProps) {
  const [liked, setLiked] = useState(post.liked);
  const [reposted, setReposted] = useState(post.reposted);
  const [bookmarked, setBookmarked] = useState(post.bookmarked);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [repostCount, setRepostCount] = useState(post.repost_count);
  const [likeAnimating, setLikeAnimating] = useState(false);
  const [openMenu, setOpenMenu] = useState<'repost' | 'share' | null>(null);
  const likeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (likeTimerRef.current != null) {
        window.clearTimeout(likeTimerRef.current);
      }
    };
  }, []);

  const toggleLike = () => {
    const nextLiked = !liked;
    setLiked(nextLiked);
    setLikeCount((count) => Math.max(0, nextLiked ? count + 1 : count - 1));
    if (nextLiked) {
      setLikeAnimating(true);
      if (likeTimerRef.current != null) {
        window.clearTimeout(likeTimerRef.current);
      }
      likeTimerRef.current = window.setTimeout(() => setLikeAnimating(false), 180);
    }
    onLike?.(post.id, nextLiked);
  };

  const toggleRepost = () => {
    const nextReposted = !reposted;
    setReposted(nextReposted);
    setRepostCount((count) => Math.max(0, nextReposted ? count + 1 : count - 1));
    setOpenMenu(null);
    onRepost?.(post.id, nextReposted);
  };

  const toggleBookmark = () => {
    const nextBookmarked = !bookmarked;
    setBookmarked(nextBookmarked);
    onBookmark?.(post.id, nextBookmarked);
  };

  const copyPostLink = () => {
    setOpenMenu(null);
    if (typeof window === 'undefined' || !navigator.clipboard) return;
    const postUrl = new URL(`/post/${post.id}`, window.location.origin).toString();
    void navigator.clipboard.writeText(postUrl);
  };

  const sharePost = () => {
    setOpenMenu(null);
    if (typeof window === 'undefined' || !navigator.share) return;
    const postUrl = new URL(`/post/${post.id}`, window.location.origin).toString();
    void navigator.share({
      title: `${post.author.display_name} on HeyVera`,
      text: post.content,
      url: postUrl,
    });
  };

  return (
    <article
      className="flex cursor-pointer gap-3 border-b px-4 py-3 transition-colors hover:bg-white/[0.03]"
      style={{ borderColor: 'var(--border-primary)' }}
    >
      {/* Avatar */}
      <div className="shrink-0">
        {post.author.avatar_url ? (
          <img
            src={post.author.avatar_url}
            alt={post.author.display_name}
            className="h-10 w-10 rounded-full object-cover"
            style={{ backgroundColor: 'var(--border-primary)' }}
          />
        ) : (
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full text-sm"
            style={{ backgroundColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
          >
            {post.author.display_name.charAt(0)}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Header: name, handle, timestamp */}
        <div className="flex items-center gap-1 text-[15px] leading-5">
          <span className="truncate font-bold" style={{ color: 'var(--text-primary)' }}>
            {post.author.display_name}
          </span>
          {post.author.verified && (
            <span className="shrink-0 text-xs" style={{ color: 'var(--accent)' }}>✓</span>
          )}
          <span className="truncate" style={{ color: 'var(--text-secondary)' }}>@{post.author.handle}</span>
          <span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>·</span>
          <span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{relativeTime(post.created_at)}</span>
        </div>

        {/* Body */}
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-5" style={{ color: 'var(--text-primary)' }}>
          {post.content}
        </p>

        {/* Media */}
        {post.media && post.media.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border-primary)' }}>
            {post.media.map((m) => (
              <img
                key={m.id}
                src={m.url}
                alt={m.alt_text ?? ''}
                className="max-h-[500px] w-full object-cover"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              />
            ))}
          </div>
        )}

        {/* Quote post */}
        {post.quote_post && (
          <div className="mt-3 rounded-2xl border p-3" style={{ borderColor: 'var(--border-primary)' }}>
            <div className="flex items-center gap-1 text-[13px]">
              <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{post.quote_post.author.display_name}</span>
              <span style={{ color: 'var(--text-secondary)' }}>@{post.quote_post.author.handle}</span>
            </div>
            <p className="mt-1 line-clamp-3 text-[13px]" style={{ color: 'var(--text-primary)' }}>{post.quote_post.content}</p>
          </div>
        )}

        {/* Action bar */}
        <div className="flex items-center justify-between mt-3 max-w-[425px] -ml-2">
          <ActionButton
            icon={MessageCircle}
            label="Reply"
            count={post.reply_count}
            color="reply"
          />
          <DropdownAction
            icon={Repeat2}
            label="Repost"
            count={repostCount}
            active={reposted}
            color="repost"
            open={openMenu === 'repost'}
            onToggle={() => setOpenMenu((menu) => (menu === 'repost' ? null : 'repost'))}
            onClose={() => setOpenMenu(null)}
          >
            <MenuItem icon={Repeat2} label={reposted ? 'Undo repost' : 'Repost'} onClick={toggleRepost} />
            <MenuItem icon={Quote} label="Quote" onClick={() => setOpenMenu(null)} />
          </DropdownAction>
          <ActionButton
            icon={Heart}
            label="Like"
            count={likeCount}
            active={liked}
            color="like"
            onClick={toggleLike}
            animate={likeAnimating}
          />
          <ActionButton
            icon={BarChart3}
            label="Views"
            count={post.view_count}
            color="reply"
          />
          <ActionButton
            icon={Bookmark}
            label="Bookmark"
            active={bookmarked}
            color="reply"
            onClick={toggleBookmark}
          />
          <DropdownAction
            icon={Share}
            label="Share"
            color="reply"
            open={openMenu === 'share'}
            onToggle={() => setOpenMenu((menu) => (menu === 'share' ? null : 'share'))}
            onClose={() => setOpenMenu(null)}
          >
            <MenuItem icon={Copy} label="Copy link" onClick={copyPostLink} />
            <MenuItem icon={Link} label="Share" onClick={sharePost} />
          </DropdownAction>
        </div>
      </div>
    </article>
  );
}

function ActionButton({
  icon,
  label,
  count,
  active,
  color,
  onClick,
  animate,
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  active?: boolean;
  color: 'reply' | 'repost' | 'like';
  onClick?: () => void;
  animate?: boolean;
}) {
  const Icon = icon;
  const activeColor =
    color === 'like'
      ? 'var(--color-like)'
      : color === 'repost'
        ? 'var(--color-repost)'
        : 'var(--color-reply)';
  const style = {
    color: active ? activeColor : 'var(--text-secondary)',
    '--action-color': activeColor,
  } as CSSProperties;

  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className="group flex items-center gap-1 rounded-full p-2 text-[13px] transition-colors duration-150 hover:bg-[color:color-mix(in_srgb,var(--action-color)_10%,transparent)] hover:text-[var(--action-color)] focus-visible:bg-[color:color-mix(in_srgb,var(--action-color)_10%,transparent)] focus-visible:text-[var(--action-color)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--action-color)]"
      style={style}
    >
      <span
        className={`relative flex h-[18px] w-[18px] items-center justify-center transition-transform duration-150 ${animate ? 'scale-125' : 'scale-100'}`}
      >
        {animate && (
          <span className="absolute inset-0 rounded-full bg-[var(--color-like)] opacity-20 transition-opacity duration-150" />
        )}
        <Icon size={18} strokeWidth={2} fill={active && color === 'like' ? 'currentColor' : 'none'} />
      </span>
      {count != null && count > 0 && (
        <span className="min-w-[1ch] transition-colors duration-150">{formatCount(count)}</span>
      )}
    </button>
  );
}

function DropdownAction({
  icon,
  label,
  count,
  active,
  color,
  open,
  onToggle,
  onClose,
  children,
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  active?: boolean;
  color: 'reply' | 'repost' | 'like';
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <ActionButton
        icon={icon}
        label={label}
        count={count}
        active={active}
        color={color}
        onClick={onToggle}
      />
      {open && (
        <div
          className="absolute left-0 z-20 mt-1 min-w-40 overflow-hidden rounded-lg border py-1 shadow-xl"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            borderColor: 'var(--border-primary)',
            color: 'var(--text-primary)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  const Icon = icon;

  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 px-4 py-2 text-left text-[15px] transition-colors duration-150 hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon size={18} strokeWidth={2} />
      <span>{label}</span>
    </button>
  );
}
