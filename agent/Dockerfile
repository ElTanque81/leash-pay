# Leash agent service + keeper.
# Build from the repo root:  docker build -f agent/Dockerfile -t leash-agent .
# Run:                       docker run --env-file agent/.env -p 8787:8787 leash-agent
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY shared ./shared
COPY agent ./agent
RUN pnpm install --frozen-lockfile --filter @leash/agent... && rm -rf agent/.env
WORKDIR /app/agent
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["pnpm", "start"]
