# 手机无配对码 OAuth 调研与实测

日期：2026-10-15。目标是 iPhone 上点击登录、浏览器授权、自动返回插件并保存会话，不要求用户输入配对码或粘贴失败回调网址。当前未完成这项验收，不能以已安装桌面 OAuth 或手机配对码界面替代。

后续范围调整：用户已暂缓无配对码登录和电脑凭据交接，先自行在手机完成登录，要求完成现有手机功能测试。真实 ChatGPT 手机验收现已通过，见 `phase1-iphone-live-qa.json`；这不改变本文件对无配对码流程尚未完成的结论。

## 已确认的边界

- **Obsidian 手机能接收浏览器回调。** 在 iPhone Air / iOS 27.0.1 / Obsidian 1.14.5 的独立 `Chatting Phase1 QA` 库中，临时插件注册协议处理器，通过 Safari 网页中的 `obsidian://` 链接返回。系统确认打开 Obsidian 后，插件收到参数，匹配合成 state，并显示 PASS。没有进行真实账号授权或 token 交换。
- **OpenAI 的回调限制经过真实请求验证。** 对相同 client 的授权请求仅替换 redirect；固定 Codex client 的 localhost 回调和新官方 OSS client 的 `127.0.0.1` 回调能进入账号选择页，`obsidian://` 被拒绝。新官方端点明确返回 `invalid_authorize_request`、`param: redirect_uri`。未选择账号或提交授权。
- **弹出浏览器与拿到授权结果是两个条件。** 真实手机存在 Capacitor `Browser`，但不存在原生 `InAppBrowser` 或 Cordova InAppBrowser。Browser 探针收到 `browserPageLoaded`，事件没有参数；两种启动方式均未观察到可见浏览器 sheet，故弹窗呈现和自动 dismiss 未验收。不能把收到 pageLoaded 算成完整 UI 成功。
- **未读取或改动主库 `o1x`。** 临时插件、合成测试链接、运行报告仅在测试库创建，结束后已归档到 SSD scratch 并移除；临时 LAN HTTP 服务和研究浏览器标签已关闭。抽查期间打开的测试 README 与复制来源哈希一致。

## 其他插件怎么做

以下为固定 commit 的源码观察；除上面的自有探针外，没有声称替其他插件完成账号登录。

