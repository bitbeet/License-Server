# Open API · 软件对接接口文档

本服务对**自制软件端**开放的接口共 3 个,全部**无需登录鉴权**(按 IP 限流保护),用于软件启动时的"校验验证码 + 拉取在线公告"。

- 基础地址:`https://你的域名`(本地测试 `http://localhost:8080`)
- 请求/响应均为 JSON,`Content-Type: application/json`
- 通用响应结构:`{"ok": true/false, ...}`,失败时带 `error`(错误码)与 `message`(中文说明)
- 除 `RATE_LIMITED`(HTTP 429)外,业务失败也返回 HTTP 200,软件端统一按 `ok` 字段判断即可
- 时间字段均为 ISO 8601 UTC(北京时间 = UTC+8)

---

## 1. 校验验证码(核心接口,每次打开软件必调)

```
POST /api/validate
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | 是 | 用户输入的验证码,大小写不敏感(服务端自动转大写) |
| `device_id` | string | 强烈建议 | 机器码/设备唯一标识;启用"一码一设备",也是定向公告的接收标识 |

```json
{
  "key": "K7QX9M-2WP4DZ-8RTH3C-VN5LSQ",
  "device_id": "PC-USER123"
}
```

### 成功响应(HTTP 200)

```json
{
  "ok": true,
  "data": {
    "key": "K7QX9M-2WP4DZ-8RTH3C-VN5LSQ",
    "status": "active",
    "expires_at": "2026-12-31T00:00:00.000Z",
    "last_seen": "2026-09-15T12:00:00.000Z",
    "server_time": "2026-09-15T12:00:00.000Z",
    "announcements": [
      {
        "id": 1,
        "content": "新版本 2.0 已发布,建议更新",
        "link_url": "https://example.com/download",
        "publish_at": "2026-09-15T02:00:00.000Z",
        "target": "all"
      }
    ]
  }
}
```

| 字段 | 说明 |
|---|---|
| `status` | 当前恒为 `active`(其他状态会直接走失败分支) |
| `expires_at` | 到期时间,`null` = 永久有效 |
| `announcements` | 面向该机器码的在线公告数组,**可能为空**;结构见接口 2 |
| `server_time` | 服务器时间,可用于对时 |

### 失败响应

```json
{ "ok": false, "error": "EXPIRED", "message": "验证码已过期" }
```

| error | 含义 | 软件端建议 |
|---|---|---|
| `INVALID_KEY` | 验证码不存在 | 提示"验证码无效" |
| `REVOKED` | 验证码已被取消 | 提示"已失效,请联系作者获取新码" |
| `EXPIRED` | 验证码已过期 | 提示"已过期,请联系续期" |
| `DEVICE_MISMATCH` | 已绑定其他机器码 | 提示"该验证码已被其他设备使用" |
| `BAD_REQUEST` | 缺少 `key` 参数 | 检查请求格式 |
| `RATE_LIMITED` | IP 限流(HTTP 429) | 一分钟后再试 |

---

## 2. 拉取在线公告(可选,也可用接口 1 的 `announcements` 字段)

```
GET /api/announcements?device_id=PC-USER123
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `device_id` | string | 建议 | 机器码;缺省只返回"全体公告",传了才能收到"定向公告" |

### 成功响应

```json
{
  "ok": true,
  "data": [
    {
      "id": 1,
      "content": "维护通知:今晚 23:00-24:00 服务维护",
      "link_url": "https://example.com/status",
      "publish_at": "2026-09-15T02:00:00.000Z",
      "target": "all"
    },
    {
      "id": 2,
      "content": "您的新版本已就绪",
      "link_url": "https://example.com/download",
      "publish_at": "2026-09-16T02:00:00.000Z",
      "target": "device"
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `content` | 公告内容,**纯文本**,直接按文本展示 |
| `link_url` | 附带链接,可能为 `null`;用户点击时用**系统默认浏览器**打开,不要内嵌浏览器 |
| `publish_at` | 发布时间(北京时间 UTC+8) |
| `target` | `all` = 全体公告;`device` = 发给当前机器码的公告 |

**软件端处理建议**:公告是增值功能,本接口失败时静默忽略,不影响软件可用性;`id` 可存本地用于去重,只展示新增公告;管理员设置的定时公告,到点后才会出现在返回里。

---

## 3. 开放模式自动分发(可选,配合"开放模式"开关使用)

管理员在后台开启"开放模式"后,软件端首次启动(本地没有验证码)时调用本接口,服务器自动创建一个验证码并绑定当前机器码,实现用户无感进入。

```
POST /api/open/distribute
Content-Type: application/json
```

```json
{ "device_id": "PC-USER123" }
```

### 成功响应

```json
{ "ok": true, "data": { "key": "K7QX9M-2WP4DZ-8RTH3C-VN5LSQ", "device_id": "PC-USER123" } }
```

### 失败响应(开放模式未开启时)

```json
{ "ok": false, "error": "OPEN_MODE_DISABLED", "message": "开放模式未开启" }
```

**软件端逻辑建议**:

```
启动 → 本地无验证码?
  ├─ 是 → POST /api/open/distribute
  │        ├─ ok   → 保存 key → 走正常 /api/validate 校验 → 进入软件
  │        └─ 失败 → 弹窗让用户手动输入验证码
  └─ 否 → 正常 /api/validate 校验
