FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY *.tsx catalog.json ./
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/app.js ./
COPY server.mjs preview-access.mjs exercise-media.mjs catalog.json index.html style.css ./
ENV HOST=0.0.0.0 DATA_DIR=/var/data/studio PORT=4186
EXPOSE 4186
CMD ["node","server.mjs"]
