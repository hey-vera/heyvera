# Production Readiness Checklist for heyvera.org

## ✅ Completed

### Frontend Infrastructure
- [x] Real API endpoints — all pages use `/v1/social/` routes, no mock fallbacks
- [x] Cloudflare Pages proxy — `_redirects` routes `/v1/*` → `api.heyvera.org`
- [x] Production env docs — clear setup instructions in `docs/reference/cloudflare-pages-setup.md`
- [x] TypeScript clean — zero errors, all imports consolidated to `api/social.ts`
- [x] Interaction endpoints — like/bookmark/repost work with real backend
- [x] Search & trending — hashtag extraction from recent posts
- [x] All pages migrated — HomePage, ProfilePage, ExplorePage, etc. use real API

### Backend Infrastructure  
- [x] ClawNet social endpoints — POST/GET `/v1/social/posts`, profiles, feed, etc.
- [x] Database tables — `social_posts`, `social_profiles`, interactions tables
- [x] VPS deployment — systemd service, Caddy reverse proxy, GitHub Actions CD
- [x] Health checks — `/v1/health` returns service status + deploy metadata

## 🔄 In Progress

### Production Deployment
- [ ] **Backend deploy** — Deploy main branch with all new social endpoints
  - Status: Triggered `Deploy Production` workflow with main
  - ETA: ~3 minutes
  - Test: `curl https://api.heyvera.org/v1/health` should return latest commit

### Environment Configuration  
- [ ] **Clerk production key** — Set `VITE_CLERK_PUBLISHABLE_KEY` in Cloudflare Pages
  - Location: Cloudflare Dashboard → Pages → heyvera → Settings → Environment variables
  - Value: Production publishable key from Clerk Dashboard
  - **Requires Cloudflare dashboard access**

## 🎯 Next Steps

### End-to-End Testing
- [ ] **Production flow test** — Full signup → profile → post on heyvera.org
  - Blocked on: Backend deploy + Clerk key
  - Test steps: Visit heyvera.org → Sign up → Create profile → Post content
  - Success criteria: All API calls succeed, post appears in feed

### Pulse Agent Features (Phase 1)
- [ ] **Pulse backend** — Draft/schedule/approve tables + endpoints
  - Status: Building `src/routes/pulse.ts` + DB tables
  - Agent: Currently running
- [ ] **Pulse frontend** — Compose modal tabs, draft management UI  
  - Blocked on: Pulse backend completion
  - Features: Post | Agent Assist | Schedule tabs, approval workflow

## 🚀 Launch Ready When

1. ✅ Backend responds at `api.heyvera.org/v1/health`
2. ✅ Clerk auth works on `heyvera.org` (production key set)  
3. ✅ Full signup → profile → post flow works end-to-end
4. 🔄 Pulse agent-assist basic functionality (optional for initial launch)

## Monitoring & Observability

- Health endpoint: https://api.heyvera.org/v1/health
- Frontend: https://heyvera.org
- CI/CD: https://github.com/hey-vera/heyvera/actions/workflows/deploy-production.yml
- Cloudflare Pages: https://dash.cloudflare.com → Pages → heyvera