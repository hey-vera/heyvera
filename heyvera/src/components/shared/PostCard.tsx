import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bookmark,
  Copy,
  Flag,
  Heart,
  Link,
  LogIn,
  MessageCircle,
  MoreHorizontal,
  Quote,
  Repeat2,
  Share,
  ShieldOff,
  UserRound,
  VolumeX,
  X,
} from 'lucide-react';
import { SignInButton } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { blockUser, fetchMyProfile, muteUser, reportContent } from '../../api/social';
import type { Post } from '../../api/types';
import { useAuth } from '../../hooks/useAuth';
import { QuoteCompose } from './QuoteCompose';
import { ReplyCompose } from './ReplyCompose';
import { extractFirstUrl, LinkPreviewCard, renderRichText } from '../../utils/richText';

interface PostCardProps {
  post: Post;
  onLike?: (id: string, liked: boolean, token: string) => void;
  onRepost?: (id: string, reposted: boolean, token: string) => void;
  onBookmark?: (id: string, bookmarked: boolean, token: string) => void;
  onReply?: () => void;
}

type AuthPrompt = 'signin' | 'profile' | 'unconfigured' | 'error' | null;

const clerkConfigured = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

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

export function PostCard({ post, onLike, onRepost, onBookmark, onReply }: PostCardProps) {
  const navigate = useNavigate();
  const { authEnabled, isSignedIn, getToken, userId } = useAuth();
  const [liked, setLiked] = useState(post.liked);
  const [reposted, setReposted] = useState(post.reposted);
  const [bookmarked, setBookmarked] = useState(post.bookmarked);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [repostCount, setRepostCount] = useState(post.repost_count);
  const [likeAnimating, setLikeAnimating] = useState(false);
  const [openMenu, setOpenMenu] = useState<'repost' | 'share' | 'more' | null>(null);
  const [authPrompt, setAuthPrompt] = useState<AuthPrompt>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(false);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const likeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (likeTimerRef.current != null) {
        window.clearTimeout(likeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setHasProfile(null);
    setAuthPrompt(null);
    setAuthMessage(null);
  }, [authEnabled, isSignedIn, userId]);

  const ensureCanMutate = async (): Promise<string | null> => {
    setAuthMessage(null);

    if (!authEnabled || !clerkConfigured) {
      setAuthPrompt('unconfigured');
      return null;
    }

    if (!isSignedIn) {
      setAuthPrompt('signin');
      return null;
    }

    const token = await getToken();
    if (!token) {
      setAuthPrompt('signin');
      return null;
    }

    if (hasProfile === true) return token;
    if (hasProfile === false) {
      setAuthPrompt('profile');
      return null;
    }

    setCheckingAuth(true);
    try {
      await fetchMyProfile(token);
      setHasProfile(true);
      setAuthPrompt(null);
      return token;
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('404') || msg.includes('not found')) {
        setHasProfile(false);
        setAuthPrompt('profile');
        return null;
      }
      setAuthPrompt('error');
      setAuthMessage(err instanceof Error ? err.message : 'Unable to verify your profile.');
      return null;
    } finally {
      setCheckingAuth(false);
    }
  };

  const toggleLike = async () => {
    const token = await ensureCanMutate();
    if (!token) return;
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
    onLike?.(post.id, nextLiked, token);
  };

  const toggleRepost = async () => {
    const token = await ensureCanMutate();
    if (!token) {
      setOpenMenu(null);
      return;
    }
    const nextReposted = !reposted;
    setReposted(nextReposted);
    setRepostCount((count) => Math.max(0, nextReposted ? count + 1 : count - 1));
    setOpenMenu(null);
    onRepost?.(post.id, nextReposted, token);
  };

  const toggleBookmark = async () => {
    const token = await ensureCanMutate();
    if (!token) return;
    const nextBookmarked = !bookmarked;
    setBookmarked(nextBookmarked);
    onBookmark?.(post.id, nextBookmarked, token);
  };

  const gateReply = async () => {
    const token = await ensureCanMutate();
    if (!token) return;
    setReplyOpen(true);
  };

  const gateQuote = async () => {
    setOpenMenu(null);
    const token = await ensureCanMutate();
    if (!token) return;
    setQuoteOpen(true);
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

  const handleBlock = async () => {
    setOpenMenu(null);
    const token = await ensureCanMutate();
    if (!token) return;
    void blockUser(token, post.author.id);
  };

  const handleMute = async () => {
    setOpenMenu(null);
    const token = await ensureCanMutate();
    if (!token) return;
    void muteUser(token, post.author.id);
  };

  const handleReport = async () => {
    setOpenMenu(null);
    const token = await ensureCanMutate();
    if (!token) return;
    void reportContent(token, { targetType: 'post', targetId: post.id, reason: 'user_reported' });
  };

  return (
    <article
      className="relative flex cursor-pointer gap-3 border-b px-4 py-3 transition-colors hover-overlay"
      style={{ borderColor: 'var(--border-primary)' }}
    >
      {/* Avatar */}
      <button
        type="button"
        className="shrink-0"
        onClick={() => navigate(`/profile/${post.author.handle}`)}
        style={{ background: 'transparent', border: 'none', padding: 0 }}
      >
        {post.author.avatar_url ? (
          <img
            src={post.author.avatar_url}
            alt={post.author.display_name}
            className="h-10 w-10 rounded-full object-cover hover:brightness-90 transition-all"
            style={{ backgroundColor: 'var(--border-primary)' }}
          />
        ) : (
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full text-sm hover:brightness-90 transition-all"
            style={{ backgroundColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
          >
            {post.author.display_name.charAt(0)}
          </div>
        )}
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Header: name, handle, timestamp */}
        <div className="flex items-center gap-1 text-[15px] leading-5">
          <button
            type="button"
            className="truncate font-bold hover:underline"
            style={{ color: 'var(--text-primary)', background: 'transparent', border: 'none', padding: 0 }}
            onClick={() => navigate(`/profile/${post.author.handle}`)}
          >
            {post.author.display_name}
          </button>
          {post.author.verified && (
            <span className="shrink-0 text-xs" style={{ color: 'var(--accent)' }}>✓</span>
          )}
          <button
            type="button"
            className="truncate hover:underline"
            style={{ color: 'var(--text-secondary)', background: 'transparent', border: 'none', padding: 0 }}
            onClick={() => navigate(`/profile/${post.author.handle}`)}
          >
            @{post.author.handle}
          </button>
          <span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>·</span>
          <span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{relativeTime(post.created_at)}</span>
          <div className="ml-auto relative">
            <DropdownAction
              icon={MoreHorizontal}
              label="More"
              color="reply"
              open={openMenu === 'more'}
              onToggle={() => setOpenMenu((m) => (m === 'more' ? null : 'more'))}
              onClose={() => setOpenMenu(null)}
            >
              <MenuItem icon={VolumeX} label={`Mute @${post.author.handle}`} onClick={handleMute} />
              <MenuItem icon={ShieldOff} label={`Block @${post.author.handle}`} onClick={handleBlock} />
              <MenuItem icon={Flag} label="Report post" onClick={handleReport} />
            </DropdownAction>
          </div>
        </div>

        {/* Body */}
        <button
          type="button"
          className="mt-0.5 w-full text-left whitespace-pre-wrap break-words text-[15px] leading-5 hover:bg-opacity-5 hover:bg-gray-500 rounded p-1 -m-1 transition-colors"
          style={{ color: 'var(--text-primary)', background: 'transparent', border: 'none' }}
          onClick={() => navigate(`/post/${post.id}`)}
        >
          {renderRichText(post.content)}
        </button>

        {/* Reply-to indicator */}
        {post.reply_to && (
          <div className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            Replying to a post
          </div>
        )}

        {/* Link preview */}
        {!post.media?.length && (() => {
          const url = extractFirstUrl(post.content);
          return url ? <LinkPreviewCard url={url} /> : null;
        })()}

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
            onClick={gateReply}
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
            <MenuItem icon={Quote} label="Quote" onClick={gateQuote} />
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
          {/* Hide views UI when missing/zero — no vanity zeros. */}
          {post.view_count != null && post.view_count > 0 ? (
            <ActionButton
              icon={BarChart3}
              label="Views"
              count={post.view_count}
              color="reply"
            />
          ) : null}
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
      {authPrompt && (
        <SocialAuthPrompt
          prompt={authPrompt}
          message={authMessage}
          checking={checkingAuth}
          onClose={() => setAuthPrompt(null)}
        />
      )}

      {replyOpen && (
        <ReplyCompose
          replyToPost={post}
          onClose={() => setReplyOpen(false)}
          onReplyCreated={() => {
            setReplyOpen(false);
            onReply?.();
          }}
        />
      )}

      {quoteOpen && (
        <QuoteCompose
          quotedPost={post}
          onClose={() => setQuoteOpen(false)}
          onQuoteCreated={() => setQuoteOpen(false)}
        />
      )}
    </article>
  );
}

function SocialAuthPrompt({
  prompt,
  message,
  checking,
  onClose,
}: {
  prompt: Exclude<AuthPrompt, null>;
  message: string | null;
  checking: boolean;
  onClose: () => void;
}) {
  const profileHref = '/profile';
  const title =
    prompt === 'profile'
      ? 'Create your Vera profile'
      : prompt === 'unconfigured'
        ? 'Sign-in is not configured'
        : prompt === 'error'
          ? 'Could not verify profile'
          : 'Sign in to keep going';
  const body =
    prompt === 'profile'
      ? 'Create a profile before replying, reposting, liking, or bookmarking.'
      : prompt === 'unconfigured'
        ? 'Sign-in is unavailable in this environment. Open your profile when auth is configured.'
        : prompt === 'error'
          ? (message ?? 'Try again after your account and profile state load.')
          : 'Use your account to reply, repost, like, or bookmark.';

  return (
    <div
      className="fixed inset-x-3 bottom-20 z-30 rounded-2xl border p-4 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-3 sm:w-[min(20rem,calc(100%-1.5rem))]"
      style={{
        backgroundColor: 'var(--bg-elevated)',
        borderColor: 'var(--border-primary)',
        color: 'var(--text-primary)',
      }}
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="false"
      aria-label={title}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--accent)' }}
          aria-hidden="true"
        >
          {prompt === 'profile' ? <UserRound size={18} /> : <LogIn size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-bold leading-5">{title}</h2>
              <p className="mt-1 text-[13px] leading-5" style={{ color: 'var(--text-secondary)' }}>
                {checking ? 'Checking your profile...' : body}
              </p>
            </div>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors hover-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {prompt === 'signin' && clerkConfigured ? (
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="rounded-full px-4 py-2 text-[13px] font-bold transition-opacity hover:opacity-90"
                  style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)' }}
                >
                  Sign in
                </button>
              </SignInButton>
            ) : (
              <a
                href={profileHref}
                className="rounded-full px-4 py-2 text-[13px] font-bold transition-opacity hover:opacity-90"
                style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)' }}
              >
                Go to profile
              </a>
            )}
            <button
              type="button"
              className="rounded-full border px-4 py-2 text-[13px] font-bold transition-colors hover-overlay"
              style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
              onClick={onClose}
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
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
      className="flex w-full items-center gap-3 px-4 py-2 text-left text-[15px] transition-colors duration-150 hover-overlay focus-visible:bg-[var(--bg-hover)] focus-visible:outline-none"
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
