FROM node:20-alpine AS build

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

EXPOSE 8080
VOLUME ["/app/data"]

CMD ["node", "src/server.js"]