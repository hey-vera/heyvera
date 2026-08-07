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
                manualChunks: {
                    vendor: ["react", "react-dom", "react-router"],
                    clerk: ["@clerk/clerk-react"],
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
