FROM node:24.19.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production SKYTILE_HOST=0.0.0.0 PORT=3000 SKYTILE_AUTH=required SKYTILE_DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node server.mjs auth.mjs vision.mjs ./
COPY --chown=node:node public ./public
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
