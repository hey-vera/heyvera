import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_MS = 25 * 60 * 1000; // 25 minutes — 5 min warning

const ACTIVITY_EVENTS = [
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
] as const;

export function SessionTimeout() {
  const { signOut } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const lastActivity = useRef(Date.now());
  const warningTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const logoutTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const resetTimers = useCallback(() => {
    lastActivity.current = Date.now();
    setShowWarning(false);

    if (warningTimer.current) clearTimeout(warningTimer.current);
    if (logoutTimer.current) clearTimeout(logoutTimer.current);

    warningTimer.current = setTimeout(() => {
      setShowWarning(true);
    }, WARNING_MS);

    logoutTimer.current = setTimeout(() => {
      signOut({ redirectUrl: '/dashboard/' });
    }, TIMEOUT_MS);
  }, [signOut]);

  useEffect(() => {
    resetTimers();

    function onActivity() {
      // Throttle: only reset if >60s since last reset
      if (Date.now() - lastActivity.current > 60_000) {
        resetTimers();
      }
    }

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity);
      }
      if (warningTimer.current) clearTimeout(warningTimer.current);
      if (logoutTimer.current) clearTimeout(logoutTimer.current);
    };
  }, [resetTimers]);

  function handleStayLoggedIn() {
    resetTimers();
  }

  return (
    <Dialog open={showWarning} onOpenChange={(open) => !open && handleStayLoggedIn()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Session Expiring</DialogTitle>
          <DialogDescription>
            You've been inactive for 25 minutes. Your session will end
            in 5 minutes for security.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={() => signOut({ redirectUrl: '/dashboard/' })}>
            Sign Out Now
          </Button>
          <Button onClick={handleStayLoggedIn}>Stay Logged In</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
