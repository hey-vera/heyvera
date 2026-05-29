# Cortex Production Deployment Guide

## 🎯 Objective

Deploy Cortex frontend with admin BYOK settings visibility for production customers, ensuring `jfair1028@gmail.com` has full admin access.

## 📋 Implementation Summary

### ✅ What Was Done

1. **Fixed TypeScript Build Issues**
   - Resolved `undefined` vs `number | null` type conflicts in `BudgetSettings.tsx`
   - Frontend now builds successfully without errors

2. **Created Deployment Infrastructure**
   - `/scripts/build-cortex.sh` - Frontend build automation
   - `/deploy/cortex-deploy.sh` - Complete deployment pipeline
   - `/scripts/verify-cortex.sh` - Post-deployment verification

3. **Environment Configuration**
   - Added `CORTEX_ADMIN_EMAILS=jfair1028@gmail.com` to `.env`
   - Updated environment examples with admin configuration
   - Documented all required environment variables

4. **Architecture Documentation**
   - `CORTEX_DEPLOYMENT.md` - Complete deployment strategy
   - Detailed troubleshooting guides
   - Alternative deployment options

## 🏗️ Deployment Architecture

```
Internet → Caddy (SSL) → Rust Backend → Static Files (cortex/dist)
                      ├── API (/api/*)
                      └── Frontend SPA (React)
```

**Key Benefits:**
- Single origin (no CORS complexity)
- Admin auth enforced by backend
- Simple deployment (one binary + static files)
- Fast serving (no external dependencies)

## 🚀 Deployment Process

### For VPS Production

```bash
# 1. Build frontend
./scripts/build-cortex.sh --prod

# 2. Deploy everything
./deploy/cortex-deploy.sh

# 3. Verify deployment
./scripts/verify-cortex.sh https://cortex.heyvera.org
```

### Manual Steps

```bash
# 1. Set environment variables
echo "CORTEX_ADMIN_EMAILS=jfair1028@gmail.com" >> .env

# 2. Build frontend
cd cortex && npm ci && npm run build

# 3. Start backend
cargo run --bin cortex-server
```

## 🔑 Admin Access Configuration

### Required Environment Variables

```bash
CORTEX_ADMIN_EMAILS=jfair1028@gmail.com  # Enable admin access
CORTEX_STATIC_DIR=cortex/dist            # Frontend location
CORTEX_ALLOWED_ORIGINS=https://cortex.heyvera.org  # CORS security
```

### Admin Feature Flow

1. **User Signs In** → Clerk authenticates user
2. **Frontend Calls** → `/api/admin/stats` to check admin status
3. **Backend Checks** → User email against `CORTEX_ADMIN_EMAILS`
4. **Admin UI Shows** → BYOK settings, system stats, user management

## 🔧 Troubleshooting

### Admin Menu Not Visible

```bash
# Check admin configuration
grep CORTEX_ADMIN_EMAILS .env

# Verify user email matches exactly
# Backend logs should show admin check results
```

### Frontend Not Updating

```bash
# Rebuild frontend
cd cortex && npm run build

# Restart backend
docker-compose restart brain
# OR
cargo run --bin cortex-server
```

### Build Failures

```bash
# Check Node.js version (need 18+)
node --version

# Clean and rebuild
cd cortex
rm -rf node_modules dist
npm ci
npm run build
```

## 📊 Verification

After deployment, verify these work:

- ✅ `https://cortex.heyvera.org/` - Frontend loads
- ✅ `https://cortex.heyvera.org/api/health` - API responds
- ✅ Admin user can see settings menu
- ✅ BYOK API key management works
- ✅ Admin panel shows system stats

## 🔄 Update Process

For future frontend updates:

```bash
# 1. Make changes to cortex/src/
# 2. Test locally
npm run dev

# 3. Build for production
npm run build

# 4. Deploy
./deploy/cortex-deploy.sh --skip-backend  # if only frontend changed
```

## 🚨 Critical Points

1. **Admin Email Must Match Exactly**: `jfair1028@gmail.com` (case-sensitive)
2. **Environment Must Be Set**: Backend won't enable admin without `CORTEX_ADMIN_EMAILS`
3. **Frontend Must Be Built**: Changes aren't visible until `npm run build`
4. **Backend Must Restart**: Environment changes require restart

## 📁 File Structure

```
workspace/
├── cortex/                 # Frontend source
│   ├── src/
│   ├── dist/              # Built frontend (served by backend)
│   └── package.json
├── crates/api/            # Rust backend
│   └── src/lib.rs         # Static file serving
├── scripts/
│   ├── build-cortex.sh    # Frontend build automation
│   └── verify-cortex.sh   # Deployment verification
├── deploy/
│   └── cortex-deploy.sh   # Full deployment pipeline
└── CORTEX_DEPLOYMENT.md   # Detailed technical docs
```

## 🎯 Next Steps

1. **Deploy to VPS**: Run `./deploy/cortex-deploy.sh` on production server
2. **Verify Admin Access**: Login as `jfair1028@gmail.com` and check admin menu
3. **Test BYOK Features**: Add/remove API keys in admin settings
4. **Monitor Logs**: Ensure no authentication or serving errors

---

**Status**: ✅ Ready for production deployment  
**Admin Email**: `jfair1028@gmail.com`  
**Frontend**: Built and ready at `cortex/dist/`  
**Backend**: Configured to serve frontend and admin APIs