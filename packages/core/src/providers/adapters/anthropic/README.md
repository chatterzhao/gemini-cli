# Anthropic Claude Adapter

这个适配器支持 Anthropic Claude API。

## 文件说明

- `config.json` - 适配器配置，定义API格式映射和默认模型
- `adapter.ts` - 适配器实现，负责格式转换和API调用

## 支持的功能

- ✅ 文本生成
- ✅ 流式响应
- ✅ 函数调用
- ✅ 图像输入
- ❌ 嵌入生成（Anthropic不提供）
- ✅ 精确Token计数

## 配置示例

```json
{
  "id": "my-claude-provider",
  "name": "My Claude Provider",
  "adapterType": "anthropic",
  "baseUrl": "https://api.anthropic.com/v1",
  "apiKey": "${ANTHROPIC_API_KEY}",
  "models": ["claude-3-opus", "claude-3-sonnet", "claude-3-haiku"]
}
```

## 状态

⚠️ **待实现** - 这个适配器目前只是占位符，需要完整实现。

## TODO

- [ ] 实现 `generateContent` 方法
- [ ] 实现 `generateContentStream` 方法  
- [ ] 实现 `countTokens` 方法
- [ ] 处理 Anthropic 特有的请求格式
- [ ] 处理 Anthropic 特有的响应格式
- [ ] 支持系统消息格式转换
- [ ] 支持图像输入格式转换