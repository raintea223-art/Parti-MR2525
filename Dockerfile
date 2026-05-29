FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto-cjk \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

RUN mkdir -p /app/data/uploads

ENV HOST=0.0.0.0
ENV PORT=3847

EXPOSE 3847

VOLUME ["/app/data"]

CMD ["node", "--experimental-sqlite", "src/server.js"]