```

> 行为细节:同一机器码重复调用会原样返回已分发的验证码(不会重复发新码);管理员取消/过期该验证码后,校验照常失败——开放模式不影响管理手段;该接口与校验接口共享 IP 限流。

---

## 4. 健康检查(可用于软件端网络探测)

```
GET /api/health
```

```json
{ "ok": true, "time": "2026-09-15T12:00:00.000Z" }
```

---

## 限流说明

- 同一 IP 每分钟最多 **30 次**(校验/公告接口共享,可在服务端 `.env` 的 `RATE_LIMIT_MAX` 调整)
- 正常使用(每次打开软件各调 1 次)远达不到阈值;请勿在软件里写轮询循环高频调用

## 快速对接示例

**Python**

```python
import json, urllib.request, webbrowser

SERVER = "https://你的域名"

def startup_check(key, device_id):
    body = json.dumps({"key": key, "device_id": device_id}).encode()
    req = urllib.request.Request(f"{SERVER}/api/validate", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.load(resp)
    except Exception:
        return False, "无法连接验证服务器", []   # fail-closed,不能放行
    if not data.get("ok"):
        return False, data.get("message", "校验失败"), []
    return True, "", data["data"].get("announcements", [])

ok, msg, anns = startup_check("K7QX9M-2WP4DZ-8RTH3C-VN5LSQ", "PC-USER123")
for a in anns:
    print(a["content"])
    if a.get("link_url"):
        pass  # 用户点"查看"按钮时: webbrowser.open(a["link_url"])
```

**C#**

```csharp
static async Task<(bool ok, string msg, List<Ann> anns)> Validate(string key, string deviceId) {
  var body = JsonSerializer.Serialize(new { key, device_id = deviceId });
  var resp = await http.PostAsync($"{Server}/api/validate",
      new StringContent(body, Encoding.UTF8, "application/json"));
  using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
  bool ok = doc.RootElement.GetProperty("ok").GetBoolean();
  if (!ok) return (false, doc.RootElement.GetProperty("message").GetString() ?? "校验失败", new());
  var anns = new List<Ann>();
  foreach (var a in doc.RootElement.GetProperty("data").GetProperty("announcements").EnumerateArray())
    anns.Add(new Ann {
      Content = a.GetProperty("content").GetString(),
      LinkUrl = a.TryGetProperty("link_url", out var l) && l.ValueKind != JsonValueKind.Null ? l.GetString() : null,
    });
  return (true, "", anns);
}
// 打开链接(默认浏览器):
// Process.Start(new ProcessStartInfo { FileName = linkUrl, UseShellExecute = true });
```

**Node.js**

```javascript
const r = await fetch(`${SERVER}/api/validate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key, device_id: deviceId }),
});
const data = await r.json();
if (data.ok) showAnnouncements(data.data.announcements);
```

## 对接规范(重要)

1. **每次打开软件都实时调用接口 1**,通过才放行;不要缓存长期结果,否则"取消即失效"失效。
2. **网络异常 fail-closed**:连不上服务器按校验失败处理,不允许放行。
3. **机器码必须稳定**:同一台设备每次生成的 `device_id` 要一致(建议用系统硬件信息拼接后存本地文件),否则会触发 `DEVICE_MISMATCH` 或重复绑定。
4. 公告链接必须调用系统默认浏览器打开(见上例),不要在软件内嵌 WebView 加载外链。
5. 生产环境务必走 HTTPS。

> 管理端接口(生成验证码、发布公告、开放模式开关等)需要管理员登录,不对软件端开放,见 [api.md](api.md)。
