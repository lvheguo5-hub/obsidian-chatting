# 第一期 PR #20–#23 审查与验证

基线：`f642d3085582cd5e8af177c6f91c2c2d74e6ef7a`（0.4.2）。
集成分支：`codex/phase-1-pr-20-23`。四个原 PR 的提交与归属完整保留，按顺序生成 merge commit；尚未合并 main、修改版本或发布。

## 逐层审查

| PR | 固定 head | 审查范围与结论 |
| --- | --- | --- |
| #20 | `001196cb6ab77a8063edd7c7f96d6ce4aab80950` | 数学 Markdown 与滚动；补修跨行 code span 及不同长度反引号导致的公式误转换。 |
| #21 | `3d454bce4283c6b18ab7aa325816224560e87f6f` | 工具状态、参数/结果展开、错误标记；原生 UI 检查通过。 |
| #22 | `b327aa853b1f3d839cf6fe779c08da79235bc0ed` | 桌面 padding、手机键盘 lift、输入高度与控件尺寸；原生桌面和移动模拟通过，物理 iPhone 候选版未验。 |
| #23 | `245d5b6c1710e6b7e1c05daa6dcf3b1ac6a1cc35` | 模型目录、设置、适配器、启动恢复；补修明确不支持 thinking 的模型仍按名称启用 thinking，保留负能力信息并验证保存/重载。 |

## 验证

- 203 项自动测试通过；TypeScript、Svelte（0 errors / 0 warnings）、生产构建通过。
- 原生 Obsidian 1.13.7：升级保留可见/API 历史，真实设置下拉框、数学渲染、工具执行中/成功/错误及展开、滚动跟随/保持阅读位置/跳到底部、IME 确认均通过。测试结束恢复原聊天和设置，候选插件仅安装于隔离测试库。
- 420×912 桌面移动模拟：无横向溢出，44px 输入；合成 300px 键盘时输入底部 601px，键盘顶部 612px。移动模拟与合成键盘不能替代物理 iPhone。
- 真实 ChatGPT OAuth / `gpt-6.1-sol` / `low`：生产 agent 和适配器返回固定标记，无错误；本轮不操作笔记，未改写保存的聊天。
- 隔离库 1,780 个受保护资料文件 SHA-256 无变化。
- 物理 iPhone 控制 READY；设备文件接口无法列出 Obsidian appDataContainer，候选构建未部署到手机隔离库，真机 QA 保留未完成。真实 Anthropic/OpenAI API-key 路径未验证，相关参数路径仅有自动回归。

去敏结果见 `phase1-native-qa.json`、`phase1-mobile-emulation.json`、`phase1-live-qa.json`。原生脚本 `test/native-phase1-qa.cjs` 使用真实生产构建；合成目录只在内存使用，设置保存被临时替换，避免写入凭据。

## 交付条件

最终候选提交的 GitHub CI 与 Community Review branch 仍需实时核对；原 PR 的 CI 不替代集成分支 CI。物理 iPhone 验证缺口必须在交付中说明。合并、tag、版本号与正式发布等待用户后续授权。
