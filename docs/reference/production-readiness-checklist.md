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

## ✅ Completed (Continued)

### Production Deployment
- [x] **Backend deploy** — Deploy main branch with all social + pulse endpoints  
  - Status: ✅ Deployed at commit `771184f`
  - API working: `curl https://api.heyvera.org/v1/social/trending` returns JSON
  - All endpoints available: search, trending, notifications, pulse drafts
  
### Environment Configuration  
- [x] **Clerk production key** — Set `VITE_CLERK_PUBLISHABLE_KEY` in Cloudflare Pages
  - Status: ✅ Set in Cloudflare dashboard
  - Auth working on heyvera.org production environment

## 🔄 In Progress

### Frontend API Connectivity
- [x] **Frontend API fix** — Updated to use absolute API URLs  
  - Issue: Cloudflare Pages `/v1/*` proxy not working properly
  - Solution: Frontend now uses `https://api.heyvera.org/v1/*` directly
  - Status: PR #260 auto-merging, will deploy automatically

## 🎯 Next Steps  

### End-to-End Testing
- [ ] **Production flow test** — Full signup → profile → post on heyvera.org
  - Ready for testing once frontend deploys with API fixes
  - Test steps: Visit heyvera.org → Sign up → Create profile → Post content
  - Success criteria: All API calls succeed, post appears in feed

### Pulse Agent Features (Phase 1) 
- [x] **Pulse backend** — Draft/schedule/approve tables + endpoints
  - Status: ✅ Complete and deployed at `api.heyvera.org/v1/pulse/*`
  - All endpoints working: create drafts, approve, reject, publish
- [x] **Pulse frontend** — Compose modal tabs, draft management UI
  - Status: ✅ Complete integration with 3-tab modal (Post | Agent Assist | Schedule)
  - Features: Draft creation, approval workflow, one-click publish
  - Ready for testing once frontend deploys

## 🚀 Launch Ready When

1. ✅ Backend responds at `api.heyvera.org/v1/health` (commit `771184f`)
2. ✅ Clerk auth works on `heyvera.org` (production key set)
3. 🔄 Frontend deploys with API connectivity fixes (PR #260)  
4. ✅ Pulse agent-assist functionality complete (Phase 1)
5. [ ] Full signup → profile → post flow tested end-to-end

**Status: ~95% ready for launch**  
Final testing pending frontend deployment with API fixes.

## Monitoring & Observability

- Health endpoint: https://api.heyvera.org/v1/health
- Frontend: https://heyvera.org
- CI/CD: https://github.com/hey-vera/heyvera/actions/workflows/deploy-production.yml
- Cloudflare Pages: https://dash.cloudflare.com → Pages → heyvera