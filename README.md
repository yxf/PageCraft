# PageCraft · 页匠

自建工具新增“自动启动”：可选择全站或指定网址，支持 SPA 路由重运行；打开、刷新和重启浏览器后自动加载，停用或更新时清理已注册资源。旧工具默认仍为手动运行。

支持自建通用工具：在“工具 → 创建工具”中使用自然语言生成或手写异步 JavaScript，试运行后保存，可跨网页重复使用。支持参数、结果预览、下载和最近 10 个版本恢复。详见 [自定义工具接口](docs/CUSTOM_TOOLS.md)。

新增“工具”页：可视区域截图、整页截图、页面文本提取，支持预览、下载及任务取消，不需要指定网站规则或配置 AI。详见 [通用工具](docs/TOOLS.md)。

> 当前开发模式（优先于下文旧版安全设计）：已移除生成代码的 API、标签、属性、动态访问、CSS 及代码长度限制，并放宽 USER_SCRIPT CSP。只检查 JavaScript 语法、返回数据结构和非空结果。任意生成代码可能读取页面数据、联网或产生不可撤销副作用，仅用于测试网页。API Key 隔离、站点授权、浏览器自身限制、任务取消和版本管理仍保留。下文原有静态安全检查描述不再代表当前实现。

让每个网页，都按你的方式工作。

PageCraft 是一个计划开发的 AI 浏览器扩展：用户用自然语言描述需求，扩展根据页面上下文生成网页改造脚本，立即应用并保存，在后续访问匹配网页时自动运行。

## 项目状态

0.1 本地开发版已实现，`dist/` 是可加载的 Chrome Manifest V3 扩展。不附带 API Key，尚未发布商店。

## 文档

- [产品需求文档](docs/PRD.md)：产品定位、MVP、交互、技术约束、验收标准及开发阶段。

## 已确定的方向

- Chrome 优先，Manifest V3；Edge 后续进行兼容验证。
- 支持 OpenAI、DeepSeek、Google Gemini、Claude，独立保存各服务商 Key、模型 ID 和授权，无自建 AI 代理服务。
- 支持自定义网站匹配规则。
- 生成通过校验后直接应用，支持保存、禁用、删除和版本回退。
- 核心价值是持久化网页定制，而不是通用跨站任务代理。

## 安装试用

1. Chrome 138+ 打开 `chrome://extensions`，开启开发者模式。
2. 点击“加载已解压的扩展程序”，选择 `/Users/yxf/ai/pagecraft/dist`。
3. 在 PageCraft 扩展详情中开启“允许用户脚本”。
4. 打开普通网页，点击 PageCraft 图标打开侧边栏。
5. 在设置页选择服务商，填写对应 API Key 和支持 JSON 输出的模型 ID，确认页面摘要发送说明，保存设置。
6. 输入需求，检查匹配范围，点击“生成并应用”，按浏览器提示授予站点权限。

API 调用由所选服务商账户计费。模型 ID 自行填写，不固定某个型号作为长期默认。真实 AI 生成需要用户自己的 Key，测试不使用真实 Key。切换后保存才会应用，旧 OpenAI 配置自动迁移。更新后需重新加载扩展并确认新增 API 域名权限。

## 已实现

- 中文侧边栏、改造管理、设置页、页面上下文预览与元素选择。
- 四家原生 API 流式接收和 JSON 校验、接收进度、4 分钟超时、取消、拒绝与限流反馈。见 [服务商接入](docs/PROVIDERS.md)。
- AST 检查、USER_SCRIPT 隔离执行、幂等初始化、清理助手及 SPA 路由支持。
- 自定义包含/排除规则、本地保存、自动恢复、源码编辑、最近 10 个版本回退。
- 启用/禁用、删除与 10 秒撤销、每标签页草稿、后台恢复、Key 隔离。

## 开发与测试

需要 Node.js 22.12+。

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

修改代码后重新构建，在 Chrome 扩展管理页刷新扩展，再刷新目标网页。

`npm run dev` 在 `http://127.0.0.1:5173` 启动界面预览。普通网页预览不能访问扩展 API；完整功能需要加载 `dist/`。本地验收页为 `/fixtures/article.html`。

```text
src/main.tsx      侧边栏、管理页、设置页
src/worker.ts    后台任务、权限、脚本注册与恢复
src/ai.ts        Responses API 与结构化输出
src/context.ts   页面摘要与元素选择
src/check.ts     AST 与 CSS 检查
src/runtime.ts   用户脚本生命周期
src/rules.ts     URL 匹配与权限范围
src/store.ts     串行存储事务
tests/           核心测试和确定性示例脚本
scripts/e2e.mjs  独立 Chromium 端到端测试
```

## 边界与记录

- [验证记录与待验证项](docs/VERIFICATION.md)
- [隐私说明](docs/PRIVACY.md)
- [运行器接口](docs/RUNTIME.md)

AST 检查不是完整安全沙箱，USER_SCRIPT 与网页仍共享 DOM。未完成真实模型生成质量验收，未验证 Edge。任意脚本修改无法保证完全撤销，必要时刷新网页。
