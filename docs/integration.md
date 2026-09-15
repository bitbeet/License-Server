# 软件接入指南(通用)

本文面向任何自制软件(桌面端 / 移动端 / 脚本等),说明如何接入本验证服务,实现"**每次打开软件校验激活码,通过才允许使用**"。接入方式与语言无关,核心就是**调用一个 HTTP 接口 + 按返回结果决定是否放行**。

## 一、接入前准备

1. 部署好验证服务,拿到接口地址,例如 `https://你的域名`(本地测试可用 `http://localhost:8080`)。
2. 用浏览器打开 `https://你的域名/`,登录管理后台,生成验证码并分发给用户。
3. 在软件里预留一个配置项存放服务器地址(建议集中放在一个常量 / 配置文件,方便改)。

## 二、校验接口

```
POST {服务器地址}/api/validate
Content-Type: application/json
```

请求体:

```json
{
  "key": "K7QX9M-2WP4DZ-8RTH3C-VN5LSQ",
  "device_id": "PC-UNIQUE-ID"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | string | 用户输入的验证码 |
| `device_id` | string | 设备唯一标识,用于"一码一设备",**建议必填** |

响应(校验通过,HTTP 200):

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

响应(校验失败,HTTP 200;限流为 HTTP 429):

```json
{ "ok": false, "error": "EXPIRED", "message": "验证码已过期" }
```

完整错误码见下文第五节。

## 三、整体接入流程(必须按此逻辑做)

```
软件启动
  │
  ├─ 读取本地保存的验证码
  │    ├─ 不存在(第一次打开) ──► 弹出输入框让用户填验证码
  │    │                           POST /api/validate { key, device_id }
  │    │                           ├─ ok      ► 只显示"验证成功",保存 key + device_id,进入软件
  │    │                           └─ 失败    ► 只显示"验证失败",可重试;关闭输入框 = 退出软件
  │    └─ 已存在 ──► 静默校验 POST /api/validate { key, device_id }
  │                     ├─ ok               ► 不弹任何窗口,直接进入软件
  │                     ├─ EXPIRED / REVOKED ► 弹提示"联系作者",退出软件(不允许使用)
  │                     │   / INVALID_KEY
  │                     │   / DEVICE_MISMATCH
  │                     └─ 网络错误           ► 弹提示"无法连接验证服务器",只能"重试"或"退出"
  └─ 校验通过后,软件正常启动
```

### 必须遵守的 4 条规则

1. **只在打开时校验一次**,不要做周期 / 定时检测,也不要缓存校验结果过夜。
2. **首次填码结果只显示成功 / 失败**,不做详细解释(错误原因由作者后台查看)。
3. **过期 / 被取消 / 被换机**:提示用户"联系作者",**禁止进入软件**。
4. **断网不能绕过**:网络异常一律按"校验失败"处理,只能重试或退出,**不得放行**。

## 四、设备标识(device_id)

- 首次运行时生成一个**唯一且稳定**的 ID 保存在本地(如 `pc-` + UUID、`android-` + 设备序列号、MAC 等),之后保持不变。
- 服务端在首次校验成功时把该 `device_id` 绑定到验证码上,**同一个码换设备会被拒绝**(`DEVICE_MISMATCH`)。
- 用户重装系统 / 清数据导致 ID 变化时,管理员可在后台对该验证码执行"解绑设备",用户重新输入即可。

## 五、错误码处理

| error | 含义 | 软件端处理 |
|---|---|---|
| `INVALID_KEY` | 验证码不存在 | 首次输入时显示"验证失败";已有保存码时提示联系作者 |
| `REVOKED` | 已被管理员取消 | 提示联系作者,退出 |
| `EXPIRED` | 已过期 | 提示联系作者续期,退出 |
| `DEVICE_MISMATCH` | 已绑定其他设备 | 提示联系作者解绑,退出 |
| `RATE_LIMITED` | 该 IP 请求过于频繁 | 提示稍后重试(正常使用不会触发) |
| `BAD_REQUEST` | 缺少 `key` 参数 | 检查请求格式 |
| `NETWORK_ERROR`(客户端自行判断) | 连不上服务器 / 请求异常 | 提示检查网络,只能重试或退出 |

## 六、代码示例

核心逻辑:先取本地 key;无 key 则弹输入框;有 key 则静默校验;网络异常不通过。

### JavaScript / Node.js(带 UI 的桌面 / 移动软件)

```javascript
// config
const SERVER = 'https://你的域名'
// device_id 首次运行时生成并存本地
const DEVICE_ID = getOrCreateDeviceId()   // 例如 'pc-' + crypto.randomUUID()

