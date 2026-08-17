# License Server 验证码校验服务

一个跑在 VPS 上的轻量验证码(license key)校验服务,用于你的自制软件做服务器端校验。管理员在后台手动分发验证码(一人一码),用户输入验证码 + 设备标识,软件调用接口校验,通过才允许使用。

## 特性

- **随机验证码**:24 位大写字母 + 数字(去掉易混淆的 `O/0/I/1`),点击即生成,如 `K7QX9M-2WP4DZ-8RTH3C-VN5LSQ`
- **一人一码 / 一码一设备**:首次校验绑定设备 ID,换设备自动拒绝
- **每次打开都校验**:软件每次启动调接口,自动检查过期 / 取消 / 换机,通过才放行
- **记录最后打开时间**:每次校验记录 `last_seen`,后台可看到用户最后一次使用时间
- **随时取消**:后台一键取消,用户立即失效,需重新获取新码
- **有效期可设永久**:生成时勾选"永久有效"或指定到期时间,到期自动失效
- **IP 记录 + 审计日志**:每次校验记录 IP、设备、结果,后台可筛选查看
- **管理后台**:网页界面,生成 / 取消 / 恢复 / 删除验证码,查看统计与日志
- **限流**:按 IP 限制校验频率,防止接口被刷
- **Docker 一键部署**:单容器 + SQLite,数据持久化

## 技术栈

Node.js + Express / SQLite(better-sqlite3)/ 纯 HTML 管理后台 / Docker Compose

## 快速部署

### 1. 准备

VPS 上安装 Docker 和 Docker Compose。

### 2. 上传并配置

```bash
# 上传项目到 VPS(如 /opt/license)
cd /opt/license
cp .env.example .env
nano .env   # 修改 ADMIN_PASSWORD 为强密码
```

`.env` 配置项:

| 变量 | 说明 | 默认值 |
|---|---|---|
| `PORT` | 服务端口 | `8080` |
| `ADMIN_PASSWORD` | 管理后台登录密码(必须修改) | 无 |
| `RATE_LIMIT_MAX` | 每 IP 每分钟最大校验次数 | `30` |

### 3. 启动

```bash
docker compose up -d --build
docker compose ps
curl http://localhost:8080/api/health   # 返回 {"ok":true,...} 即成功
```

### 4. 配置 HTTPS(推荐)

用 Nginx / Caddy 反向代理 `8080` 端口并配置证书。务必保留 `X-Forwarded-For` 头,校验接口需要它记录真实 IP:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

## 使用

浏览器打开 `https://你的域名/`,输入 `.env` 中的密码登录。

- **验证码页**:一键生成验证码,填备注(用户名)、选"永久有效"或指定到期时间;随时取消 / 恢复 / 删除;顶部有统计数据,"最近校验"列即用户最后一次打开软件的时间
- **日志页**:按验证码 / IP / 结果筛选所有校验记录,追踪每个用户的使用情况

## 客户端接入

任何自制软件(桌面 / 移动 / 脚本)接入方式见 **[docs/integration.md](docs/integration.md)** —— 语言无关的通用接入指南,含完整流程、规则、多语言代码示例与自测清单。

校验逻辑案例:**每次打开软件都向本服务校验一次激活码**,通过才放行;第一次打开弹窗填码(只显示成功 / 失败),之后未过期就静默校验不再弹窗;过期 / 被取消提示联系作者;断网无法绕过。

## 校验接口

```
POST https://你的域名/api/validate
Content-Type: application/json
```

请求:

```json
{
  "key": "K7QX9M-2WP4DZ-8RTH3C-VN5LSQ",
  "device_id": "PC-USER123"
}
```

通过:

```json
{
  "ok": true,
  "data": {
    "key": "K7QX9M-2WP4DZ-8RTH3C-VN5LSQ",
    "status": "active",
    "expires_at": null,
    "last_seen": "2026-08-17T12:00:00.000Z",
    "server_time": "2026-08-17T12:00:00.000Z"
  }
}
```

> `expires_at` 为 `null` 表示永久有效;`last_seen` 为最近一次打开软件时间。

失败(HTTP 状态码恒为 200,除 `RATE_LIMITED` 为 429):

```json
{ "ok": false, "error": "INVALID_KEY", "message": "验证码无效" }
```

| error | 含义 |
|---|---|
| `INVALID_KEY` | 验证码不存在 |
| `REVOKED` | 已被取消 |
| `EXPIRED` | 已过期 |
| `DEVICE_MISMATCH` | 已绑定其他设备 |
| `RATE_LIMITED` | IP 请求过于频繁 |
| `BAD_REQUEST` | 缺少 `key` 参数 |

### 软件端判断示例

```javascript
async function checkLicense(key, deviceId) {
  try {
    const res = await fetch('https://你的域名/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, device_id: deviceId }),
    });
    const data = await res.json();
    if (data.ok) return { allowed: true };
    const tips = {
      INVALID_KEY: '验证码无效,请核对后重试',
      REVOKED: '该验证码已被取消,请联系获取新的验证码',
      EXPIRED: '该验证码已过期,请联系续期',
      DEVICE_MISMATCH: '该验证码已绑定其他设备',
      RATE_LIMITED: '请求过于频繁,请一分钟后再试',
    };
    return { allowed: false, reason: tips[data.error] || '校验失败' };
  } catch (e) {
    return { allowed: false, reason: '无法连接验证服务器,请检查网络' };
  }
}
```

完整接口说明见 [docs/api.md](docs/api.md),通用软件接入见 [docs/integration.md](docs/integration.md),部署细节见 [docs/deploy.md](docs/deploy.md)。

## 常见操作

```bash
docker compose logs -f license   # 查看日志
docker compose restart           # 重启
docker compose down              # 停止

cp -r data data_backup_$(date +%F)   # 备份数据(SQLite 在 ./data)
```

## 数据说明

- 数据存于 `./data/license.db`,已挂载为 Docker volume,重启 / 升级不丢数据
- 换服务器时拷走 `data` 目录即可

## 本地开发

```bash
npm install
cp .env.example .env
npm run dev    # 自动监听修改,默认 http://localhost:8080
```
