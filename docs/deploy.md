# 部署文档

## 一、在 VPS 上部署

### 1. 准备

确保 VPS 已安装 Docker 和 Docker Compose。

### 2. 上传项目

将整个项目目录上传到 VPS,例如放到 `/opt/license`:

```bash
scp -r ./* root@你的VPS:/opt/license/
```

### 3. 配置环境变量

```bash
cd /opt/license
cp .env.example .env
nano .env
```

把 `ADMIN_PASSWORD` 改成你的强密码(管理后台登录用),端口如需修改可改 `PORT`。

### 4. 启动

```bash
docker compose up -d --build
```

### 5. 检查运行

```bash
docker compose ps
curl http://localhost:8080/api/health
```

看到 `{"ok":true,...}` 即成功。

### 6. 配置域名与 HTTPS(推荐)

用 Nginx/Caddy 反向代理 `8080` 端口并配置 HTTPS 证书。

Nginx 示例:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

> 注意:如果用了反向代理,务必保留 `X-Forwarded-For` 头,校验接口需要它来记录真实 IP。

## 二、使用说明

### 管理后台

浏览器打开 `https://你的域名/` ,用 `.env` 里设置的 `ADMIN_PASSWORD` 登录。

- **验证码页**:点击"生成验证码"随机生成 24 位码,可填备注(用户名)、设过期时间;可随时"取消"(用户立即失效)、"恢复"或"删除"
- **日志页**:按验证码 / IP / 结果筛选所有校验记录,查看每个用户的使用情况
- 验证码页顶部有统计:总数 / 有效 / 已取消 / 已绑定设备 / 校验次数

### 生成验证码分发给用户

1. 后台点击"生成验证码",复制发给用户
2. 建议填上备注(如用户名),方便管理
3. 用户在软件里输入验证码,软件调用校验接口验证

## 三、常用操作

```bash
# 查看日志
docker compose logs -f license

# 重启
docker compose restart

# 停止
docker compose down

# 备份数据(数据库在 ./data 目录,备份该目录即可)
cp -r data data_backup_$(date +%F)
```

## 四、数据与迁移

- 数据全部存在 `./data/license.db`(SQLite),已挂载为 Docker volume
- 重建容器、升级镜像都不会丢数据
- 换服务器时,把 `data` 目录一并拷走即可