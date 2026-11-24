FROM node:22-alpine

WORKDIR /app

# Copy project source files (zero external npm dependencies)
COPY package.json build.mjs server.mjs cli.js ./
COPY src ./src
COPY web ./web
COPY tests ./tests

# Build the standalone Web UI bundle (dist/index.html)
RUN npm run build

# Run as non-root user
USER node

ENV HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["node", "server.mjs"]
