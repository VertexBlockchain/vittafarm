FROM node:22-alpine

WORKDIR /app
COPY --chown=node:node server.js catalog.json ./
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "server.js"]
