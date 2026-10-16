# 第二期整合审查：PR #24–#30

基线为 0.5.0，独立分支 `codex/phase-2-pr-24-30`。作者七个连续提交通过合并保留，不重复应用 #20–#23。版本及后续补修均放入同一个集成 PR。

## 逐层检查

- #24：元数据查询、标签嵌套、属性匹配及 links/backlinks 兼容入口。复审补修大量提及时的行号扫描，并合并排除区间，避免二次方扫描。补修只查询 frontmatter 自有属性，避免继承属性误匹配。
- #25：Canvas 原子 process 写入、失败整批不改、选区保护、未知字段保留。补修畸形几何数据及重复 ID 的读取校验，避免改写不可靠输入。
- #26：requestUrl 读取网页，只接受 http(s)，清理页面噪音并将来源声明为信息。保留作者的本机可达地址语义，包括用户请求的内网页面；不附加提供商 API 凭据。该功能不等于浏览器登录会话或 JavaScript 页面执行。
- #27：发送快捷键、可开关日志、保持亮屏和安静停止状态。补修日志写入顺序、Clear/Copy 与未完成写入的竞争及异步写入失败处理。
- #28：编辑/重新生成共同截断 UI/API 历史，保留原选区，已被裁剪的 turn 不允许编辑。补修新保存的选区字段校验，避免损坏记录使界面崩溃。
- #29：实际图像工具、Canvas 渲染、老工具图像不重复发送。复审补充同轮图片预算：请求最多保留最近 4 张工具图片、合计 10 MiB，按真实 base64 长度估算，不信任存储中的 sizeBytes。Canvas 预览先检查原图字节数与 PNG/JPEG/GIF/WebP 头部尺寸；超过 4 MiPixels、单边 8192 px 或 10 MiB 的图片只显示文件卡片并在工具结果中列明，不触发原图解码。补修长连续文本的预览排版，只计算可见行，并用二分查找拆分长词，避免手机上的大量无效测量。
- #30：存储 v2、附件数据只存于 API 历史、恢复 UI 图片、未来版本保护。补修 API 图片结构校验，在恢复前拒绝损坏图片并使用可读副本。

## 验证状态

整合初始 306 项测试通过；补修及两轮复审修复后 316 项测试、TypeScript、Svelte（0 错误/警告）及生产构建通过。新增回归已先复现对应缺陷。

桌面 Obsidian 1.13.7：独立原生 helper 调用真实工具源代码和 Vault/metadataCache/process/requestUrl/Canvas 2D，未替换生产 agent 或模型适配器。元数据、链接、Canvas 失败整批不改与选区保护、图片解码/编码、网页读取均通过。另用有效的 8000×6000 PNG 检查大图预览保护，正常小图照常渲染。

真实 ChatGPT（gpt-6.1-sol）：桌面生产插件完成 query_notes、get_links、read_canvas、view_image、view_canvas、read_web_page，回复 PHASE2-DESKTOP-TOOLS-OK 并正确识别 PHASE 2 和 QA link。另发送真实附件，保存 v2 后重载恢复附件与 turn ID；通过实际界面的 Edit/Save 与 Regenerate 再次识别图片。附件在 agentMessages 中只有一个该附件记录，UI 元数据无 base64；相同图片分别作为工具结果和用户附件出现时属于两次独立输入。Debug log 的 USER_MESSAGE/API_RESPONSE 写入通过，恢复关闭设置。关闭 Enter 发送后回车保留草稿，Cmd+Enter 实际发送并收到 PHASE2-KEYBOARD-OK，随后恢复原设置。

iPhone Air / Obsidian 1.14.5：仅部署到 Chatting Phase1 QA 测试库，未复制凭据。iCloud 初次传输不完整时插件未加载；文件到齐后重新加载识别 0.6.0，旧聊天与 ChatGPT 登录保留。生产 ChatGPT 完成八种工具调用（另含 list_metadata 和 edit_canvas），只在 QA/Phase2-20261015/Board.canvas 添加一个 PHONE-PHASE2-OK 卡片；正确返回 PHASE2-PHONE-TOOLS-OK、PHASE 2、QA link。实际界面编辑并重新生成得到 PHASE2-PHONE-EDIT-OK，保存格式为 v2。

保护检查：桌面原有 1795 个、手机测试库原有 1798 个可见文件哈希均未变化；新增测试内容均位于 QA/Phase2-20261015。桌面临时 helper 已禁用，手机旧 synthetic helper 保持禁用。主库未访问。

最后的精确分支/发布门禁以集成 PR #49、GitHub CI 和 Community 实时结果为准；Pending 或 incomplete 不视为通过。真实服务验证使用 ChatGPT；Anthropic/OpenAI API key 的适配验证是自动 fixture，未冒称真实账户调用。保持亮屏只在设备支持 Wake Lock 时生效，本次没有长时间自动锁屏测量。

只使用桌面隔离测试库和 iCloud 手机隔离测试库。主库不访问，不复制 SecretStorage 凭据。存储迁移的自动 fixture、原生运行和真实模型调用分别记录；版本降级会保留新版存档并以空聊天启动，不宣称旧版可读取 v2。
