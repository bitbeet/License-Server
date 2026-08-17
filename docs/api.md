# 验证码校验接口文档

服务部署后,你的自制软件通过调用校验接口来确认用户输入的验证码是否有效。

## 校验接口

```
POST https://你的域名/api/validate
Content-Type: application/json
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | 是 | 用户输入的验证码 |
| `device_id` | string | 否 | 设备唯一标识(建议必填,用于一码一设备) |

```json
{
  "key": "K7QX9M-2WP4DZ-8RTH3C-VN5LSQ",
  "device_id": "PC-USER123"
}
```

### 响应

**校验通过**

```json
{
  "ok": true,
  "data": {
    "key": "K7QX9M-2WP4DZ-8RTH3C-VN5LSQ",
    "status": "active",
    "expires_at": "2026-12-31T00:00:00.000Z",
    "last_seen": "2026-08-17T12:00:00.000Z",
    "server_time": "2026-08-17T12:00:00.000Z"
  }
}
```

> `expires_at` 为 `null` 表示永久有效;`last_seen` 为最近一次校验(打开软件)时间。

**校验失败** — HTTP 状态码恒为 200,通过 `ok` 字段区分(便于软件端统一处理)

```json
{ "ok": false, "error": "INVALID_KEY", "message": "验证码无效" }
```

### 错误码表

| error | 含义 | 处理建议 |
|---|---|---|
| `INVALID_KEY` | 验证码不存在 | 提示"验证码无效" |
| `REVOKED` | 验证码已被取消 | 提示"验证码已失效,请联系获取新码" |
| `EXPIRED` | 验证码已过期 | 提示"验证码已过期,请联系续期" |
| `DEVICE_MISMATCH` | 该码已绑定其他设备 | 提示"该验证码已被其他设备使用" |
| `RATE_LIMITED` | 请求过于频繁(IP 限流) | 稍等一分钟再试 |
| `BAD_REQUEST` | 缺少 `key` 参数 | 检查请求格式 |

> 说明:`RATE_LIMITED` 会返回 HTTP 429,其余失败返回 HTTP 200。

## 健康检查

```
GET https://你的域名/api/health
```

```json
{ "ok": true, "time": "2026-08-17T12:00:00.000Z" }
```

## 软件端判断逻辑示例

以下为核心判断伪代码,可直接参考:

```javascript
async function checkLicense(key, deviceId) {
  try {
    const res = await fetch('https://你的域名/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, device_id: deviceId }),
    });
    const data = await res.json();

    if (data.ok) {
      // 校验通过,允许进入软件
      return { allowed: true };
    }

    // 校验失败,根据错误码提示用户
    const tips = {
      INVALID_KEY: '验证码无效,请核对后重试',
      REVOKED: '该验证码已被取消,请联系获取新的验证码',
      EXPIRED: '该验证码已过期,请联系续期',
      DEVICE_MISMATCH: '该验证码已绑定其他设备,无法在此设备使用',
      RATE_LIMITED: '请求过于频繁,请一分钟后再试',
    };
    return { allowed: false, reason: tips[data.error] || '校验失败' };
  } catch (e) {
    // 网络异常:建议视为"校验失败"并重试,避免用户绕过校验
    return { allowed: false, reason: '无法连接验证服务器,请检查网络' };
  }
}
```

## 关键行为说明

1. **一码一设备**:首次校验成功时,服务端会把 `device_id` 绑定到该验证码。此后同一个码用**不同** `device_id` 校验会被拒绝(`DEVICE_MISMATCH`)。如需解绑,可在管理后台操作。
2. **有效期**:验证码过期后校验返回 `EXPIRED`,必须由管理员在后台延长有效期。创建时可选择"永久有效"(`expires_at` 为空),也可以随时改成限时。
3. **每次打开都校验**:你的软件在每次启动/打开时调用本接口,即可自动检查是否过期、是否被取消、是否被换机使用 —— 通过才放行进入软件。
4. **记录最后打开时间**:每次校验通过都会记录时间(`last_seen`),后台"最近校验"一列即用户最后一次打开软件的时间。
5. **取消即失效**:管理员在后台取消验证码后,立即返回 `REVOKED`,无需等待。
6. **限流**:同一 IP 每分钟最多 30 次校验请求(可在 `.env` 调整),防止接口被刷。
7. **IP 记录**:每次校验都会在管理后台日志中记录 IP、设备、时间与结果,方便追踪使用情况。
8. **信任方式**:本接口在 HTTPS 下传输,你的软件直接信任响应中的 `ok` 字段即可,无需额外验签。