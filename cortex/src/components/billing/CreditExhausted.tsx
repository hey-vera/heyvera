import { AlertTriangle } from 'lucide-react';
import CreditPackPurchase from './CreditPackPurchase';

interface CreditExhaustedProps {
  resetDate: string | null;
}

export default function CreditExhausted({ resetDate }: CreditExhaustedProps) {
  const resetLabel = resetDate
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(resetDate))
    : 'your next billing period';

  return (
    <div className="border-t border-red-400/15 px-3 py-2 sm:px-4">
      <div className="mx-auto max-w-3xl rounded-xl border border-red-400/20 bg-red-400/10 p-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-200" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-red-50">You have used all credits this month.</p>
            <p className="mt-1 text-xs text-red-100/75">Credits reset on {resetLabel}. Work history, map, and settings remain available.</p>
            <div className="mt-3 max-w-xs">
              <CreditPackPurchase compact />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
