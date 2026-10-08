FROM node:24-alpine AS build
RUN npm install -g pnpm@latest
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@taskop/api...
RUN pnpm --filter @taskop/api deploy --prod --legacy /out

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out .
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
