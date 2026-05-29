# Cortex Billing & Subscription Flow — Frontend Prompt (v2)

> Read `.dualbrain/frontend-prompt.md` first — that's the main build prompt.
> This prompt ADDS the subscription/billing flow. Build this as a NARROW first PR:
> access gate + checkout + credit indicator. Expand later.

---

## Pricing

One plan. No tiers. No complexity.

```
Cortex Pro: $7.99/mo  |  $79/yr (save 17%)
- 200 orchestration credits/month
- Unlimited projects, 2 concurrent workers
- All features included

Credit pack add-on: 100 credits / $4.99 (never expire)
```

---

## Access State Machine

**The frontend renders from a single backend endpoint. No local guessing.**

```typescript
// GET /api/billing/status — call on app load, after auth change, after checkout
type AccessState =
  | 'signed_out'       // not authenticated → show SignInScreen
  | 'needs_phone'      // Clerk auth but no phone verification → show phone step
  | 'needs_checkout'   // phone verified, no subscription → show CheckoutScreen
  | 'trial_active'     // in trial, credits remaining → full access
  | 'active'           // paid, credits remaining → full access
  | 'credits_exhausted'// all credits used → read-only mode + buy CTA
  | 'payment_failed'   // card charge failed → read-only + update payment CTA
  | 'cancelled';       // cancelled → read-only until period end, then locked
```

**App.tsx gate logic (replaces current auth gate):**
```
const { data: billing } = useBilling();
const { isSignedIn } = useAuth(); // Clerk

if (!isSignedIn) → SignInScreen
if (billing.access_state === 'needs_phone') → PhoneVerificationScreen
if (billing.access_state === 'needs_checkout') → CheckoutScreen
if (billing.access_state === 'payment_failed') → PaymentFailedOverlay (read-only nav available)
if (!isOnboarded) → OnboardingFlow
// otherwise: full app with credit-aware UI
```

**Read-only mode** (credits_exhausted, payment_failed, cancelled):
- Chat composer disabled, "Buy credits" or "Update payment" button replaces send
- Map, work surface, settings, conversations all still navigable
- Sidebar shows credit indicator in warning state

---

## Backend Contracts (All Implemented)

### GET /api/billing/status

```typescript
interface SubscriptionStatus {
  access_state: AccessState;

  plan?: {
    plan_type: 'monthly' | 'annual';
    status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'paused';
    billing_period_end: string;
    next_charge_amount_cents?: number;
    next_charge_date?: string;
    started_at: string;
  };

  // IMPORTANT: Two separate credit pools.
  // Subscription credits reset monthly. Pack credits never expire.
  // Subscription credits spend FIRST.
  credits: {
    subscription_remaining: number;  // resets on billing date
    subscription_total: number;      // 200 for standard plan
    pack_remaining: number;          // from purchased packs, never expires
    total_remaining: number;         // convenience sum
    billing_period_end?: string;     // when subscription credits reset
  };

  trial?: {
    trial_end: string;
    days_remaining: number;
    auto_charge_amount_cents: number;
    auto_charge_plan: 'monthly' | 'annual';
  };

  // Soma delegation — frontend displays, never creates/modifies
  delegation: {
    status: 'active' | 'pending' | 'expired' | 'revoked' | 'not_issued';
    budget_enforced: boolean;        // true = server rejects when over budget
    delegation_id?: string;
    expires_at?: string;
  };

  payment_method?: {
    last4: string;
    brand: string;
    exp_month: number;
    exp_year: number;
  };

  referral?: {
    code: string;
    uses_remaining: number;
    total_uses: number;
    credits_earned: number;
  };
}
```

### POST /api/billing/checkout

```typescript
interface CheckoutRequest {
  plan: 'monthly' | 'annual';
  referral_code?: string;
  referral_choice?: 'discount_25_annual' | 'extra_2_weeks';
  // NOTE: 'discount_25_annual' requires plan === 'annual'
  // Backend returns 400 if plan is monthly + discount_25_annual
}
interface CheckoutResponse {
  checkout_url: string;  // redirect user here (Stripe hosted)
  session_id: string;
}
```

