import { useState } from 'react';
import { Gift, Copy, Share2, Users } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { useReferralCode, useApplyReferral } from '@/hooks/use-referral-data';

export function ReferralPage() {
  const { data, isLoading } = useReferralCode();
  const apply = useApplyReferral();
  const [friendCode, setFriendCode] = useState('');

  async function handleCopy() {
    if (!data?.code) return;
    await navigator.clipboard.writeText(data.code);
    toast.success('Referral code copied');
  }

  async function handleShare() {
    if (!data?.shareUrl) return;
    if (navigator.share) {
      await navigator.share({
        title: 'Join ClawNet',
        text: `Use my referral code ${data.code} to get ${data.bonusCreditsForFriend} free credits on ClawNet!`,
        url: data.shareUrl,
      });
    } else {
      await navigator.clipboard.writeText(data.shareUrl);
      toast.success('Share link copied');
    }
  }

  async function handleApply() {
    const code = friendCode.trim().toUpperCase();
    if (!code) return;
    try {
      const result = await apply.mutateAsync(code);
      toast.success(result.message);
      setFriendCode('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply code');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Referrals</h2>
        <p className="text-sm text-muted-foreground">
          Share your code and earn credits when friends sign up.
        </p>
      </div>

      {/* Your code */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Gift className="h-4 w-4" />
            Your Referral Code
          </CardTitle>
          <CardDescription>
            Share this code with friends. You both earn credits when they sign up.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : data ? (
            <>
              <div className="flex items-center gap-3">
                <div className="flex-1 rounded-lg border border-border bg-muted/50 px-4 py-3 text-center">
                  <code className="text-2xl font-bold tracking-widest">
                    {data.code}
                  </code>
                </div>
                <div className="flex flex-col gap-2">
                  <Button variant="outline" size="icon" onClick={handleCopy} title="Copy code">
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={handleShare} title="Share">
                    <Share2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Friends Referred</p>
                  <p className="text-lg font-bold">{data.uses}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Friend Gets</p>
                  <p className="text-lg font-bold">{data.bonusCreditsForFriend} cr</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">You Get</p>
                  <p className="text-lg font-bold">{data.bonusCreditsForYou} cr</p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Unable to load referral code. Make sure you have an API key.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Apply a friend's code */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Apply a Referral Code
          </CardTitle>
          <CardDescription>
            Have a friend's code? Enter it to receive bonus credits.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="friend-code" className="sr-only">
                Friend's code
              </Label>
              <Input
                id="friend-code"
                placeholder="Enter referral code"
                value={friendCode}
                onChange={(e) => setFriendCode(e.target.value.toUpperCase())}
                className="font-mono tracking-wider"
                maxLength={20}
              />
            </div>
            <Button
              onClick={handleApply}
              disabled={apply.isPending || !friendCode.trim()}
            >
              {apply.isPending ? 'Applying...' : 'Apply'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            You can only apply one referral code per account.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
