# 自定义提供者适配器系统

## 设计理念

这个系统的核心设计理念是：**适配器专注格式转换，配置由JSON管理**

### 关键特性

1. **一个适配器一个JSON** - 每个适配器有独立的配置文件
2. **字段级覆盖** - 用户可以只覆盖需要修改的字段
3. **容易复制扩展** - 新适配器只需复制现有适配器并修改
4. **精确Token计数** - 优先使用API返回的实际token数

## 架构组成

```
providers/
├── adapters/                    # 适配器目录
│   ├── openai/                 # OpenAI适配器
│   │   ├── config.json        # OpenAI适配器配置
│   │   └── adapter.ts         # OpenAI适配器实现
│   └── anthropic/             # Anthropic适配器
│       ├── config.json        # Anthropic适配器配置
│       └── adapter.ts         # Anthropic适配器实现
├── base-adapter.ts            # 基础适配器类
├── base-adapter.test.ts       # 配置覆盖逻辑测试
├── index.ts                   # 导出和适配器注册
└── README.md                  # 文档
```

## 适配器JSON配置结构

每个适配器的JSON配置包含：

### 基本信息
```json
{
  "adapterType": "openai",
  "adapterName": "OpenAI Compatible",
  "description": "Compatible with OpenAI API format",
  "version": "1.0.0",
  "author": "Gemini CLI Team"
}
```

### API格式定义
```json
{
  "apiFormat": {
    "requestFormat": "openai",
    "responseFormat": "openai", 
    "streamingFormat": "sse"
  },
  "endpoints": {
    "chat": "/chat/completions",
    "embedding": "/embeddings"
  }
}
```

### 参数映射
```json
{
  "parameterMapping": {
    "temperature": "temperature",
    "topP": "top_p",
    "maxOutputTokens": "max_tokens"
  }
}
```

### 响应映射
```json
{
  "responseMapping": {
    "content": "choices[0].message.content",
    "finishReason": "choices[0].finish_reason",
    "usage": {
      "promptTokens": "usage.prompt_tokens",
      "completionTokens": "usage.completion_tokens",
      "totalTokens": "usage.total_tokens"
    }
  }
}
```

### Token计数配置
```json
{
  "tokenCounting": {
    "method": "response_usage",
    "fallbackEstimation": {
      "baseRatio": 0.75,
      "chineseWeight": 0.5,
      "codeWeight": 0.2,
      "specialCharWeight": 0.3
    }
  }
}
```

### 默认模型配置
```json
{
  "defaultModels": {
    "gpt-4": {
      "displayName": "GPT-4",
      "contextWindow": 8192,
      "maxOutputTokens": 4096,
      "supportedModalities": ["text"],
      "features": {
        "streaming": true,
        "functionCalling": true,
        "vision": false
      }
    }
  }
}
```

## 配置字段说明

### 基础字段

- `id` (string, 必需): 提供商唯一标识符
- `name` (string, 必需): 提供商显示名称
- `adapterType` (string, 必需): 适配器类型 (如 "openai", "anthropic")
- `baseUrl` (string, 必需): API基础URL
- `apiKey` (string, 必需): API密钥，支持环境变量引用如 `${API_KEY}`
- `models` (string[], 必需): 支持的模型列表

### 高级配置字段

- `modelOverrides` (object): 模型配置覆盖
  - 以模型ID为键，模型配置对象为值
  - 可覆盖模型的显示名称、上下文窗口大小、最大输出token数等
  - 优先级高于适配器默认配置

- `providerOverrides` (object): 提供商配置覆盖
  - 覆盖适配器的全局配置，如超时设置、重试次数等
  - 优先级高于适配器默认配置

- `headers` (object): 自定义HTTP头
  - 添加到每个API请求的额外HTTP头
  - 可用于认证、跟踪或其他特定需求

- `createdAt` (string): 配置创建时间 (ISO 8601格式)
- `updatedAt` (string): 配置更新时间 (ISO 8601格式)

### 模型配置覆盖字段

在 `modelOverrides` 中，每个模型可以覆盖以下配置：

- `displayName` (string): 模型显示名称
- `contextWindow` (number): 上下文窗口大小(token数)
- `maxOutputTokens` (number): 最大输出token数
- `supportedModalities` (string[]): 支持的模态类型 (如 ["text", "image"])
- `features` (object): 功能特性配置
  - `streaming` (boolean): 是否支持流式输出
  - `functionCalling` (boolean): 是否支持函数调用
  - `vision` (boolean): 是否支持视觉识别
- `enabled` (boolean): 是否启用该模型

### 示例配置

