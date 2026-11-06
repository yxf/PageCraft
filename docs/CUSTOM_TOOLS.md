# 自定义通用工具

## 使用流程

1. 重新加载扩展，在扩展详情开启“允许用户脚本”。
2. 打开普通 HTTP/HTTPS 网页，进入 PageCraft 的“工具 → 创建工具”。
3. 选择自然语言生成或手动编写。AI 模式使用设置中已保存且授权的服务商；默认不采集页面摘要。生成结果只进入编辑器，不保存、不执行。
4. 编辑工具名称、说明、JavaScript、JSON 参数和可选临时 CSS。
5. 点击试运行，检查结果，再点击保存工具。试运行是真实执行，可能改变网页。
6. 从“我的工具”重复运行，或编辑、删除、恢复历史版本。保存保留最近 10 个版本，切换网页或重启浏览器后仍可使用。

工具默认手动运行，也可开启自动启动。通用性取决于代码是否依赖特定页面结构。保存和手写无需模型 Key；运行需要对应网站权限。Chrome 内部页不支持。

## 自动启动

编辑工具时勾选“自动启动”，选择“所有网站（需授权）”或“指定网站”，后者每行一个匹配规则，例如 `https://example.com/*`。保存时申请范围对应的网站权限，拒绝授权则不保存。全站模式要求普通 HTTP/HTTPS 全站授权，不绕过浏览器限制。

保存后立即同步到已打开的授权页面，新打开、刷新和浏览器重启后自动初始化。配置随工具版本保存和回退；旧工具保持手动模式。取消勾选并保存、删除、版本更新或离开匹配范围时清理旧实例。重复同步不会重复初始化。路径规则不含端口、查询参数和 fragment，与网页改造规则一致。

“SPA 路由变化时重新运行”默认关闭：关闭时范围内路由变化保留实例；开启时 URL（包括查询或 hash）变化会清理再初始化。无论是否开启，离开范围都会清理，返回范围重新运行。路由检测约 750ms 一次；撤销授权后已注入实例最长约 5 秒停止。清理依赖代码正确注册回调，不能撤销任意副作用。

自动模式下 `ctx.onCleanup` 在实例停用时执行，函数正常返回不会触发清理；`ctx.signal` 的生命周期也随实例。临时 CSS 常驻到实例结束。自动初始化返回值不显示到侧边栏；需要展示结果的工具应在网页创建 UI。`ctx.tools.download` 在自动模式直接在页面发起下载，不依赖侧边栏，但受浏览器下载策略限制。截图和提取文本仍可调用，截图需要当前标签页激活及已有权限，不会自动弹出授权窗口。

先开启自动启动再生成代码，AI 会按常驻生命周期生成，通常将截图、下载、提交等动作放到按钮点击事件中。切换旧工具为自动模式不会自动改写源码，请检查原脚本是否适合反复自动执行。

```js
const button = document.createElement('button');
button.textContent = '提取正文';
document.body.append(button);
const run = async () => {
  try { await ctx.tools.download(await ctx.tools.extractText()); }
  catch (error) { console.error(error); }
};
button.addEventListener('click', run);
ctx.onCleanup(() => {
  button.removeEventListener('click', run);
  button.remove();
});
```

自动实例没有手动执行的两分钟上限。初始化失败后清理并记录到网页控制台，不循环重试；刷新或更新版本可重试。已发起的内置操作不保证在停用瞬间中止，过期结果不再交给该实例；未响应 signal 的用户代码仍可能继续运行。同步死循环仍不能强制终止。下文结果预览和运行时限描述适用于手动运行。

自动脚本使用浏览器会话独立的 USER_SCRIPT world。后台重启复用同一 world，浏览器重启重新配置后再初始化，避免持久化注册先于消息通道恢复导致按钮无法调用内置工具。Chrome API 依据：[userScripts 官方文档](https://developer.chrome.com/docs/extensions/reference/api/userScripts)。

## JavaScript 接口

编辑器接受异步函数体，可直接使用 `await` 和 `return`，不需要包裹函数。

```js
const links = [...document.querySelectorAll('a[href]')];
return {
  kind: 'table',
  columns: ['标题', '地址'],
  rows: links.slice(0, ctx.params.limit ?? 100).map(a => [a.textContent.trim(), a.href]),
  filename: 'links.csv'
};
```

默认参数示例：`{"limit":100}`。参数必须是 JSON 对象，随版本保存。

| 接口 | 行为 |
| --- | --- |
| `ctx.params` | 本次运行的参数对象 |
| `ctx.signal` | 取消/超时的 AbortSignal，可传给 fetch |
| `ctx.onCleanup(fn)` | 完成、失败或取消时逆序调用清理函数 |
| `await ctx.tools.screenshot({fullPage:true})` | 调用内置整页截图；false 为可视区域 |
| `await ctx.tools.extractText()` | 调用内置页面文本提取 |
| `await ctx.tools.download(result)` | 标记结果，成功返回到界面后发起下载 |

```js
const result = await ctx.tools.extractText();
return await ctx.tools.download({
  kind: 'file', data: result.data, filename: 'article.md', mime: 'text/markdown'
});
```

每次运行只展示一个结果。多次调用 download 时仅保留最后一个；关闭界面后不保证下载触发。需要下载多个内容时，应合并为一个结果。本版 file 支持字符串内容，不支持 Blob/二进制附件。

## 返回值

- 字符串：文本预览。
- `{kind:'text', data:'...', filename:'result.txt'}`：文本。
- `{kind:'table', columns:['列名'], rows:[['值']], filename:'result.csv'}`：表格，预览前 200 行，下载全部 CSV；单元格转为字符串，CSV 中公式前缀做文本化处理。
- `{kind:'image', data:'data:image/png;base64,...', width:100, height:100, filename:'result.png'}`：PNG/JPEG/WebP base64 图片。
- `{kind:'file', data:'...', mime:'application/json', filename:'result.json'}`：文本文件。
- 无返回值：显示已完成提示。

## 执行与边界

后台负责 AI、持久化和内置工具。代码在目标文档独立的 USER_SCRIPT world `pagecraft-tools` 执行，可访问网页 DOM，不获得模型 Key。内置工具桥接校验任务 ID、标签页、文档及主框架；结束后拒绝过期调用。网页跳转会使原文档任务失效。

只检查结构和语法，不新增代码 API、标签、属性白名单。浏览器自身的权限和跨域限制仍然有效；此模式不是安全沙箱。不要运行不可信代码。

AI 生成最长 4 分钟，执行最长 2 分钟。同一时间运行一个通用工具任务。取消会停止接收结果、通知 signal 并清理注册资源，但无法强制终止同步死循环，也不能撤销已经提交的表单或网络请求。异步任务应主动检查 signal；未响应取消的代码可能继续产生副作用。临时 CSS 自动移除，任意 DOM 更改须自行注册清理。

截图的权限、页面激活要求和尺寸限制沿用 [内置工具](TOOLS.md)。工具执行结果不长期保存，工具源码及版本保存在本机。

## 验证

单元测试覆盖异步语法、四家服务商请求模式、参数、版本冲突/上限和结果格式。Chromium 测试覆盖创建、试运行不保存、保存、回退、跨页面运行、截图桥接、下载、取消清理和重启持久化；AI 使用模拟响应，尚未用真实 Key 验证生成质量。原生 Chrome 权限弹窗仍需人工验收。