### POST /api/billing/portal

```typescript
// Opens Stripe Customer Portal for: update payment, view invoices, cancel
interface PortalResponse {
  portal_url: string;  // redirect user here
}
```

### POST /api/billing/credits

```typescript
interface CreditPurchaseRequest {
  pack: 'credits_100';  // only option for now
}
interface CreditPurchaseResponse {
  checkout_url: string;     // Stripe checkout for one-time purchase
  new_credits_total: number;
}
```

### POST /api/billing/referral/validate

```typescript
interface ReferralValidateRequest { code: string; }
interface ReferralValidateResponse {
  valid: boolean;
  creator_name?: string;           // "Josh invited you!"
  options: string[];               // ["discount_25_annual", "extra_2_weeks"]
  uses_remaining?: number;
  error?: string;
}
```

### GET /api/billing/history

```typescript
interface BillingHistoryEntry {
  date: string;
  amount_cents: number;
  description: string;
  status: 'succeeded' | 'failed' | 'refunded';
}
```

### 402 Payment Required (error response on credit-consuming endpoints)

```typescript
// When chat/route/run endpoints reject due to billing:
// HTTP 402 with body:
interface BillingRequiredError {
  error: string;
  code: 'credits_exhausted' | 'trial_expired' | 'subscription_inactive' | 'payment_required';
  credits_remaining: number;
}
```

**Frontend must handle 402 globally** in `authedFetch` — show appropriate CTA based on `code`.

### Real-time Credit Updates (via chat SSE)

After each credit-consuming operation, the chat SSE stream includes a `credit_spent` event:

```typescript
// SSE data line:
{ type: "credit_spent", credits_spent: 1.5, subscription_remaining: 142, pack_remaining: 0, total_remaining: 142 }
```

Use this for optimistic credit indicator updates. Reconcile with `/api/billing/status` on page focus or every 60s.

---

## UI Components

### 1. CheckoutScreen (post-signup, pre-onboarding)

```
┌─────────────────────────────────────────┐
│  Start your 14-day free trial           │
│                                         │
│  ┌─────────────┐  ┌─────────────┐       │
│  │  Monthly    │  │  Annual ✦   │       │
│  │  $7.99/mo   │  │  $79/yr     │       │
│  │             │  │  Save 17%   │       │
│  └─────────────┘  └─────────────┘       │
│                                         │
│  ☐ I have a referral code               │
│    [code input]                         │
│    → validates on blur via API          │
│    → if valid, show:                    │
│      "Josh invited you! Pick a reward:" │
│      ○ 25% off first year ($59.25)      │
│         ↑ disabled unless Annual        │
│         ↑ selecting auto-switches plan  │
│      ○ 2 extra free weeks              │
│                                         │
│  [ Start Free Trial → ]                 │
│  Card required. Cancel anytime.         │
└─────────────────────────────────────────┘
```

On "Start Free Trial" → `POST /api/billing/checkout` → redirect to `checkout_url`.
On Stripe success redirect → re-fetch `/api/billing/status` → access_state changes → onboarding begins.

### 2. CreditIndicator (Sidebar, always visible)

```
┌──────────────────────┐
│ ████████░░░  142/200 │  ← show subscription + pack combined
│ Credits • 18 days    │  ← days until subscription credits reset
└──────────────────────┘
```

- Green bar when < 50% used
- Yellow at 80% (`var(--warning)` or amber)
- Red at 95%
- Click → opens Billing tab in SettingsPanel
- Updates optimistically from `credit_spent` SSE events

If pack credits exist, show tooltip: "142 subscription + 50 pack credits"

### 3. CreditExhausted banner (above composer)

