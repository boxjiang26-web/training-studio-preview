FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY *.tsx *.ts tsconfig.json catalog.json ./
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/app.js ./
COPY --from=build /app/node_modules ./node_modules
COPY server-postgres.mjs server-core.mjs db-postgres.mjs auth.mjs strength.mjs readiness.mjs coach-copilot.mjs exercise-retriever.mjs coach-tools.mjs assessments.mjs ai-week.mjs training-memory.mjs messages.mjs cycles.mjs cycle-review.mjs cycle-reports.mjs preview-access.mjs exercise-media.mjs catalog.json index.html style.css ./
ENV HOST=0.0.0.0 DATA_DIR=/var/data/studio PORT=4186
EXPOSE 4186
CMD ["node","server-postgres.mjs"]
