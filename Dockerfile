# TRAFO 360 - production image.
# Includes the shared libraries Puppeteer's bundled Chromium needs at
# runtime (used for both the optional WhatsApp Web integration and the PDF
# technical-document generation engine).
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 \
    libx11-xcb1 libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 \
    libxrandr2 xdg-utils wget \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* yarn.lock* ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p uploads && \
    addgroup --system --gid 1001 trafo && \
    adduser --system --uid 1001 --gid 1001 trafo && \
    chown -R trafo:trafo /app
USER trafo

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]
