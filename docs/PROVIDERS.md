# AI 服务商

DeepSeek 代码生成使用 `thinking: { type: "disabled" }`，输出预算为 `max_tokens: 32768`（原为 12000）；其余服务商保持原预算。此设置优先减少等待并为完整代码留出空间，不代表无限输出或保证不会截断。更长的实际输出可能增加费用，4 分钟总超时仍适用。若仍返回 length，可能是输出或上下文上限；保留旧版本，不自动重试计费，也不执行半截代码。模型 ID 保持用户配置不变；需要使用支持这些参数的 DeepSeek 官方模型。

支持 OpenAI、DeepSeek、Google Gemini 和 Claude (Anthropic)。选择服务商、填写该账户可用的模型 ID 和 Key、确认发送授权，再保存。连接测试测试已保存的配置，会产生少量费用，但不发送真实网页摘要。

| 服务商 | 原生接口 | 输出格式 |
| --- | --- | --- |
| OpenAI | POST /v1/responses | text.format JSON Schema |
| DeepSeek | POST /chat/completions | response_format json_object |
| Google Gemini | POST /v1beta/models/{model}:streamGenerateContent?alt=sse | responseMimeType + responseJsonSchema |
| Claude | POST /v1/messages | output_config.format JSON Schema |

模型必须支持对应接口和输出格式，并不是所有模型都支持。Google 使用 Gemini API Key，不是 Vertex AI 凭据；Claude 使用 Anthropic 官方 API，不是 Bedrock 或 Vertex。所有返回统一经过字段校验和脚本静态检查。不接受截断输出，不会静默降级或转发到其他服务商。

旧 OpenAI 配置自动迁移。切换不会复用其他服务商 Key；清除 Key 只影响选中服务商，清除全部数据会删除全部配置。Key 不回传到 UI。

OpenAI、DeepSeek、Claude 请求启用 stream，Gemini 使用 SSE 接口。仅累计生成文本，不保存推理内容；任务只记录字符数和最近响应时间。只有收到服务商的完成标记并通过 JSON/语法校验，才能保存应用。连接提前结束则保留旧版本；不会拼接或执行不完整代码，不自动重试产生额外费用。

总等待上限从 90 秒调整为 4 分钟，手动取消仍立即生效。流式接收可减少等待完整响应造成的中断风险，但不能保证网络、供应商和浏览器生命周期永不中断。若供应商连响应头都迟迟不返回，Chrome 仍可能终止后台请求。

官方参考：
- [OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs)
- [DeepSeek](https://api-docs.deepseek.com/guides/json_mode/)
- [Gemini](https://ai.google.dev/api/generate-content)
- [Claude](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
