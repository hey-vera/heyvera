import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// Dev proxies mirror production Caddy path ownership (soft-launch integrity):
//   /v1/social/*, /v1/pulse/*, /v1/health, /v1/ready → heyvera-server :3002
//   /api/*                                           → cortex-server   :3001
//   remaining /v1/*                                  → legacy Node     :3402
// Production builds ignore `server.proxy` entirely; set VITE_API_URL for
// absolute API origin when not using same-origin /v1 (see .env.example).
var HEYVERA_SERVER = "http://localhost:3002";
var CORTEX_SERVER = "http://localhost:3001";
var LEGACY_V1 = "http://localhost:3402";
export default defineConfig({
    plugins: [react(), tailwindcss()],
    build: {
        rollupOptions: {
            output: {
                // Function form, not the object form. Vite 8's rolldown-based
                // bundler dropped the object overload, so `{ vendor: [...] }` fails
                // to type-check (`vite.config.ts(22,11): error TS2769`) the moment
                // vite is bumped. `cortex/vite.config.ts` already uses this form.
                //
                // The package list is matched against the node_modules path segment
                // rather than by substring, so `react-router` cannot be swept into
                // the chunk meant for `react`.
                // `indexOf` rather than `includes`: this file is type-checked against
                // a pre-ES2015 lib, where String.prototype.includes does not exist.
                manualChunks: function (id) {
                    if (id.indexOf("node_modules") === -1)
                        return undefined;
                    if (id.indexOf("@clerk") !== -1)
                        return "clerk";
                    if (/[\\/]node_modules[\\/](react|react-dom|react-router)[\\/]/.test(id)) {
                        return "vendor";
                    }
                    return undefined;
                },
            },
        },
    },
    server: {
        host: "0.0.0.0",
        port: 5001,
        allowedHosts: true,
        proxy: {
            // Most specific paths first — social/pulse owner (not silent 3402)
            "/v1/social": {
                target: HEYVERA_SERVER,
                changeOrigin: true,
                // Wave 8b: social DM WebSocket at /v1/social/ws
                ws: true,
            },
            "/v1/pulse": {
                target: HEYVERA_SERVER,
                changeOrigin: true,
            },
            "/v1/health": {
                target: HEYVERA_SERVER,
                changeOrigin: true,
            },
            "/v1/ready": {
                target: HEYVERA_SERVER,
                changeOrigin: true,
            },
            // Billing / Cortex product API
            "/api": {
                target: CORTEX_SERVER,
                changeOrigin: true,
            },
            // Legacy non-social v1 remainder
            "/v1": {
                target: LEGACY_V1,
                changeOrigin: true,
            },
        },
    },
});