| 插件 | 手机实现 | 是否证明本项目能直接自动登录 ChatGPT |
| --- | --- | --- |
| [Air Sync](https://github.com/takezoh/obsidian-air-sync/tree/a5f7ef1094e057796ebf5bbf8411b0989608ca9c) | Dropbox / OneDrive 使用已注册的 `obsidian://air-sync-auth`，PKCE、state、协议回调后换 token；Google 使用 HTTPS relay | 证明架构可行，不能替 OpenAI 注册或放宽 redirect |
| [Remotely Save](https://github.com/remotely-save/remotely-save/tree/34db181af002f8d71ea0a87e7965abc57b294914) | Dropbox / OneDrive 使用 Obsidian 协议处理器 | 同上 |
| [Smart Composer](https://github.com/glowingjade/obsidian-smart-composer/tree/6b38ab3c57e03c5c6cbeb79815277857df59cbd8) | Codex auth 源码禁止手机启动 localhost server，并提供手动粘贴完整回调网址的路径 | 没有证明自动返回 |
| [Vault Scout](https://github.com/floorianmb/vault-scout/tree/803e7ee2de11b1ac5af2b7e458ddd1ae2dd4fc77) | 已接新官方 OSS SIWC，手机仍手动粘贴失败的 loopback 回调网址 | 可参考新 API 接入，未达到本项目目标 |

关键源码：Air Sync 的 `src/backends/shared/auth-config.ts`、`pkce-module-auth.ts`；Remotely Save 的 `src/fsDropbox.ts`、`src/main.ts`；Smart Composer 的 `src/core/llm/codexAuth.ts`；Vault Scout 的 `src/auth.ts`。

## 授权入口对照

每个 client 内保留同一组 PKCE/state 等参数，比较 redirect。这里只测试授权入口，不代表完成授权、换 token 或 inference。

| 入口 | redirect | 实际结果 |
| --- | --- | --- |
| 现有固定 Codex client | `http://localhost:1455/auth/callback` | OpenAI 账号选择页 |
| 同上 | `obsidian://chatting-oauth-probe` | `invalid_authorize_request` |
| 同上 | 假设的项目 GitHub Pages HTTPS callback | `invalid_authorize_request`；没有部署该页面 |
| 新官方 OSS `dynamic_agent_client` | `http://127.0.0.1:1455/auth/callback` | 显示 Chatting with AI 名称的官方登录页 |
| 同上 | `obsidian://chatting-oauth-probe` | `invalid_authorize_request`，`param=redirect_uri` |

## 新官方 Sign in with ChatGPT 应纳入功能方案

[官方 OSS 注册与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)和[官方接入文章](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)提供了动态 client 注册。它不同于当前固定 Codex client + ChatGPT backend 适配器，不能只替换登录网址：

- 首次 `dynamic_agent_client`、实际应用名、稳定的每设备 host ID；回调返回 issued client ID，之后使用该 ID。
- 每次新建 state、OIDC nonce、PKCE S256；验证 OpenAI JWKS 签名、issuer、audience、expiry、nonce 和账号身份；新授权通过前保留原有活跃账号。
- 计划使用权限为 `chatgpt.tokens.use.direct` 等；通过 `api.openai.com/v1` 进行推理，遵守[预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)。不能沿用旧 backend 的所有字段或会话链。
- 文档当前要求从首次注册起使用 HTTP `127.0.0.1`，同次 exchange 的 URI 必须完全一致；后续只能更换端口。
- 所有会话凭据继续使用 SecretStorage，不写入库文件、日志、调研报告或 Todoist。

## 对“App 内网页登录后自动 dismiss”的判断

[Capacitor Browser](https://capacitorjs.com/docs/apis/browser) 在 iOS 使用 SFSafariViewController。其 `browserPageLoaded` 仅针对初始页面，既不提供 URL，也不通知后续每次导航；`browserFinished` 是用户关闭事件。[原生实现](https://github.com/ionic-team/capacitor-plugins/blob/main/browser/ios/Sources/BrowserPlugin/BrowserPlugin.swift)发送的事件数据为 nil。真实手机探针观察到的事件字段为空，与公开接口一致。

因此，只有 Browser.open/close 还不足以从最终 `127.0.0.1` 导航取得 code。接收已注册的 `obsidian://` 回调后关闭浏览器是合理设计，但首先要解决 provider 接受回调的问题。另一个带导航事件的 [Capacitor InAppBrowser](https://capacitorjs.com/docs/apis/inappbrowser) 需要宿主原生集成；当前手机没有它，安装 npm JS 包不会添加 iOS 原生能力。

## 下一步必须验证的具体条件

1. 核实 OpenAI 是否能为本应用开放可用于 **ChatGPT plan usage** 的手机自定义协议或 HTTPS 回调。[申请 client ID](https://developers.openai.com/siwc/request-client-id)页面不是这项权限的证据；不能把身份登录 client、合作伙伴资格和 OSS 计划使用权限混为一谈。获得明确允许后，用 PKCE + Obsidian handler 完成真机自动返回原型。
2. 若仍只允许 loopback，需要宿主暴露原生 loopback listener / 导航回调，或单独原生桥接应用。后者会改变产品流程，尚未实现或验收，不能描述为纯 Obsidian 插件已支持。远端 relay 本身接不到手机 `127.0.0.1`，不能当作现成解决方案。
3. 完整验收包括用户在手机授权、自动回到插件、无需复制/输入码或 URL、显示 Connected、真实推理成功、强退重开后会话可用，以及取消、错误 state、重复回调不会替换账号。以上账号级验收本次均未完成。

配对码和手动粘贴 URL 都不能关闭这项需求。当前证据足以纠正“Obsidian 手机不支持 OAuth”的错误结论，也足以定位现有接口的缺口；不能据此宣称所有实现路径都不可能。
