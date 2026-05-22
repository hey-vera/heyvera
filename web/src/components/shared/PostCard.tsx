import { useState } from 'react';
import type { Post } from '../../api/types';

interface PostCardProps {
  post: Post;
  onLike?: (id: string) => void;
  onRepost?: (id: string) => void;
  onBookmark?: (id: string) => void;
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

  const toggleLike = () => {
    setLiked(!liked);
    setLikeCount(liked ? likeCount - 1 : likeCount + 1);
    onLike?.(post.id);
  };

  const toggleRepost = () => {
    setReposted(!reposted);
    setRepostCount(reposted ? repostCount - 1 : repostCount + 1);
    onRepost?.(post.id);
  };

  const toggleBookmark = () => {
    setBookmarked(!bookmarked);
    onBookmark?.(post.id);
  };

  return (
    <article
      className="flex gap-3 px-4 py-3 border-b border-[#2F3336] transition-colors hover:bg-white/[0.03] cursor-pointer"
    >
      {/* Avatar */}
      <div className="shrink-0">
        {post.author.avatar_url ? (
          <img
            src={post.author.avatar_url}
            alt={post.author.display_name}
            className="w-10 h-10 rounded-full bg-[#2F3336] object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-[#2F3336] flex items-center justify-center text-sm text-[#71767B]">
            {post.author.display_name.charAt(0)}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Header: name, handle, timestamp */}
        <div className="flex items-center gap-1 text-[15px] leading-5">
          <span className="font-bold text-[#E7E9EA] truncate">
            {post.author.display_name}
          </span>
          {post.author.verified && (
            <span className="text-[#00BA7C] text-xs shrink-0">✓</span>
          )}
          <span className="text-[#71767B] truncate">@{post.author.handle}</span>
          <span className="text-[#71767B] shrink-0">·</span>
          <span className="text-[#71767B] shrink-0">{relativeTime(post.created_at)}</span>
        </div>

        {/* Body */}
        <p className="text-[15px] leading-5 text-[#E7E9EA] mt-0.5 whitespace-pre-wrap break-words">
          {post.content}
        </p>

        {/* Media */}
        {post.media && post.media.length > 0 && (
          <div className="mt-3 rounded-2xl overflow-hidden border border-[#2F3336]">
            {post.media.map((m) => (
              <img
                key={m.id}
                src={m.url}
                alt={m.alt_text ?? ''}
                className="w-full object-cover max-h-[500px] bg-[#16181C]"
              />
            ))}
          </div>
        )}

        {/* Quote post */}
        {post.quote_post && (
          <div className="mt-3 rounded-2xl border border-[#2F3336] p-3">
            <div className="flex items-center gap-1 text-[13px]">
              <span className="font-bold text-[#E7E9EA]">{post.quote_post.author.display_name}</span>
              <span className="text-[#71767B]">@{post.quote_post.author.handle}</span>
            </div>
            <p className="text-[13px] text-[#E7E9EA] mt-1 line-clamp-3">{post.quote_post.content}</p>
          </div>
        )}

        {/* Action bar */}
        <div className="flex items-center justify-between mt-3 max-w-[425px] -ml-2">
          <ActionButton
            icon="💬"
            count={post.reply_count}
            hoverColor="text-[#1D9BF0]"
            hoverBg="hover:bg-[#1D9BF0]/10"
          />
          <ActionButton
            icon="🔄"
            count={repostCount}
            active={reposted}
            activeColor="text-[#00BA7C]"
            hoverColor="text-[#00BA7C]"
            hoverBg="hover:bg-[#00BA7C]/10"
            onClick={toggleRepost}
          />
          <ActionButton
            icon={liked ? '❤️' : '🤍'}
            count={likeCount}
            active={liked}
            activeColor="text-[#F91880]"
            hoverColor="text-[#F91880]"
            hoverBg="hover:bg-[#F91880]/10"
            onClick={toggleLike}
          />
          <ActionButton
            icon="📊"
            count={post.view_count}
            hoverColor="text-[#1D9BF0]"
            hoverBg="hover:bg-[#1D9BF0]/10"
          />
          <ActionButton
            icon={bookmarked ? '🔖' : '🏷️'}
            active={bookmarked}
            activeColor="text-[#1D9BF0]"
            hoverColor="text-[#1D9BF0]"
            hoverBg="hover:bg-[#1D9BF0]/10"
            onClick={toggleBookmark}
          />
          <ActionButton
            icon="↗️"
            hoverColor="text-[#1D9BF0]"
            hoverBg="hover:bg-[#1D9BF0]/10"
          />
        </div>
      </div>
    </article>
  );
}

function ActionButton({
  icon,
  count,
  active,
  activeColor,
  hoverColor,
  hoverBg,
  onClick,
}: {
  icon: string;
  count?: number;
  active?: boolean;
  activeColor?: string;
  hoverColor?: string;
  hoverBg?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={`
        flex items-center gap-1 rounded-full p-2 transition-colors
        text-[#71767B] text-[13px]
        ${hoverBg ?? ''}
        ${hoverColor ? `hover:${hoverColor}` : ''}
        ${active && activeColor ? activeColor : ''}
        group
      `}
    >
      <span className="text-[16px] leading-none">{icon}</span>
      {count != null && count > 0 && (
        <span className={active && activeColor ? activeColor : ''}>{formatCount(count)}</span>
      )}
    </button>
  );
}
