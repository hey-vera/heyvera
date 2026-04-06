# Single-stage — no TypeScript compile step (tsx handles it at runtime)
# Type checking happens locally via `npm run typecheck`, not at deploy time.
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm install tsx
COPY tsconfig.json ./
COPY src ./src
COPY dashboard/dist ./dashboard/dist
# Use the built-in 'node' user (UID/GID 1000) from the base image.
# This matches the host 'guardian' user (UID 1000) so Docker volume mounts
# (data/) remain writable without chown on the host.
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 3402
ENV NODE_ENV=production
CMD ["npx", "tsx", "src/index.ts"]
