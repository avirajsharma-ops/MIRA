# ===========================================
# MIRA AI Assistant - Production Dockerfile
# Single-stage build to avoid native module issues
# ===========================================

FROM node:20-bookworm

WORKDIR /app

# Install wget for health checks
RUN apt-get update && apt-get install -y wget && rm -rf /var/lib/apt/lists/*

# Copy package.json only (not package-lock.json due to npm optional deps bug)
COPY package.json ./

# Fresh install without lock file to get correct platform binaries
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

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs || true
RUN adduser --system --uid 1001 nextjs || true

# Set ownership
RUN chown -R nextjs:nodejs /app || chown -R 1001:1001 /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the standalone server
CMD ["node", ".next/standalone/server.js"]
