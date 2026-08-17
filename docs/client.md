# 桌面客户端接入指南(lx / ikun-music-desktop)

本文是 [integration.md](integration.md) 通用接入指南的**具体落地示例**,面向本项目自带的桌面音乐客户端。通用接入逻辑(校验流程、规则、fail-closed 等)请先读通用指南。

## 交互规则(客户端已实现)

- **每次打开软件**都在主进程发起一次校验,通过才创建主窗口,期间不做周期检测。
- **第一次打开**:弹出"软件授权"输入窗,填验证码,结果**只显示"验证成功" / "验证失败"**(不做详细解释)。
- **验证通过后**:验证码与设备 ID 保存在本地(`userData/LxDatas/license.json`),之后每次打开**静默校验**,不再弹窗。
- **过期 / 被取消 / 被换机**:弹出提示"授权已失效,请联系作者",无法进入软件。
- **断网 / 服务器不可达**:弹窗提示"无法连接验证服务器",只能**重试或退出**,**不允许离线绕过**。
- 关闭授权输入窗(不填码)= 拒绝使用,软件直接退出。

## 涉及的文件(客户端)

| 文件 | 作用 |
|---|---|
| `src/main/modules/license/config.ts` | **改这里**:授权服务器地址、联系作者方式 |
| `src/main/modules/license/index.ts` | 校验逻辑、授权窗口、存储、提示弹窗 |
| `src/static/license/license.html` | 激活码输入窗 UI |
| `src/common/ipcNames.ts` | 新增 `license.submit` IPC 名 |
| `src/common/constants.ts` | 新增 `LICENSE` store 名 |
| `src/main/index.ts` | 启动时先 `checkLicense()`,通过才 `registerModules()` |
| `src/main/app.ts` | 单实例二次启动时,授权中则聚焦授权窗而不是退出 |

## 部署后需要改的配置

编辑 `src/main/modules/license/config.ts`:

```ts
// 改成你部署好的服务器地址(本地测试可用 http://localhost:8080)
export const LICENSE_SERVER_URL = 'https://你的域名'

// 可选:过期/失效时提示用户联系你的方式(QQ / 微信 / 邮箱),留空则只显示"请联系作者"
export const CONTACT_AUTHOR = ''
```

改完重新打包客户端生效:

```bash
npm run pack:win:setup:x64   # 以 Windows x64 安装包为例
```

## 客户端校验流程

```
软件启动
  └─ 读取本地 license.json
       ├─ 无验证码 ──► 弹出授权输入窗 ──► 输入激活码
       │                  POST /api/validate { key, device_id }
       │                  ├─ ok       ► "验证成功",保存 key,继续启动
       │                  └─ 失败     ► "验证失败",可重试;关窗即退出
       └─ 有验证码 ──► 静默校验 POST /api/validate
                        ├─ ok              ► 继续启动(不弹窗)
                        ├─ 过期/取消/换机  ► 提示"请联系作者",退出
                        └─ 网络错误        ► 提示"无法连接",重试或退出
```

- `device_id` 首次运行自动生成并保存在本地,之后保持不变 → 天然实现"一码一设备"。
- 校验在主进程完成,渲染层无法绕过;网络异常一律 fail-closed(禁止使用)。
- 服务器返回的 `last_seen` 会随每次打开更新,后台"最近校验"即用户最后使用时间。

## 注意事项

1. 服务器必须能被客户端访问:**不要只监听本机**,并确保防火墙 / 安全组放行(见 [deploy.md](deploy.md))。
2. 生产环境务必配 HTTPS,避免验证码在传输中被截获。
3. 若用户重装系统 / 清空软件数据,`device_id` 会变,同一验证码会报"已被其他设备使用"。可在后台该验证码上点"解绑设备"后让用户重新填入。
4. 校验限流默认每 IP 每分钟 30 次,正常用户一天也只打开几次软件,不会触发。
