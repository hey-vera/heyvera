interface LoadingStateProps {
  label?: string;
}

interface EmptyStateProps {
  title: string;
  detail?: string;
}

interface ErrorStateProps {
  title?: string;
  detail?: string;
  onRetry?: () => void;
}

export function LoadingState({ label = 'Loading' }: LoadingStateProps) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center gap-3 px-4 py-12" role="status" aria-live="polite">
      <div
        className="h-7 w-7 animate-spin rounded-full border-2 border-transparent"
        style={{ borderTopColor: 'var(--accent)', borderRightColor: 'var(--border-primary)' }}
      />
      <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>{label}</span>
    </div>
  );
}

export function EmptyState({ title, detail }: EmptyStateProps) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center px-6 py-12 text-center">
      <p className="text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>{title}</p>
      {detail && <p className="mt-2 max-w-sm text-[15px]" style={{ color: 'var(--text-secondary)' }}>{detail}</p>}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  detail = 'Try again in a moment.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center px-6 py-12 text-center">
      <p className="text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>{title}</p>
      <p className="mt-2 max-w-sm text-[15px]" style={{ color: 'var(--text-secondary)' }}>{detail}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-full px-5 py-2 text-[15px] font-bold transition-colors hover:opacity-90"
          style={{ backgroundColor: 'var(--accent)', color: '#000' }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
