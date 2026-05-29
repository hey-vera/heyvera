import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';

const TOKEN_RE = /(@\w+|#\w+|https?:\/\/\S+)/g;

export function renderRichText(text: string): ReactNode[] {
  const parts = text.split(TOKEN_RE);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const handle = part.slice(1);
      return (
        <Link
          key={i}
          to={`/profile/${handle}`}
          className="hover:underline"
          style={{ color: 'var(--accent)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </Link>
      );
    }
    if (part.startsWith('#')) {
      return (
        <Link
          key={i}
          to={`/explore?q=${encodeURIComponent(part)}`}
          className="hover:underline"
          style={{ color: 'var(--accent)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </Link>
      );
    }
    if (part.startsWith('http://') || part.startsWith('https://')) {
      let display: string;
      try {
        const url = new URL(part);
        display = url.hostname + (url.pathname.length > 1 ? url.pathname.slice(0, 20) : '');
        if (display.length < part.length - 8) display += '…';
      } catch {
        display = part.slice(0, 30) + '…';
      }
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
          style={{ color: 'var(--accent)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {display}
        </a>
      );
    }
    return part;
  });
}

/** Extract the first URL from text, if any. */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/\S+/);
  return match ? match[0] : null;
}

/** A simple link preview card showing domain and link. */
export function LinkPreviewCard({ url }: { url: string }) {
  let hostname = '';
  let pathname = '';
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.replace(/^www\./, '');
    pathname = parsed.pathname.length > 1 ? parsed.pathname : '';
  } catch {
    hostname = url.slice(0, 30);
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 flex items-center gap-3 rounded-2xl border p-3 transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_3%,transparent)]"
      style={{ borderColor: 'var(--border-primary)', textDecoration: 'none' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: 'var(--bg-elevated)' }}
      >
        <ExternalLink size={18} style={{ color: 'var(--text-secondary)' }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          {hostname}
        </p>
        {pathname && (
          <p className="truncate text-[15px] font-medium" style={{ color: 'var(--text-primary)' }}>
            {pathname}
          </p>
        )}
      </div>
    </a>
  );
}