async function validate(key) {
  const res = await fetch(`${SERVER}/api/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, device_id: DEVICE_ID }),
    signal: AbortSignal.timeout(10000),
  })
  const data = await res.json()
  if (data.ok) return { ok: true }
  return { ok: false, error: data.error || 'INVALID_KEY' }
}

async function checkLicense() {
  const savedKey = getLocalKey()               // 从本地读
  if (!savedKey) {
    // 第一次打开:弹输入框,只显示成功/失败
    const key = await showInputDialog()        // 用户填码;关窗返回 null
    if (!key) { app.exit(); return false }     // 不填码 = 不给你用
    const r = await validate(key)
    if (r.ok) { saveLocalKey(key); return true }   // "验证成功"
    showResult('验证失败')                       // 只显示失败,可重试
    return checkLicense()                        // 重来
  }
  // 后续打开:静默校验
  while (true) {
    const r = await validate(savedKey)
    if (r.ok) return true                        // 直接进入,不弹窗
    if (r.error === 'NETWORK_ERROR') {           // 断网:只能重试/退出
      if (await confirmRetry()) continue
      app.exit(); return false
    }
    showDialog('授权已失效,请联系作者')            // 过期/取消/换机
    app.exit(); return false
  }
}
```

> `getLocalKey` / `saveLocalKey` 请存到应用自己的数据目录;`DEVICE_ID` 也必须持久化,别每次生成新的。

### Python

```python
import json, socket, uuid, urllib.request

SERVER = "https://你的域名"

def device_id():
    return "pc-" + str(uuid.uuid4())  # 生成后写进本地文件,以后复用

def validate(key, dev_id):
    body = json.dumps({"key": key, "device_id": dev_id}).encode()
    req = urllib.request.Request(f"{SERVER}/api/validate",
                                 data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.load(resp).get("ok") is True
    except Exception:
        return False   # 网络异常 = 校验失败,不能放行

# 启动时:
# 1) 有本地 key → validate(key) 为 True 才继续,否则提示联系作者退出
# 2) 无本地 key → 输入框(如 tkinter 简窗)填码 → 通过则保存,失败只提示"失败"
```

### C#

```csharp
using System.Net.Http;
using System.Text.Json;

static class License {
  const string Server = "https://你的域名";
  static readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(10) };

  public static async Task<bool> Validate(string key, string deviceId) {
    try {
      var body = JsonSerializer.Serialize(new { key, device_id = deviceId });
      var resp = await http.PostAsync($"{Server}/api/validate",
        new StringContent(body, Encoding.UTF8, "application/json"));
      using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
      return doc.RootElement.GetProperty("ok").GetBoolean(); // 网络异常会在 try 外返回 false
    } catch { return false; }
  }
}
```

> 其余语言(Java / Go / Swift / 易语言等)同理:一个 HTTP POST + JSON 解析即可,无需 SDK。

## 七、注意事项与安全

1. **校验必须放在可信侧**(桌面软件的主进程 / 原生层),不要只写在网页 / 纯渲染层,否则用户改前端就能绕过。
2. **网络异常 fail-closed**:服务器连不上 = 不允许使用,不要为了"体验"放行离线,否则用户断网即可绕过。
3. **不缓存长期结果**:每次打开都实时调接口,服务器才能做到"取消即失效"、记录最后打开时间。
4. **生产环境用 HTTPS**,避免验证码明文被截获;请求体加 `device_id` 以启用一码一设备。
5. **限流**:默认每 IP 每分钟 30 次校验,正常使用不会触发。
6. **解绑 / 延期**:在管理后台操作,无需改代码;后台日志可追踪每个验证码的使用情况(IP、设备、时间、结果)。

## 八、验收清单(接入完自测)

- [ ] 第一次打开弹输入框,输错显示"失败",输对显示"成功"并进入软件
- [ ] 第二次打开不弹窗,直接进入软件(静默校验)
- [ ] 后台取消验证码 → 再打开软件提示"联系作者"且无法使用
- [ ] 后台把验证码设为过期 → 同上
- [ ] 断网打开软件 → 提示无法连接,重试无效时只能退出,进不去软件
- [ ] 同一个验证码在另一台设备用 → 拒绝

## 九、在线公告(可选)

管理员可在后台"公告"页发布在线公告,用户打开软件时随校验结果一起收到,无需更新软件本身。

### 服务端给了什么

校验通过的响应里多了一个 `announcements` 数组(也可以单独调 `GET /api/announcements?device_id=你的机器码` 刷新,见 api 文档):

```json
"announcements": [
  {
    "id": 1,
    "content": "新版本 2.0 已发布,建议更新",
    "link_url": "https://example.com/download",
    "publish_at": "2026-09-15T10:00:00.000Z",
    "target": "all"
  }
]
```

- `target: "all"` 是发给全体用户的;`target: "device"` 是只发给当前机器码的(靠校验时传的 `device_id` 区分用户)。
- 管理员设置定时发送的公告,到点后才会出现在返回里;即刻发送的立即可见。

### 软件端怎么展示

公告是纯文本 + 一个可选链接字段,展示逻辑由软件端自己定(比如启动后弹出一个小窗口,或主界面顶部滚动一条):

1. 取 `announcements` 数组,把每条 `content` 显示出来。
2. 若 `link_url` 不为 `null`,放一个"点击查看"按钮/超链接,**点击时调用系统默认浏览器打开**,不要在软件内嵌浏览器加载。

各语言用默认浏览器打开链接的方式:

**C#**
```csharp
System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo {
  FileName = linkUrl,
  UseShellExecute = true   // 用系统默认浏览器打开
});
```

**Python**
```python
import webbrowser
webbrowser.open(link_url)
```

**Node.js / Electron**
```javascript
require('child_process').execFile('cmd', ['/c', 'start', '', linkUrl], { windowsHide: true });
// 跨平台可用 npm 包 `open`: const { open } = require('open'); open(linkUrl);
```

### 接入建议

- 公告接口失败(网络异常等)时**静默忽略即可**,公告是增值功能,不要因为它影响软件可用性。
- 公告是纯文本下发,软件端直接按文本展示即可;如果要在软件里自动把内容中的网址变成可点击链接,由软件端做(用正则识别 URL),服务端不会下发 HTML,避免注入风险。
- `id` 可用来去重:同一台设备上已展示过的公告 id 存本地,下次启动只展示新增的。