```json
{
  "id": "deepseek",
  "name": "DeepSeek",
  "adapterType": "openai",
  "baseUrl": "https://api.deepseek.com/v1",
  "apiKey": "${DEEPSEEK_API_KEY}",
  "models": ["deepseek-chat", "deepseek-coder"],
  "modelOverrides": {
    "deepseek-chat": {
      "displayName": "DeepSeek Chat Pro",
      "contextWindow": 32768,
      "maxOutputTokens": 4096,
      "features": {
        "streaming": true,
        "functionCalling": true,
        "vision": false
      }
    }
  },
  "providerOverrides": {
    "timeout": 45000,
    "maxRetries": 3
  },
  "headers": {
    "X-DeepSeek-Client": "gemini-cli"
  },
  "createdAt": "2025-01-01T00:00:00Z"
}
```


## 如何添加新模型

### 方法1：使用现有适配器 + 用户配置

如果新模型兼容现有API格式（如OpenAI格式），只需在用户配置中添加：

```json
{
  "id": "new-provider",
  "name": "New Provider",
  "adapterType": "openai",
  "baseUrl": "https://api.newprovider.com/v1",
  "apiKey": "${NEW_PROVIDER_API_KEY}",
  "models": ["new-model-v1", "new-model-v2"],
  
  "modelOverrides": {
    "new-model-v1": {
      "contextWindow": 16384,
      "maxOutputTokens": 4096,
      "features": {
        "streaming": true,
        "functionCalling": false,
        "vision": true
      }
    }
  }
}
```

### 方法2：修改适配器JSON配置

如果需要为所有用户添加新模型，修改对应的适配器JSON：

```json
{
  "defaultModels": {
    "existing-model": { ... },
    "new-model": {
      "displayName": "New Model",
      "contextWindow": 32768,
      "maxOutputTokens": 4096,
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

### 方法3：创建新适配器

如果API格式完全不同，复制现有适配器：

1. 复制 `adapters/openai/` 目录为 `adapters/newapi/`
2. 修改 `adapters/newapi/config.json` 中的映射规则
3. 修改 `adapters/newapi/adapter.ts` 中的格式转换逻辑
4. 在 `index.ts` 中注册新适配器：
   ```typescript
   export const AVAILABLE_ADAPTERS = {
     openai: () => import('./adapters/openai/adapter.js').then(m => m.OpenAIAdapter),
     anthropic: () => import('./adapters/anthropic/adapter.js').then(m => m.AnthropicAdapter),
     newapi: () => import('./adapters/newapi/adapter.js').then(m => m.NewAPIAdapter),
   } as const;
   ```

## Token计数策略

### 精确计数（推荐）
```
{
  "tokenCounting": {
    "method": "response_usage"
  }
}
```
- 发送实际请求获取准确token数
- 适用于支持usage字段的API

### 估算计数
```json
{
  "tokenCounting": {
    "method": "estimation",
    "fallbackEstimation": {
      "baseRatio": 0.75,
      "chineseWeight": 0.5,
      "codeWeight": 0.2,
      "specialCharWeight": 0.3
    }
  }
}
```
- 使用TokenEstimator进行本地估算
- 适用于不支持usage字段的API

## 最佳实践

### 1. 适配器设计原则
- **单一职责**：适配器只负责格式转换
- **配置驱动**：所有可变配置都放在JSON中
- **容易复制**：新适配器应该能通过复制现有适配器快速创建

### 2. JSON配置原则
- **完整性**：包含所有必要的映射信息
- **灵活性**：支持用户字段级覆盖
- **可扩展性**：易于添加新模型和功能

### 3. 用户配置原则
- **最小配置**：只配置必要的字段
- **环境变量**：敏感信息使用环境变量
- **字段覆盖**：只覆盖需要修改的字段

## 示例：添加DeepSeek V3

假设DeepSeek发布了V3模型，有以下特性：
- 上下文窗口：64K
- 支持函数调用
- 不支持视觉

### 用户配置方式
```json
{
  "id": "deepseek-v3",
  "name": "DeepSeek V3",
  "adapterType": "openai",
  "baseUrl": "https://api.deepseek.com/v1",
  "apiKey": "${DEEPSEEK_API_KEY}",
  "models": ["deepseek-chat-v3"],
  
  "modelOverrides": {
    "deepseek-chat-v3": {
      "contextWindow": 65536,
      "maxOutputTokens": 8192,
      "features": {
        "streaming": true,
        "functionCalling": true,
        "vision": false
      }
    }
  }
}
```

### 适配器JSON更新方式
在 `adapters/openai.json` 中添加：
```json
{
  "defaultModels": {
    "deepseek-chat-v3": {
      "displayName": "DeepSeek Chat V3",
      "contextWindow": 65536,
      "maxOutputTokens": 8192,
      "supportedModalities": ["text"],
      "features": {
        "streaming": true,
        "functionCalling": true,
        "vision": false
      }
    }
  }
}
```

这样，当新模型发布时，用户可以通过简单的配置修改立即使用，而不需要等待代码更新。