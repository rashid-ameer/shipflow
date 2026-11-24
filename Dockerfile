FROM node:26.13.1-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY extensions/shipflow-delivery-customization/package.json ./extensions/shipflow-delivery-customization/package.json
COPY extensions/shipflow-delivery-advanced/package.json ./extensions/shipflow-delivery-advanced/package.json
COPY prisma ./prisma
RUN npm ci && npx prisma generate
COPY . .
RUN npm run typecheck && npm run build && chown -R node:node .react-router
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
USER node
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && exec ./node_modules/.bin/react-router-serve ./build/server/index.js"]