```
┌──────────────────────────────────────────┐
│ ⚠ Credits used up. Resets in 12 days.   │
│ [ Buy 100 credits — $4.99 ]             │
└──────────────────────────────────────────┘
```

Composer input disabled. Send button replaced with "Buy Credits".
Rest of app remains navigable (read-only).

### 4. TrialBanner (dismissible, reappears daily in last 3 days)

Day 12:
```
Your trial ends in 2 days. You'll be charged $7.99/mo.  [Review Plan]  [Dismiss]
```

Day 14:
```
Trial ends today. Card charged at midnight.  [Looks Good ✓]  [Cancel]
```

### 5. PaymentFailed overlay

**NOT a full-screen block.** App nav still works (read-only). Show a persistent top banner:

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠ Payment failed on card ending 4242. Update to continue.  │
│ Work preserved for 30 days.  [ Update Payment ]             │
└──────────────────────────────────────────────────────────────┘
```

"Update Payment" → `POST /api/billing/portal` → redirect to Stripe portal.

### 6. BillingSettings (new tab in SettingsPanel)

```
Plan: Cortex Pro (Monthly)
Status: Active
Next billing: June 19, 2026 — $7.99

Credits: 58 subscription + 0 pack = 58 remaining
Resets: June 19, 2026

Card: •••• 4242 (Visa, exp 12/28)

[ Manage Payment ]        → Stripe Portal
[ Switch to Annual ]      → Stripe Portal
[ Cancel Subscription ]   → Stripe Portal

─── Purchase History ───
Jun 19  $7.99   Monthly renewal     ✓
Jun 5   $4.99   Credit pack (100)   ✓
May 19  $7.99   Monthly renewal     ✓

─── Refer Friends ───
(shown after 30+ days subscribed)
Your code: JOSH-FAIR
50 credits earned • 12/25 uses remaining
[ Copy Code ]  [ Share Link ]
```

**Cancellation:** "Cancel Subscription" opens Stripe Customer Portal. Stripe handles the cancellation UX (with its own retention flow). Backend webhook updates access_state to 'cancelled'. Frontend re-fetches status and shows cancelled state.

---

## Error Handling

**402 Payment Required:** Add global handler in `authedFetch`:
```typescript
if (res.status === 402) {
  const body = await res.json() as BillingRequiredError;
  // Show appropriate toast/CTA based on body.code
  // Don't throw — let component handle gracefully
}
```

**Checkout failure:** Stripe handles errors on its hosted page. On redirect back with failure, re-fetch billing status — it will still be `needs_checkout`.

**Portal errors:** If portal creation fails (no Stripe customer yet), show toast "Set up your subscription first".

---

## Build Order (narrow PR first)

**PR 1: Access Gate + Checkout (must ship first)**
1. `useBilling` hook — fetches `/api/billing/status`, re-fetches on window focus
2. Update App.tsx gate — switch on `access_state` instead of just Clerk auth
3. `CheckoutScreen` component
4. 402 handler in `authedFetch`
5. Add billing types to `cortexApi.ts`

**PR 2: Credit Indicator + Exhausted State**
6. `CreditIndicator` in sidebar
7. `CreditExhausted` banner
8. Handle `credit_spent` SSE events for live updates
9. Disable composer when exhausted

**PR 3: Billing Settings + Trial Banners**
10. `BillingSettings` tab in SettingsPanel
11. `TrialBanner` component
12. `PaymentFailed` banner
13. `ReferralSection` in billing settings

**Then:** Onboarding rewrite (which now includes checkout as step 2)

---

## What NOT to Build

- Custom card input forms — always use Stripe Checkout/Portal
- Cancellation flow — Stripe Portal handles it
- Invoice generation — Stripe handles it
- Phone verification logic — Clerk handles it, backend enforces uniqueness
- Credit enforcement logic — backend enforces via 402, frontend just reflects state
- Anything that assumes credits == Soma budget — only show enforcement if `delegation.budget_enforced === true`
