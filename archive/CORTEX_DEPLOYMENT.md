# Cortex Frontend Deployment Strategy

## Architecture Overview

Cortex uses an **embedded frontend** deployment strategy where the Rust backend serves the React frontend as static files. This approach provides:

- **Single binary deployment**: No separate frontend hosting needed
- **Simplified CORS**: Frontend and API share the same origin
- **Admin security**: Admin features protected by backend auth
- **Performance**: Direct serving with no external dependencies

## Current Setup

```
cortex.heyvera.org (Caddy) → Rust Backend → Static Files (cortex/dist)
                           ├── API endpoints (/api/*)
                           └── Frontend SPA (all other routes)
```

## Deployment Process

### 1. Build Frontend

```bash
# Build for production
cd cortex
npm ci
npm run build

# Or use the automated script
./scripts/build-cortex.sh --prod
```

### 2. Configure Environment

The backend needs these environment variables for admin access:

```bash
# In VPS: /etc/cortex/cortex.env or docker-compose .env
CORTEX_ADMIN_EMAILS=jfair1028@gmail.com
CORTEX_STATIC_DIR=cortex/dist  # Default location
CORTEX_ALLOWED_ORIGINS=https://cortex.heyvera.org  # Production CORS
```

### 3. Deploy Backend

```bash
# On VPS (via Docker Compose)
docker-compose down
docker-compose up -d --build

# Or direct deployment
cargo build --release
./target/release/cortex-server
```

## Admin Access

Admin functionality (BYOK settings, system stats) is enabled by:

1. **Email Authorization**: User email must be in `CORTEX_ADMIN_EMAILS`
2. **Frontend Check**: `isAdmin` state set by calling `/api/admin/stats`
3. **UI Visibility**: Admin menu appears when `isAdmin=true`

### Current Admin Email
- `jfair1028@gmail.com` - should have full admin access

## File Serving Details

The Rust backend (`crates/api/src/lib.rs`) handles static files via:

```rust
// Static service with SPA fallback
let static_service = ServeDir::new(&cortex_static_dir)
    .not_found_service(tower::service_fn(spa_fallback));

// Serves from CORTEX_STATIC_DIR (default: "cortex/dist")
let cortex_static_dir = std::env::var("CORTEX_STATIC_DIR")
    .unwrap_or_else(|_| "cortex/dist".to_string());
```

## Troubleshooting

### Admin Menu Not Visible

1. **Check admin email config**:
   ```bash
   # On VPS
   grep CORTEX_ADMIN_EMAILS /etc/cortex/cortex.env
   ```

2. **Verify user email**: Admin check uses Clerk user's email address

3. **Check API response**: `/api/admin/stats` should return data, not 403

4. **Frontend console**: Look for admin check failures in browser DevTools

### Frontend Not Updating

1. **Rebuild frontend**: `./scripts/build-cortex.sh --prod`
2. **Restart backend**: `docker-compose restart brain`
3. **Clear browser cache**: Hard refresh or incognito mode
4. **Check deployment status**: `/api/deploy-status` endpoint

### Build Failures

1. **Node.js version**: Ensure Node.js 18+ is available
2. **Dependencies**: Run `npm ci` in cortex directory
3. **Environment variables**: Check VITE_* variables in cortex/.env

## Alternative Deployment Options

If embedded serving becomes problematic, these alternatives exist:

### Option A: Separate Subdomain
- Deploy cortex frontend to `admin.heyvera.org` (Cloudflare Pages)
- Keep API at `cortex.heyvera.org/api/*`
- Requires CORS configuration

### Option B: Integration with Web App
- Merge cortex features into main web app (`/web`)
- Single frontend, unified deployment
- More complex state management

### Option C: CDN Distribution
- Build to static files, upload to CDN
- Backend serves API only
- Fastest global delivery

## Security Considerations

1. **Admin Routes**: Protected by Clerk JWT + email check
2. **CORS**: Restricted to `cortex.heyvera.org` in production
3. **Static Assets**: Served without authentication (safe for SPA)
4. **API Keys**: Admin-only endpoints for BYOK management

## Monitoring

- **Health Check**: `/api/health` and `/v1/health`
- **Deploy Status**: `/api/deploy-status` shows frontend/backend version sync
- **Admin Access**: Monitor admin endpoint access in logs

---

**For immediate admin access**: Ensure `CORTEX_ADMIN_EMAILS=jfair1028@gmail.com` is set in production environment and restart the backend service.