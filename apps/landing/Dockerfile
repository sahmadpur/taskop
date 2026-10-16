# The public landing page (taskop.app): Astro's static output served by Caddy.
# Build from the repository root so the workspace packages (@taskop/brand, @taskop/i18n) are in the context:
#   docker build -f apps/landing/Dockerfile --build-arg PLATFORM_URL=https://admin.taskop.app -t taskop-landing .
# The build stage runs on the build machine's own architecture (its output is plain static files);
# only the final stage is built for the server's platform (linux/arm64).
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
RUN npm install -g pnpm@latest
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# Where the Login and Sign up links go. Read at build time by astro:env (apps/landing/astro.config.mjs).
ARG PLATFORM_URL=https://admin.taskop.app
ENV PLATFORM_URL=$PLATFORM_URL
RUN pnpm turbo run build --filter=@taskop/landing...
# Fail the build if the links were not baked in (e.g. the variable did not reach astro build).
RUN grep -q "href=\"$PLATFORM_URL/login\"" apps/landing/dist/index.html

FROM caddy:2.11-alpine
COPY apps/landing/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/landing/dist /srv
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
