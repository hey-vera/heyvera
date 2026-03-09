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
# Create non-root user with UID 1000 to match the host 'guardian' user so
# Docker volume mounts (data/) remain writable without chown on the host.
RUN addgroup --system --gid 1000 appgroup \
 && adduser  --system --uid 1000 --ingroup appgroup appuser \
 && mkdir -p data && chown -R appuser:appgroup /app
USER appuser
EXPOSE 3402
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
