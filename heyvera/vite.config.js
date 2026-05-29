import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
    plugins: [react(), tailwindcss()],
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    vendor: ["react", "react-dom", "react-router-dom"],
                    clerk: ["@clerk/clerk-react"],
                },
            },
        },
    },
    // `server` config is dev-only (vite dev / vite preview).
    // The proxy here rewrites /v1/* → localhost:3402 so you can run the frontend
    // without setting VITE_API_URL locally. It has no effect on production builds
    // served from Cloudflare Pages.
    server: {
        host: "0.0.0.0",
        port: 5001,
        allowedHosts: true,
        proxy: {
            "/v1": {
                target: "http://localhost:3402",
                changeOrigin: true,
            },
        },
    },
});
