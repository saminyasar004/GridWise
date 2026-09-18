########## Build stage ##########
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY test ./test
RUN npm run build

########## Production stage ##########
FROM node:22-alpine
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
RUN apk add --no-cache curl && addgroup -S gridwise && adduser -S -G gridwise gridwise
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY .env.example ./.env.example
USER gridwise
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fs http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/main.js"]