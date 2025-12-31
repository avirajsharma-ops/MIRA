# ===========================================
# MIRA AI Assistant - Production Dockerfile
# ===========================================

# Use full Debian-based Node image for native module compatibility
FROM node:20-bookworm AS builder

WORKDIR /app

# Copy package.json only (not package-lock.json due to npm optional deps bug)
COPY package.json ./

# Fresh install without lock file to get correct platform binaries
# This fixes the @tailwindcss/oxide and lightningcss native binding issues
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Remove any lock file that might have been copied
RUN rm -f package-lock.json

# Set environment for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Dummy env vars for build (actual values come from runtime .env)
# These are needed because Next.js evaluates API routes at build time
ENV MONGODB_URI="mongodb://placeholder:27017/placeholder"
ENV OPENAI_API_KEY="placeholder"
ENV ELEVENLABS_API_KEY="placeholder"
ENV ELEVENLABS_VOICE_MI="placeholder"
ENV ELEVENLABS_VOICE_RA="placeholder"
ENV JWT_SECRET="placeholder"
ENV NEXTAUTH_SECRET="placeholder"
ENV NEXTAUTH_URL="http://localhost:3000"
ENV GEMINI_API_KEY="placeholder"
ENV NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Build the application
RUN npm run build

# Stage 2: Production Runner
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install wget for health checks
RUN apt-get update && apt-get install -y wget && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Set ownership
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
