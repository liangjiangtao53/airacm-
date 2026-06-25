# 部署速记

> 从根 .env 迁出(那里应放 docker compose 配置,见 .env.example)。

## 生成卡密(access key)
```bash
# 每次默认 20 个,有效期 30 天
npm --prefix backend-pre run gen:keys
# 自定义:生成 50 个,有效期 90 天
npm --prefix backend-pre run gen:keys -- 50 90
```

## 默认管理员
- 超级管理员  13259858973 / Admin@12345
- 业务管理员  13772066855 / bizadmin12345

## 卡密样例
ABDACB0AB9B4FBFE
