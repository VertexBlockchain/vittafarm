FROM node:22-alpine

WORKDIR /app
COPY --chown=node:node server.js catalog.json ./
ENV NODE_ENV=production
ENV PIXGATE_LIVE_CASHIN=true
EXPOSE 3000
USER node
CMD ["node", "server.js"]
