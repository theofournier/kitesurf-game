# --- build ------------------------------------------------------------------
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- runtime ----------------------------------------------------------------
FROM node:24-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# tiny static file server, no app dependencies at runtime
RUN npm install -g serve@14

COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000

# serve reads PORT from the env and binds 0.0.0.0 by default, so no shell needed
CMD ["serve", "-s", "dist"]
