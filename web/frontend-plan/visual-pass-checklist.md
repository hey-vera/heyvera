# HeyVera Frontend Visual Pass Checklist

## Foundation (structural, do first)

- [x] **React Router** — real URL routing (`/home`, `/profile/:handle`, `/community/:slug`, `/post/:id`, `/settings/*`, `/notifications`)
- [ ] **Settings page** — full X-style settings layout (Account, Display, Notifications, Privacy, Accessibility sections with proper nested routes)
- [ ] **Compose modal** — X-style pop-up compose with rich input, media attachment, community targeting

## Core social features

- [ ] **Notifications** — bell icon in nav rail, notification feed (mentions, follows, replies, community activity)
- [ ] **Search** — global search bar (top bar or sidebar), search results page for profiles/posts/communities
- [ ] **Threaded replies** — reply indentation in feed, conversation view with lines connecting replies
- [ ] **Media support** — image/video in posts, lightbox viewer, media tab on profiles
- [ ] **DMs/messaging** — direct message UI, conversation list, message thread view
- [ ] **Bookmarks** — save posts, bookmarks page
- [ ] **Who to follow** — suggestion cards in sidebar

## Community features (Discord-inspired)

- [ ] **Real channels/rooms** — text channels inside communities, not static placeholder cards
- [ ] **Thread creation** — threads inside community channels
- [ ] **Member list** — sidebar showing online/offline members in a community
- [ ] **Community roles** — role badges, permission indicators

## Feed intelligence (Bluesky-inspired)

- [ ] **Custom feeds** — create/pin algorithmic or curated feeds
- [ ] **Moderation controls** — mute, block, report UI
- [ ] **Feed preferences** — show more/less controls per topic

## Polish

- [ ] **Transitions/animations** — smooth page transitions, hover states, micro-interactions
- [ ] **Empty states** — illustrated/branded empty states instead of plain text
- [ ] **Responsive mobile** — proper mobile nav, swipe gestures, bottom sheet compose
- [ ] **Loading performance** — code splitting per route, lazy load feature modules

---

## Pulse Auto-Post Experimentation

The core idea: Pulse is a social agent that posts on behalf of humans. Users describe what they want to post about, and the agent drafts/schedules/posts for them.

### Open questions to experiment with

**Where does auto-post live in the UI?**

Option A: Tab inside the compose modal
- X.com has a pop-up compose window. Add a "Pulse" or "Agent" tab alongside the manual compose tab.
- Pro: Discoverable, feels integrated, users already know the compose flow
- Con: Might confuse the compose experience if it's too different from manual posting
- Challenge: Is compose the right mental model? Manual compose = "I know what to say now." Agent compose = "I want ongoing output." Those are different intentions.

Option B: Separate top-level tab (current Pulse tab)
- Dedicated surface for configuring agent posting behavior
- Pro: More room for configuration (topics, schedule, tone, boundaries)
- Con: Disconnected from the posting experience, users might forget it exists
- Challenge: Pulse tab currently feels like a settings page, not an active tool

Option C: Inline feed integration
- Agent drafts appear in your feed as "pending" cards you can approve/edit/reject
- Pro: Keeps the feed as the center of gravity, approval feels natural
- Con: Might clutter the feed, mixing drafts with real content
- Challenge: How do you distinguish "my agent's draft" from "someone else's post"?

Option D: Agent compose sidebar
- Persistent sidebar or drawer that shows agent activity, drafts queue, recent auto-posts
- Pro: Always visible without taking over, like Discord's member list
- Con: Screen real estate on mobile
- Challenge: Does this feel like a tool or like noise?

Option E: Hybrid — compose modal tab + feed approval
- Agent tab in compose modal to set up "what to post about"
- Drafts appear as pending cards in feed for approval
- Approved posts go live, rejected ones teach the agent
- Pro: Best of both — easy setup, natural approval flow
- Con: More complex to build, two surfaces to maintain

### What to prototype first
- Start with the compose modal tab (Option A) since we need the compose modal anyway
- Wire up a mock draft queue that shows pending agent posts in the feed (Option C elements)
- See which feels more natural before committing to the full architecture

### X.com marketing agent integration
- The existing x.com marketing agent becomes the backend brain for Pulse
- User configures: topics, tone, frequency, communities to engage
- Agent generates drafts → user approves → posts go live
- Every auto-post gets a visible "Posted via Pulse" indicator + proof receipt when Soma is ready

### Rules for experimentation
- No feature is permanent until we've tried it live on heyvera.org
- If something feels off, rip it out and try the next option
- User feedback from looking at heyvera.org is the ground truth, not our assumptions
- Build the simplest version first, polish after it feels right
