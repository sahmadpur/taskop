# The web app (admin.taskop.app): Vite's static build served by Caddy. The edge proxy (deploy/Caddyfile)
# sends /api/* to the API and everything else here.
# Build from the repository root so the workspace packages are in the context:
#   docker build -f apps/web/Dockerfile -t taskop-web .
# The build stage runs on the build machine's own architecture (its output is plain static files).
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
RUN npm install -g pnpm@latest
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@taskop/web...

FROM caddy:2.11-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
