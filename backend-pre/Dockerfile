# ---- 构建阶段 ----
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=optional
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- 运行阶段 ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# 仅装生产依赖,跳过 optional(better-sqlite3,生产用 pg 无需原生编译)。
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force
COPY --from=builder /app/dist ./dist
# 以非 root 运行(node 镜像内置 node 用户)。
USER node
EXPOSE 8770
# 启动自动跑 migration(migrationsRun=true),再起服务。
CMD ["node", "dist/main.js"]
