FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV FORGE_PORT=3000
ENV FORGE_BIND_HOST=0.0.0.0

COPY --chown=node:node package.json ./
COPY --chown=node:node config ./config
COPY --chown=node:node src ./src

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.FORGE_PORT || 3000) + '/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/main.js"]
