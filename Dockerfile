FROM node:22-alpine

WORKDIR /app

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
