# Stage 1: Builder
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Runner
FROM node:22-slim AS runner
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
# Use the built-in 'node' user (UID/GID 1000) from the base image.
# This matches the host 'guardian' user (UID 1000) so Docker volume mounts
# (data/) remain writable without chown on the host.
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 3402
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
