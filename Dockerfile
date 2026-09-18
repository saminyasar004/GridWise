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
ENV GRIDWISE_HOST=0.0.0.0
ENV GRIDWISE_PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY .env.example ./.env.example
EXPOSE 3000
CMD ["node", "dist/main.js"]
