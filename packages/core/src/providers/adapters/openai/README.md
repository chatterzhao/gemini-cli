# OpenAI Compatible Adapter

这个适配器支持兼容 OpenAI API 格式的主流服务：

- **OpenAI 官方 API** - GPT-4o, GPT-4o Mini, GPT-4 Turbo, GPT-3.5 Turbo
- **DeepSeek** - DeepSeek Chat, DeepSeek Coder, DeepSeek Reasoner
- **Qwen (阿里云)** - Qwen Max, Qwen Plus, Qwen Turbo, Qwen Long

## 文件说明

- `config.json` - 适配器配置，定义API格式映射和默认模型
- `adapter.ts` - 适配器实现，负责格式转换和API调用

## 支持的功能

- ✅ 文本生成
- ✅ 流式响应
- ✅ 函数调用
- ✅ 图像输入（部分模型）
- ✅ 嵌入生成
- ✅ 精确Token计数
- ✅ 增强错误处理和超时检测

## 配置示例

### OpenAI 官方
```json
{
  "id": "openai-official",
  "name": "OpenAI Official",
  "adapterType": "openai",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "${OPENAI_API_KEY}",
  "models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"]
}
```

### DeepSeek
```json
{
  "id": "deepseek",
  "name": "DeepSeek",
  "adapterType": "openai",
  "baseUrl": "https://api.deepseek.com/v1",
  "apiKey": "${DEEPSEEK_API_KEY}",
  "models": ["deepseek-chat", "deepseek-coder", "deepseek-reasoner"]
}
```

### Qwen (阿里云)
```json
{
  "id": "qwen",
  "name": "Qwen (Alibaba Cloud)",
  "adapterType": "openai",
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "apiKey": "${QWEN_API_KEY}",
  "models": ["qwen-max", "qwen-plus", "qwen-turbo", "qwen-long"]
}
```

## 支持的模型

### OpenAI 官方模型
- **gpt-4o** - 最新多模态模型，支持文本、图像、音频
- **gpt-4o-mini** - 轻量版多模态模型，性价比高
- **gpt-4-turbo** - 高性能模型，支持文本和图像
- **gpt-3.5-turbo** - 经典模型，适合一般对话

### DeepSeek 模型
- **deepseek-chat** - 通用对话模型，32K上下文
- **deepseek-coder** - 专业代码模型，16K上下文
- **deepseek-reasoner** - 推理增强模型，32K上下文

### Qwen 模型
- **qwen-max** - 最强模型，支持多模态，32K上下文
- **qwen-plus** - 平衡性能，32K上下文
- **qwen-turbo** - 快速响应，8K上下文
- **qwen-long** - 超长上下文，1M tokens

## 错误处理

该适配器实现了增强的错误处理机制，包括：

- **超时检测** - 检测各种类型的超时错误（ETIMEDOUT, ESOCKETTIMEDOUT等）
- **用户友好的错误消息** - 提供清晰的错误信息和故障排除建议
- **流式响应错误处理** - 专门处理流式响应中的错误情况

当发生超时错误时，适配器会提供具体的故障排除建议：
- 减少输入长度或复杂性
- 增加配置中的超时时间
- 检查网络连接
- 考虑使用流式模式或非流式模式

## 添加新模型

要添加新的 OpenAI 兼容模型，只需在用户配置中添加模型覆盖：

```json
{
  "modelOverrides": {
    "new-model-v2": {
      "displayName": "New Model V2",
      "contextWindow": 65536,
      "maxOutputTokens": 8192,
      "supportedModalities": ["text", "image"],
      "features": {
        "streaming": true,
        "functionCalling": true,
        "vision": true
      }
    }
  }
}
```