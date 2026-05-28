FROM node:20-alpine

WORKDIR /app

LABEL org.opencontainers.image.title="Sivan Escrow Agent"
LABEL org.opencontainers.image.description="Autonomous SAP + Ace Data Cloud escrow agent with Paystack Naira and x402 USDC settlement."

COPY package.json package-lock.json ./
RUN npm install --production

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

EXPOSE 4000

CMD ["node", "dist/server.js"]
