FROM node:22-alpine

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate && pnpm install --prod --frozen-lockfile
COPY --chown=node:node server.js catalog.json index.html admin.html admin.js account.html account.js app.js styles.css manus-routes.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node images ./images
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node scripts ./scripts
ENV NODE_ENV=production
ENV PIXGATE_LIVE_CASHIN=true
ENV ORDERS_WRITE_ENABLED=true
ENV ORDERS_ADMIN_ENABLED=true
EXPOSE 3000
USER node
CMD ["sh", "-c", "node scripts/migrate.js && node server.js"]
