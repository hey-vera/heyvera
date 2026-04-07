import { Clock, MailIcon } from 'lucide-react';

/**
 * Banner shown on provider pages when the provider account is still pending activation.
 * Appears above page content as a prominent yellow callout.
 */
export function ProviderPendingBanner({ status }: { status: string }) {
  if (status === 'active') return null;

  const isSuspended = status === 'suspended';

  return (
    <div
      className={`rounded-lg border px-4 py-3 mb-6 flex items-start gap-3 ${
        isSuspended
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-yellow-500/30 bg-yellow-500/5 text-yellow-700 dark:text-yellow-400'
      }`}
    >
      <Clock className="h-5 w-5 shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {isSuspended
            ? 'Your provider account has been suspended.'
            : 'Your provider account is pending review.'}
        </p>
        <p className="text-xs opacity-80">
          {isSuspended
            ? 'Contact support for more information.'
            : 'We typically activate new providers within 24 hours. Once active, you can submit endpoints and start earning.'}
        </p>
        <a
          href="mailto:hello@claw-net.org"
          className="inline-flex items-center gap-1 text-xs underline opacity-80 hover:opacity-100"
        >
          <MailIcon className="h-3 w-3" />
          Contact support
        </a>
      </div>
    </div>
  );
}
