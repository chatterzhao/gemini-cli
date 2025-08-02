# Gemini CLI 可扩展供应商/模型架构设计

## 项目目标与需求

### 功能需求
1. **新增Custom Provider认证模式**：在现有的Google OAuth、Gemini API Key、Vertex AI基础上，新增支持自定义供应商的API Key认证
2. **供应商选择流程**：选择Custom Provider后，提供供应商配置界面（支持OpenAI兼容、Anthropic等适配器）
3. **分步配置流程**：适配器选择 → 配置命名 → BaseURL → API Key → 模型列表的直观配置流程
4. **斜杠命令支持**：`/model` 命令支持跨供应商模型选择
5. **易扩展架构**：新增供应商应该是简单的配置操作，支持不同SDK适配器

### 技术需求
1. **向后兼容**：不影响现有Google认证流程
2. **最小侵入**：精确定位关键修改点，保持代码结构稳定
3. **统一API接口**：屏蔽不同SDK的格式差异
4. **配置持久化**：支持用户级配置存储
5. **无Google登录依赖**：选择Custom Provider后完全绕过Google认证

## 关键发现：现有认证流程分析

### 认证对话框触发条件
基于代码深度分析，认证对话框在以下情况下显示：
- **主要触发**：`settings.merged.selectedAuthType === undefined` (`useAuthCommand.ts:22-24`)
- **认证失败重试**：认证过程出错后重新显示对话框
- **手动调用**：用户执行 `/auth` 命令
- **ESC阻止退出**：未设置认证方式时按ESC会阻止退出并要求选择

### 关键修改点定位
- **AuthDialog.tsx:101-109** - `handleAuthSelect` 函数是核心处理逻辑
- **auth.ts:10-42** - `validateAuthMethod` 函数控制认证验证
- **useAuthCommand.ts:54-79** - 处理认证选择后的保存和状态管理

## 已实现的架构设计

### 1. 扩展现有认证系统

#### 1.1 AuthType 枚举扩展

```typescript
// packages/core/src/core/contentGenerator.ts
export enum AuthType {
  LOGIN_WITH_GOOGLE = 'oauth-personal',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  CLOUD_SHELL = 'cloud-shell',
  CUSTOM_PROVIDER = 'custom-provider', // 已添加
}
```

#### 1.2 认证验证逻辑修改

``typescript
// packages/cli/src/config/auth.ts - 精确修改 validateAuthMethod 函数
export const validateAuthMethod = (authMethod: string): string | null => {
  loadEnvironment();
  
  // ← 已实现：Custom Provider 绕过 Google 认证验证
  if (authMethod === AuthType.CUSTOM_PROVIDER) {
    // 检查是否有有效的自定义供应商配置
    const settings = loadSettings(process.cwd());
    const currentProvider = settings.merged.currentProvider;
    const customProviders = settings.merged.customProviders;
    
    if (!currentProvider || !customProviders?.[currentProvider]) {
      return 'No custom provider configured. Please configure a custom provider first.';
    }
    
    return null; // 验证通过，不需要 Google 登录
  }

  // 原有的其他认证方式验证逻辑保持不变...
  if (authMethod === AuthType.LOGIN_WITH_GOOGLE || authMethod === AuthType.CLOUD_SHELL) {
    return null;
  }
  // ... 其他现有逻辑
};
```

### 2. AuthDialog 组件已实现修改

#### 2.1 核心处理逻辑修改

``typescript
// packages/cli/src/ui/components/AuthDialog.tsx
export function AuthDialog({ onSelect, settings, initialErrorMessage }: AuthDialogProps) {
  const [showCustomProviderFlow, setShowCustomProviderFlow] = useState(false);
  
  // 在现有选项列表中添加 Custom Provider
  const items = [
    { label: 'Login with Google', value: AuthType.LOGIN_WITH_GOOGLE },
    { label: 'Use Gemini API Key', value: AuthType.USE_GEMINI },
    { label: 'Vertex AI', value: AuthType.USE_VERTEX_AI },
    ...(process.env.CLOUD_SHELL === 'true' ? [
      { label: 'Use Cloud Shell user credentials', value: AuthType.CLOUD_SHELL }
    ] : []),
    { label: 'Custom Provider', value: AuthType.CUSTOM_PROVIDER }, // ← 已添加
  ];

  // ← 已实现修改：handleAuthSelect 函数 (第101-109行)
  const handleAuthSelect = (authMethod: AuthType) => {
    // 特殊处理 Custom Provider - 不走验证，直接显示配置流程
    if (authMethod === AuthType.CUSTOM_PROVIDER) {
      setShowCustomProviderFlow(true);
      return;
    }
    
    // 原有逻辑：其他认证方式的验证
    const error = validateAuthMethod(authMethod);
    if (error) {
      setErrorMessage(error);
    } else {
      setErrorMessage(null);
      onSelect(authMethod, SettingScope.User);
    }
  };

  // 条件渲染：显示 Custom Provider 配置流程
  if (showCustomProviderFlow) {
    return (
      <CustomProviderFlow
        settings={settings}
        onComplete={(providerConfig) => {
          // 配置完成后直接设置认证类型并关闭对话框
          settings.setValue(SettingScope.User, 'selectedAuthType', AuthType.CUSTOM_PROVIDER);
          settings.setValue(SettingScope.User, 'currentProvider', providerConfig.id);
          
          // 设置第一个模型为当前模型，确保用户配置完成后可以直接使用
          // 优先级顺序：models中的第一个模型 > modelOverrides中的第一个模型 > 默认值
          const firstModel = providerConfig.models[0] || 
                            (providerConfig.modelOverrides ? Object.keys(providerConfig.modelOverrides)[0] : null) || 
                            'default';
          settings.setValue(SettingScope.User, 'currentModel', firstModel);
          
          settings.setValue(SettingScope.User, 'customProviders', {
            ...settings.merged.customProviders,
            [providerConfig.id]: providerConfig
          });
          onSelect(AuthType.CUSTOM_PROVIDER, SettingScope.User);
          setShowCustomProviderFlow(false);
        }}
        onCancel={() => setShowCustomProviderFlow(false)}
      />
    );
  }

  // 原有的 AuthDialog UI 渲染逻辑...
}
```

### 3. Custom Provider 配置流程组件

#### 3.1 CustomProviderFlow - 主流程控制器

``typescript
// packages/cli/src/ui/components/CustomProviderFlow.tsx
export function CustomProviderFlow({ settings, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<'list' | 'adapter' | 'name' | 'baseurl' | 'apikey' | 'models'>('list');
  const [config, setConfig] = useState<Partial<CustomProviderConfig>>({});
  
  // 步骤1: 显示现有provider列表 + Add New
  if (step === 'list') {
    const existingProviders = Object.values(settings.merged.customProviders || {});
    const options = [
      ...existingProviders.map(p => ({
        type: 'existing' as const,
        label: `${p.name} (${p.adapterType})`,
        provider: p
      })),
      { type: 'add_new' as const, label: 'Add New Provider...' }
    ];

    return (
      <ProviderSelectionDialog
        title="Select Custom Provider"
        options={options}
        onSelect={(option) => {
          if (option.type === 'existing') {
            // 选择现有provider，直接完成
            onComplete(option.provider);
          } else {
            // 开始新建provider流程
            setStep('adapter');
          }
        }}
        onCancel={onCancel}
      />
    );
  }

  // 步骤2-6: 分步配置新provider
  return (
    <ProviderConfigSteps
      step={step}
      config={config}
      onStepComplete={(stepData) => {
        const updatedConfig = { ...config, ...stepData };
        setConfig(updatedConfig);
        
        // 步骤流程控制
        const stepFlow = {
          'adapter': 'name',
          'name': 'baseurl',
          'baseurl': 'apikey', 
          'apikey': 'models',
          'models': 'complete'
        };
        
        if (stepFlow[step] === 'complete') {
          // 生成唯一 ID 并完成配置
          const finalConfig: CustomProviderConfig = {
            ...updatedConfig,
            id: generateProviderId(updatedConfig.name!),
          } as CustomProviderConfig;

          // 默认选择第一个模型作为当前模型
          const firstModel = finalConfig.models[0] || 'default';
          
          onComplete({
            ...finalConfig,
            currentModel: firstModel,
          });
        } else {
          setStep(stepFlow[step] as any);
        }
      }}
      onBack={() => {
        const backFlow = {
          'models': 'apikey',
          'apikey': 'baseurl',
          'baseurl': 'name',
          'name': 'adapter',
          'adapter': 'list'
        };
        setStep(backFlow[step] as any);
      }}
      onCancel={onCancel}
    />
  );
}
```

#### 3.2 ConfigFieldInput - 通用配置输入组件（参考qwen-code）

``typescript
// packages/cli/src/ui/components/ConfigFieldInput.tsx
export function ConfigFieldInput({
  label,
  value,
  placeholder,
  sensitive = false,
  focused = false,
  error = null,
  onSubmit,
  onCancel
}: ConfigFieldInputProps): React.JSX.Element {
  const [input, setInput] = useState(value || '');

  useInput((inputChar, key) => {
    // 参考qwen-code的输入处理逻辑
    let cleanInput = (inputChar || '')
      .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '') // 过滤ESC控制序列
      .replace(/\[200~/g, '')  // 过滤粘贴开始标记
      .replace(/\[201~/g, '')  // 过滤粘贴结束标记
      .replace(/^\[|~$/g, ''); // 过滤残留标记

    // 过滤不可见字符
    cleanInput = cleanInput
      .split('')
      .filter((ch) => ch.charCodeAt(0) >= 32)
      .join('');

    if (cleanInput.length > 0) {
      setInput((prev) => prev + cleanInput);
      return;
    }

    // Enter键提交
    if (inputChar.includes('\n') || inputChar.includes('\r')) {
      onSubmit(input.trim());
      return;
    }

    // ESC键取消
    if (key.escape) {
      onCancel();
      return;
    }

    // Backspace删除
    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }
  });

  return (
    <Box
      borderStyle="round"
      borderColor={focused ? Colors.AccentBlue : Colors.Gray}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold color={focused ? Colors.AccentBlue : Colors.Gray}>
        {label}
      </Text>
      
      <Box marginTop={1} flexDirection="row">
        <Box width={12}>
          <Text color={focused ? Colors.AccentBlue : Colors.Gray}>
            {label}:
          </Text>
        </Box>
        <Box flexGrow={1}>
          <Text>
            {focused ? '> ' : '  '}
            {sensitive ? '•'.repeat(input.length) : input}
            {focused && <Text color={Colors.Gray}>_</Text>}
          </Text>
        </Box>
      </Box>

      {placeholder && (
        <Box marginTop={1}>
          <Text color={Colors.Gray}>{placeholder}</Text>
        </Box>
      )}

      {error && (
        <Box marginTop={1}>
          <Text color={Colors.AccentRed}>{error}</Text>
        </Box>
      )}
      
      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          Press Enter to continue, Tab/↑↓ to navigate, Esc to cancel
        </Text>
      </Box>
    </Box>
  );
}
```

#### 3.3 AdapterModelSelector - 适配器模型选择器

``typescript
// packages/cli/src/ui/components/AdapterModelSelector.tsx
export function AdapterModelSelector({
  adapterConfig,
  selectedModels,
  onModelsChange,
  onModelConfigure
}: AdapterModelSelectorProps): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showingDetails, setShowingDetails] = useState(false);

  // 获取适配器默认模型列表
  const defaultModels = Object.entries(adapterConfig.defaultModels);
  const options = [
    ...defaultModels.map(([modelId, modelInfo]) => ({
      type: 'default' as const,
      modelId,
      label: `${modelInfo.displayName} (${modelId})`,
      description: `Context: ${modelInfo.contextWindow}, Features: ${Object.entries(modelInfo.features).filter(([_, enabled]) => enabled).map(([feature]) => feature).join(', ')}`,
      selected: selectedModels.includes(modelId),
      modelInfo
    })),
    { type: 'custom' as const, label: 'Add Custom Model...', modelId: '', description: 'Define your own model configuration' },
    { type: 'done' as const, label: 'Continue with Selected Models', modelId: '', description: `${selectedModels.length} models selected` }
  ];

  useInput((input, key) => {
    if (key.escape) {
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(prev => prev > 0 ? prev - 1 : options.length - 1);
    } else if (key.downArrow) {
      setSelectedIndex(prev => prev < options.length - 1 ? prev + 1 : 0);
    } else if (key.return) {
      const selected = options[selectedIndex];
      
      if (selected.type === 'default') {
        // 切换模型选择状态
        const isSelected = selectedModels.includes(selected.modelId);
        if (isSelected) {
          onModelsChange(selectedModels.filter(id => id !== selected.modelId));
        } else {
          onModelsChange([...selectedModels, selected.modelId]);
        }
      } else if (selected.type === 'custom') {
        // 打开自定义模型配置
        onModelConfigure();
      } else if (selected.type === 'done') {
        // 完成选择
        if (selectedModels.length > 0) {
          onModelsChange(selectedModels);
        }
      }
    } else if (input === 'd' || input === 'D') {
      // 显示/隐藏模型详细信息
      setShowingDetails(!showingDetails);
    } else if (input === 'c' || input === 'C') {
      // 配置选中的模型
      const selected = options[selectedIndex];
      if (selected.type === 'default') {
        onModelConfigure(selected.modelId);
      }
    }
  });

  return (
    <Box borderStyle="round" borderColor={Colors.Gray} flexDirection="column" padding={1}>
      <Text bold>Select Models from {adapterConfig.adapterName}</Text>
      <Text color={Colors.Gray}>Choose models to enable for this provider</Text>
      
      <Box flexDirection="column" marginTop={1}>
        {options.map((option, index) => (
          <Box key={option.modelId || option.type} marginTop={index > 0 ? 1 : 0}>
            <Text>
              {index === selectedIndex ? '● ' : '○ '}
              {option.type === 'default' && option.selected ? '✓ ' : ''}
              {option.label}
            </Text>
            {option.description && (
              <Box marginLeft={4}>
                <Text color={Colors.Gray}>{option.description}</Text>
              </Box>
            )}
            
            {/* 显示详细信息 */}
            {showingDetails && option.type === 'default' && index === selectedIndex && (
              <Box marginLeft={4} marginTop={1} borderStyle="single" borderColor={Colors.Gray} padding={1}>
                <Text bold>Model Details:</Text>
                <Text>Context Window: {option.modelInfo.contextWindow}</Text>
                <Text>Max Output: {option.modelInfo.maxOutputTokens}</Text>
                <Text>Modalities: {option.modelInfo.supportedModalities.join(', ')}</Text>
                <Text>Features:</Text>
                {Object.entries(option.modelInfo.features).map(([feature, enabled]) => (
                  <Text key={feature} marginLeft={2}>
                    {enabled ? '✓' : '✗'} {feature}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        ))}
      </Box>
      
      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          ↑↓ Navigate • Enter Select/Toggle • D Details • C Configure • Esc Cancel
        </Text>
      </Box>
    </Box>
  );
}
```

#### 3.4 ModelConfigDialog - 模型详细配置对话框

``typescript
// packages/cli/src/ui/components/ModelConfigDialog.tsx
export function ModelConfigDialog({
  modelId,
  adapterDefaults,
  currentConfig,
  onSave,
  onCancel
}: ModelConfigDialogProps): React.JSX.Element {
  const [config, setConfig] = useState<ModelConfig>(currentConfig || { inherit: true });
  const [currentField, setCurrentField] = useState<keyof ModelConfig>('inherit');
  const [input, setInput] = useState('');

  const defaultModel = adapterDefaults.defaultModels[modelId];
  
  const fields: Array<{
    key: keyof ModelConfig;
    label: string;
    type: 'boolean' | 'number' | 'string' | 'array';
    placeholder?: string;
    description?: string;
  }> = [
    { key: 'inherit', label: 'Inherit from Adapter', type: 'boolean', description: 'Use adapter default configuration' },
    { key: 'displayName', label: 'Display Name', type: 'string', placeholder: defaultModel?.displayName },
    { key: 'contextWindow', label: 'Context Window', type: 'number', placeholder: defaultModel?.contextWindow?.toString() },
    { key: 'maxOutputTokens', label: 'Max Output Tokens', type: 'number', placeholder: defaultModel?.maxOutputTokens?.toString() },
    { key: 'enabled', label: 'Enabled', type: 'boolean', description: 'Enable this model for use' },
  ];

  // 参考qwen-code的键盘导航逻辑
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      onSave(config);
      return;
    }

    if (key.tab || key.downArrow) {
      const currentIndex = fields.findIndex(f => f.key === currentField);
      const nextIndex = (currentIndex + 1) % fields.length;
      setCurrentField(fields[nextIndex].key);
      return;
    }

    if (key.upArrow) {
      const currentIndex = fields.findIndex(f => f.key === currentField);
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : fields.length - 1;
      setCurrentField(fields[prevIndex].key);
      return;
    }

    // 字段特定的输入处理
    const currentFieldConfig = fields.find(f => f.key === currentField);
    if (currentFieldConfig?.type === 'boolean') {
      if (input === ' ' || key.return) {
        setConfig(prev => ({
          ...prev,
          [currentField]: !prev[currentField]
        }));
      }
    } else if (currentFieldConfig?.type === 'string' || currentFieldConfig?.type === 'number') {
      // 处理文本输入（参考qwen-code的输入处理）
      // ... 输入处理逻辑
    }
  });

  return (
    <Box borderStyle="round" borderColor={Colors.AccentBlue} flexDirection="column" padding={1}>
      <Text bold>Configure Model: {modelId}</Text>
      
      {defaultModel && (
        <Box marginTop={1}>
          <Text color={Colors.Gray}>
            Default: {defaultModel.displayName} (Context: {defaultModel.contextWindow}, Max: {defaultModel.maxOutputTokens})
          </Text>
        </Box>
      )}
      
      <Box flexDirection="column" marginTop={1}>
        {fields.map((field) => (
          <Box key={field.key} marginTop={1} flexDirection="row">
            <Box width={20}>
              <Text color={currentField === field.key ? Colors.AccentBlue : Colors.Gray}>
                {field.label}:
              </Text>
            </Box>
            <Box flexGrow={1}>
              <Text>
                {currentField === field.key ? '> ' : '  '}
                {renderFieldValue(config[field.key], field.type, field.placeholder)}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
      
      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          Tab/↑↓ Navigate • Space Toggle • Enter Save • Esc Cancel
        </Text>
      </Box>
    </Box>
  );
}
```

### 4. 分层配置架构设计

#### 4.1 配置层次结构

``typescript
// packages/cli/src/config/settings.ts - 重新设计配置结构

export interface Settings {
  // ... 现有字段保持不变
  selectedAuthType?: AuthType;
  
  // 新增：Custom Provider 相关配置
  currentProvider?: string;    // 当前使用的 provider ID  
  currentModel?: string;       // 当前使用的 model
  customProviders?: Record<string, CustomProviderConfig>;
}

// 用户自定义Provider配置
export interface CustomProviderConfig {
  id: string;                  // 唯一标识
  name: string;               // 显示名称  
  adapterType: 'openai' | 'anthropic'; // 适配器类型
  
  // Provider级别配置
  baseUrl: string;
  apiKey: string;
  
  // Model列表
  models: string[];
  
  // 模型覆盖配置 - 允许对特定模型进行详细配置覆盖
  modelOverrides?: Record<string, {
    contextWindow?: number;
    maxOutputTokens?: number;
    supportedModalities?: string[];
    features?: {
      streaming?: boolean;
      functionCalling?: boolean;
      vision?: boolean;
    };
  }>;
  
  // Provider级别覆盖配置 - 允许对特定Provider进行详细配置覆盖
  providerOverrides?: {
    timeout?: number;
    maxRetries?: number;
    customHeaders?: Record<string, string>;
    [key: string]: any;
  };
  
  createdAt?: string;
  updatedAt?: string;
}

// 适配器系统级配置接口（从config.json加载）
export interface AdapterConfig {
  adapterType: string;         // 适配器类型
  adapterName: string;
  description: string;
  version: string;
  
  apiFormat: {
    requestFormat: string;
    responseFormat: string;
    streamingFormat: string;
  };
  
  endpoints: Record<string, string>;
  parameterMapping: Record<string, string>;
  responseMapping: Record<string, any>;
  tokenCounting: Record<string, any>;
  errorHandling: Record<string, any>;
  
  // 系统预定义模型
  defaultModels: Record<string, {
    displayName: string;
    contextWindow: number;
    maxOutputTokens: number;
    supportedModalities: string[];
    features: {
      streaming: boolean;
      functionCalling: boolean;
      vision: boolean;
    };
  }>;
}

// 传递给适配器的用户配置
export interface UserProviderConfig {
  id: string;
  name: string;
  adapterType: string;         // 适配器类型
  baseUrl: string;
  apiKey: string;
  models: string[];
  
  // 用户可以覆盖的模型配置
  modelOverrides?: Record<string, {
    contextWindow?: number;
    maxOutputTokens?: number;
    supportedModalities?: string[];
    features?: {
      streaming?: boolean;
      functionCalling?: boolean;
      vision?: boolean;
    };
  }>;
  
  // 提供商配置覆盖
  providerOverrides?: {
    timeout?: number;
    maxRetries?: number;
    customHeaders?: Record<string, string>;
    [key: string]: any;
  };
  
  createdAt?: string;
  updatedAt?: string;
}
```

#### 4.2 配置继承与覆盖机制

**配置优先级**：用户配置 > 适配器默认配置

``typescript
// 配置解析逻辑
function resolveModelConfig(
  modelId: string, 
  userConfig: ModelConfig, 
  adapterDefaults: AdapterConfig
): ResolvedModelConfig {
  const defaultModel = adapterDefaults.defaultModels[modelId];
  
  if (userConfig.inherit === false) {
    // 完全自定义，不继承任何默认配置
    return userConfig as ResolvedModelConfig;
  }
  
  // 合并配置：用户配置覆盖默认配置
  return {
    displayName: userConfig.displayName || defaultModel?.displayName || modelId,
    contextWindow: userConfig.contextWindow || defaultModel?.contextWindow || 4096,
    maxOutputTokens: userConfig.maxOutputTokens || defaultModel?.maxOutputTokens || 2048,
    supportedModalities: userConfig.supportedModalities || defaultModel?.supportedModalities || ['text'],
    features: {
      streaming: userConfig.features?.streaming ?? defaultModel?.features?.streaming ?? true,
      functionCalling: userConfig.features?.functionCalling ?? defaultModel?.features?.functionCalling ?? false,
      vision: userConfig.features?.vision ?? defaultModel?.features?.vision ?? false,
    },
    enabled: userConfig.enabled ?? true,
    customParameters: userConfig.customParameters || {},
  };
}
```

#### 4.3 配置文件示例

```
[
  {
    "id": "deepseek",
    "name": "DeepSeek",
    "adapterType": "openai",
    "baseUrl": "https://api.deepseek.com/v1",
    "apiKey": "${DEEPSEEK_API_KEY}",
    "models": ["deepseek-chat", "deepseek-coder", "deepseek-reasoner"],
    "modelOverrides": {
      "deepseek-reasoner": {
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
    "createdAt": "2025-01-01T00:00:00Z"
  }
]
```

### 5. ContentGenerator 适配器系统

#### 5.1 OpenAI 兼容适配器

``typescript
// packages/core/src/providers/adapters/openai.ts
export class OpenAIContentGenerator implements ContentGenerator {
  private client: OpenAI;
  
  constructor(config: CustomProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }
  
  async generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse> {
    const openaiRequest = this.convertToOpenAIFormat(request);
    const response = await this.client.chat.completions.create(openaiRequest);
    return this.convertToGeminiFormat(response);
  }
  
  async generateContentStream(request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> {
    const openaiRequest = { ...this.convertToOpenAIFormat(request), stream: true };
    const stream = await this.client.chat.completions.create(openaiRequest);
    
    return this.convertStreamToGeminiFormat(stream);
  }
  
  // 格式转换方法...
  private convertToOpenAIFormat(request: GenerateContentParameters) {
    // 将 Gemini 格式转换为 OpenAI 格式
  }
  
  private convertToGeminiFormat(response: any): GenerateContentResponse {
    // 将 OpenAI 格式转换为 Gemini 格式
  }
}
```

#### 5.2 ContentGenerator 工厂扩展

``typescript
// packages/core/src/core/contentGenerator.ts - 扩展 createContentGenerator
export async function createContentGenerator(
  config: Config,
  gcConfig: ContentGeneratorConfig,
  sessionId?: string,
): Promise<ContentGenerator> {
  const authType = config.getAuthType();
  
  // 新增：Custom Provider 处理
  if (authType === AuthType.CUSTOM_PROVIDER) {
    return createCustomProviderContentGenerator(config, gcConfig, sessionId);
  }
  
  // 原有逻辑保持不变...
  if (authType === AuthType.LOGIN_WITH_GOOGLE || authType === AuthType.CLOUD_SHELL) {
    return createCodeAssistContentGenerator(httpOptions, authType, config, sessionId);
  }
  // ... 其他现有认证方式
}

async function createCustomProviderContentGenerator(
  config: Config,
  gcConfig: ContentGeneratorConfig,
  sessionId?: string
): Promise<ContentGenerator> {
  const settings = config.getSettings();
  const currentProvider = settings.currentProvider;
  const providerConfig = settings.customProviders?.[currentProvider];
  
  if (!providerConfig) {
    // 已实现
  }
  
  // 根据适配器类型创建对应的 ContentGenerator
  switch (providerConfig.adapterType) {
    case 'openai':
      return new OpenAIContentGenerator(providerConfig);
    case 'anthropic':
      return new AnthropicContentGenerator(providerConfig);
    default:
      throw new Error(`Unsupported adapter type: ${providerConfig.adapterType}`);
  }
}
```

### 6. /model 命令支持

``typescript
// packages/cli/src/ui/commands/modelCommand.ts
export const modelCommand: SlashCommand = {
  name: 'model',
  description: 'Switch AI model across providers',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext): Promise<SlashCommandActionReturn> => {
    const availableModels = await getAvailableModels(context.services.settings);
    
    return {
      type: 'dialog',
      dialog: 'model_selection',
      options: availableModels
    };
  }
};

async function getAvailableModels(settings: LoadedSettings) {
  const models = [];
  
  // Google 内置模型
  models.push({
    providerId: 'google',
    providerName: 'Google',
    modelId: 'gemini-1.5-pro',
    modelName: 'Gemini 1.5 Pro',
    isCurrent: isCurrentModel('google', 'gemini-1.5-pro')
  });
  
  // 自定义 Provider 模型
  const customProviders = settings.merged.customProviders || {};
  for (const [providerId, provider] of Object.entries(customProviders)) {
    for (const modelId of provider.models) {
      models.push({
        providerId,
        providerName: provider.name,
        modelId,
        modelName: modelId,
        isCurrent: isCurrentModel(providerId, modelId)
      });
    }
  }
  
  return models;
}
```

## 实现计划与侵入性分析

### 侵入性影响分析

#### 🟢 文件修改 (3个现有文件)
**低侵入性修改 - 精确定位关键函数**：

1. **packages/core/src/core/contentGenerator.ts**
   - 修改内容：AuthType 枚举添加 `CUSTOM_PROVIDER = 'custom-provider'`
   - 修改内容：createContentGenerator 工厂函数添加 Custom Provider 分支
   - 侵入程度：**极低** (仅添加枚举值和条件分支)

2. **packages/cli/src/config/auth.ts**
   - 修改内容：validateAuthMethod 函数添加 Custom Provider 验证逻辑
   - 修改位置：第10-42行的 validateAuthMethod 函数
   - 侵入程度：**低** (添加条件分支，不影响现有逻辑)

3. **packages/cli/src/config/settings.ts**
   - 修改内容：Settings 接口添加 customProviders 相关字段
   - 侵入程度：**低** (接口扩展，可选字段，完全向后兼容)

#### 🟡 接口扩展 (1个现有文件)
**结构扩展 - 向后兼容设计**：

4. **packages/cli/src/config/settings.ts**
   - 修改内容：Settings 接口添加 customProviders 相关字段
   - 侵入程度：**低** (接口扩展，可选字段，完全向后兼容)

#### 🔵 新建文件 (6个全新组件)
**零侵入性 - 独立功能模块**：

5. **packages/cli/src/ui/components/CustomProviderFlow.tsx** (新建)
6. **packages/cli/src/ui/components/ProviderSelectionDialog.tsx** (新建)
7. **packages/cli/src/ui/components/ProviderConfigSteps.tsx** (新建)
8. **packages/core/src/providers/adapters/openai.ts** (新建)
9. **packages/cli/src/ui/commands/modelCommand.ts** (新建)
10. **相关测试文件** (新建)

### Phase 1: 核心认证流程修改 (PR1)
**目标**：最小侵入式地添加 Custom Provider 支持
**文件影响分析**：
- ✅ `packages/core/src/core/contentGenerator.ts` - **修改** (添加枚举)
- ✅ `packages/cli/src/config/auth.ts` - **修改** (函数增强)
- ✅ `packages/cli/src/config/settings.ts` - **扩展** (接口增强)

**侵入性评级**：🟢 **极低** - 仅添加配置选项，不改变现有行为

### Phase 2: AuthDialog 组件修改 (PR2)
**目标**：扩展认证对话框支持 Custom Provider 选项
**文件影响分析**：
- ⚠️ `packages/cli/src/ui/components/AuthDialog.tsx` - **修改** (核心UI逻辑)

**侵入性评级**：🟡 **中等** - 修改核心UI组件，但设计为条件分支

### Phase 3: Custom Provider 配置组件 (PR3)
**目标**：实现完整的分步配置流程
**文件影响分析**：
- 🆕 `packages/cli/src/ui/components/CustomProviderFlow.tsx` - **新建**
- 🆕 `packages/cli/src/ui/components/ProviderSelectionDialog.tsx` - **新建**
- 🆕 `packages/cli/src/ui/components/ProviderConfigSteps.tsx` - **新建**

**侵入性评级**：🔵 **零侵入** - 全新独立组件

### Phase 4: OpenAI 适配器实现 (PR4)
**目标**：实现 OpenAI 兼容的 ContentGenerator
**文件影响分析**：
- 🆕 `packages/core/src/providers/adapters/openai.ts` - **新建**
- ✅ `packages/core/src/core/contentGenerator.ts` - **修改** (工厂函数扩展)

**侵入性评级**：🟢 **低** - 主要是新建组件，少量工厂函数扩展

### Phase 5: 分层配置架构重构 (PR5)
**目标**：实现系统级配置与用户自定义配置的分离和继承机制
**核心问题解决**：
- 解决适配器内置配置与用户配置的分离问题
- 实现模型级别配置的继承和覆盖机制
- 支持Provider级别和适配器级别的配置覆盖

**文件影响分析**：
- ✅ `packages/cli/src/config/settings.ts` - **重构** (分层配置接口设计)
- 🆕 `packages/core/src/providers/adapters/config-loader.ts` - **新建** (配置加载器)
- 🆕 `packages/core/src/providers/adapters/config-resolver.ts` - **新建** (配置解析器)
- ✅ `packages/core/src/providers/adapters/openai/adapter.ts` - **修改** (支持分层配置)
- ✅ `packages/core/src/providers/adapters/anthropic/adapter.ts` - **修改** (支持分层配置)

**侵入性评级**：🟡 **中等** - 配置架构重构，但向后兼容

### Phase 5.1: 配置结构增强和默认模型选择 ✅ **已完成**
基于Phase 4的实现，需要增强配置结构以支持以下功能：
- [x] **添加modelOverrides字段支持**: 允许对特定模型进行详细配置覆盖
- [x] **默认模型选择机制**: 配置完成后自动将第一个模型设置为当前模型
- [ ] **当前Provider/Model显示**: 在聊天界面显示当前使用的Provider和Model信息
- [x] **配置结构文档更新**: 更新文档以反映新的配置结构

##### Phase 5.1 详细需求说明
1. **modelOverrides字段支持**
   - 在CustomProviderConfig接口中添加modelOverrides字段
   - 该字段用于存储特定模型的覆盖配置
   - 配置优先级：用户特定模型配置 > 适配器默认配置

2. **默认模型选择机制**
   - 用户完成Custom Provider配置后，自动将第一个可用模型设置为当前模型
   - 避免用户配置完成后无法立即使用的问题
   - 优先级顺序：models中的第一个模型 > modelOverrides中的第一个模型 > 默认值

3. **当前Provider/Model显示**
   - 在聊天界面的合适位置显示当前使用的Provider和Model
   - 显示格式示例："当前模型: DeepSeek (deepseek-chat)"
   - 为用户提供清晰的上下文信息

4. **向后兼容性**
   - 确保现有配置文件可以正常工作
   - 对于缺少modelOverrides字段的配置文件保持兼容

#### Phase 5.2: 聊天界面显示当前Provider和Model信息 🚧 **待实现**
基于Phase 5.1的实现，需要在聊天界面显示当前使用的Provider和Model信息：
- [ ] **创建状态显示组件**: 在聊天界面合适位置显示当前Provider和Model
- [ ] **实现信息获取逻辑**: 从配置中获取当前Provider和Model信息
- [ ] **设计显示格式**: 确定清晰直观的显示格式
- [ ] **添加到聊天界面**: 将状态显示组件集成到聊天界面中

##### Phase 5.2 详细需求说明
1. **状态显示组件**
   - 创建一个轻量级的组件，用于显示当前Provider和Model信息
   - 组件应该简洁明了，不干扰正常的聊天体验
   - 显示格式示例："当前模型: DeepSeek (deepseek-chat)"

2. **信息获取逻辑**
   - 从settings配置中获取currentProvider和currentModel值
   - 如果是自定义Provider，显示Provider名称和模型ID
   - 如果是内置Provider（Google），显示相应信息

3. **显示位置**
   - 在聊天界面的顶部或底部显示
   - 可以考虑放在输入框附近，方便用户查看
   - 设计应与整体UI风格保持一致

4. **用户体验**
   - 显示信息应清晰可读
   - 可以考虑添加颜色区分或图标标识
   - 当前模型信息应该实时更新

#### Phase 5.3: 聊天界面显示当前Provider和Model信息 ✅ **已完成**
基于Phase 5.1的实现，需要在聊天界面显示当前使用的Provider和Model信息：
- [x] **创建状态显示组件**: 在聊天界面合适位置显示当前Provider和Model
- [x] **实现信息获取逻辑**: 从配置中获取当前Provider和Model信息
- [x] **设计显示格式**: 确定清晰直观的显示格式
- [x] **添加到聊天界面**: 将状态显示组件集成到聊天界面中

##### Phase 5.3 详细需求说明
1. **状态显示组件**
   - 创建一个轻量级的组件，用于显示当前Provider和Model信息
   - 组件应该简洁明了，不干扰正常的聊天体验
   - 显示格式示例："当前模型: DeepSeek (deepseek-chat)"

2. **信息获取逻辑**
   - 从settings配置中获取currentProvider和currentModel值
   - 如果是自定义Provider，显示Provider名称和模型ID
   - 如果是内置Provider（Google），显示相应信息

3. **显示位置**
   - 在聊天界面的顶部或底部显示
   - 可以考虑放在输入框附近，方便用户查看
   - 设计应与整体UI风格保持一致

4. **用户体验**
   - 显示信息应清晰可读
   - 可以考虑添加颜色区分或图标标识
   - 当前模型信息应该实时更新

### Phase 6: 配置UI重构 - 参考qwen-code设计 🚧 **待实现**
**目标**：实现更好的配置UI体验，支持分层配置
**核心改进**：
- 参考qwen-code的键盘导航和输入体验
- 支持模型级别的详细配置
- 实现配置的继承和覆盖UI

**文件影响分析**：
- ✅ `packages/cli/src/ui/components/ProviderConfigSteps.tsx` - **重构** (参考qwen-code UI)
- 🆕 `packages/cli/src/ui/components/ConfigFieldInput.tsx` - **新建** (通用配置输入组件)
- 🆕 `packages/cli/src/ui/components/ModelConfigDialog.tsx` - **新建** (模型详细配置对话框)
- 🆕 `packages/cli/src/ui/components/AdapterModelSelector.tsx` - **新建** (适配器模型选择器)

**侵入性评级**：🟡 **中等** - UI组件重构

### Phase 7: 配置流程优化 (PR7)
**目标**：优化配置流程，支持模型的智能选择和配置
**核心功能**：
- 基于适配器默认模型的智能推荐
- 支持模型配置的继承选择
- 实现配置预览和验证

**文件影响分析**：
- ✅ `packages/cli/src/ui/components/CustomProviderFlow.tsx` - **修改** (支持新的配置流程)
- 🆕 `packages/cli/src/ui/components/ModelInheritanceSelector.tsx` - **新建** (模型继承选择器)
- 🆕 `packages/cli/src/ui/components/ConfigPreviewDialog.tsx` - **新建** (配置预览对话框)

**侵入性评级**：🟢 **低** - 主要是UI流程优化

### Phase 8: /model 命令和集成测试 (PR8)
**目标**：完善用户体验和质量保证
**文件影响分析**：
- 🆕 `packages/cli/src/ui/commands/modelCommand.ts` - **新建**
- 🆕 相关测试文件 - **新建**

**侵入性评级**：🔵 **零侵入** - 全新功能组件

### 总体侵入性评估

#### 📊 文件统计
- **现有文件修改**: 4个 (极低侵入性修改)
- **新建文件**: 6个+ (零侵入性)
- **总文件影响**: 10个+

#### 🎯 关键代码定位
- **AuthDialog.tsx:101-109** - handleAuthSelect 函数 (核心修改点)
- **auth.ts:validateAuthMethod** - 验证逻辑增强
- **contentGenerator.ts** - 枚举扩展和工厂函数增强

#### ✅ 侵入性控制原则
1. **精确定位**: 仅修改确定需要改动的关键函数
2. **条件分支**: 新功能通过条件分支实现，不影响现有流程
3. **向后兼容**: 所有修改保持与现有功能完全兼容
4. **独立封装**: 新功能组件完全独立，可单独维护

## 架构演进分析

### Phase 1-4 已实现功能回顾
通过前4个Phase，我们已经成功实现了：
- ✅ **基础Custom Provider支持** - 用户可以添加自定义供应商
- ✅ **简单的配置流程** - 适配器选择、基本信息配置
- ✅ **OpenAI适配器实现** - 支持主流OpenAI兼容API
- ✅ **基础UI组件** - 分步配置界面和选择对话框

### Phase 5-8 新增需求分析

#### 🔍 **发现的核心问题**
1. **配置层次混乱**：当前用户配置只是简单的字符串数组，无法利用适配器的丰富默认配置
2. **模型配置缺失**：适配器内置了详细的模型信息（上下文窗口、功能特性等），但用户配置无法继承或覆盖
3. **UI体验不佳**：配置流程过于简化，缺少智能推荐和详细配置选项
4. **扩展性受限**：无法支持复杂的适配器级别配置覆盖

#### 🎯 **Phase 5-8 解决方案**

**Phase 5: 分层配置架构重构**
- **问题**：配置结构过于简单，无法支持复杂的继承和覆盖需求
- **解决**：重新设计配置接口，支持模型级别的详细配置和适配器级别的覆盖
- **价值**：为后续的智能配置和高级功能奠定基础

**Phase 6: 配置UI重构**
- **问题**：当前UI过于简化，用户体验不够友好
- **解决**：参考qwen-code的优秀设计，实现更好的键盘导航和输入体验
- **价值**：显著提升用户配置体验，降低配置门槛

**Phase 7: 配置流程优化**
- **问题**：配置流程缺少智能推荐和预览功能
- **解决**：基于适配器默认配置提供智能推荐，支持配置预览和验证
- **价值**：让用户更容易配置出最优的Provider设置

**Phase 8: 功能完善和测试**
- **问题**：缺少跨Provider的模型切换功能
- **解决**：实现/model命令，完善测试覆盖
- **价值**：提供完整的用户体验闭环

### 设计原则与约束

#### 🔒 **向后兼容性保证**
- 所有新的配置结构都支持从旧格式自动迁移
- 现有的Phase 1-4功能完全不受影响
- 用户可以选择使用简单配置或高级配置

#### 🎨 **用户体验优先**
- 参考qwen-code的成功设计模式
- 支持键盘导航和快捷操作
- 提供智能默认值和推荐配置

#### 🔧 **架构可扩展性**
- 分层配置支持未来更多适配器类型
- 配置解析器支持复杂的继承和覆盖逻辑
- UI组件设计为可复用和可扩展

## 总结

### 架构优势
1. **最小侵入**：仅修改关键函数，保持现有架构稳定
2. **完全绕过Google登录**：Custom Provider 不依赖任何 Google 服务
3. **分层配置架构**：支持系统级配置与用户配置的智能继承和覆盖
4. **优秀的用户体验**：参考qwen-code设计，提供直观的配置流程
5. **高度可扩展**：支持复杂的适配器配置和模型管理

### 关键特性
- ✅ **Phase 1-4已实现**：基础Custom Provider支持和OpenAI适配器
- 🚧 **Phase 5-8待实现**：分层配置、UI优化、智能推荐、功能完善

#### 已实现功能 (Phase 1-4)
- ✅ **启动时自动 Google 登录，用户可按 ESC 返回选择其他方式**
- ✅ **选择 Custom Provider 完全绕过 Google 认证**
- ✅ **分步配置：适配器 → 名称 → BaseURL → API Key → 模型**
- ✅ **支持已有配置列表和新建配置**
- ✅ **基础的OpenAI兼容适配器支持**

#### 待实现功能 (Phase 5-8)
- 🚧 **分层配置架构**：模型级别配置继承和覆盖
- 🚧 **智能模型推荐**：基于适配器默认配置的推荐系统
- 🚧 **优化的配置UI**：参考qwen-code的键盘导航体验
- 🚧 **配置预览和验证**：实时配置验证和预览功能
- 🚧 **/model 命令支持跨 Provider 模型切换**

这个演进方案在保持Phase 1-4已有成果的基础上，通过Phase 5-8的增强实现了从"能用"到"好用"的质的飞跃，为用户提供了企业级的配置管理体验。

## Git分支管理策略与开发TODO

### 分支结构设计
```
main (受保护，仅允许人工合并)
└── develop (开发主线，所有开发分支的基础)
    ├── feature/phase1-auth-core (Phase 1: 核心认证流程)
    ├── feature/phase2-auth-dialog (Phase 2: AuthDialog组件修改)  
    ├── feature/phase3-config-ui (Phase 3: 配置UI组件)
    ├── feature/phase4-openai-adapter (Phase 4: OpenAI适配器)
    └── feature/phase5-model-command (Phase 5: /model命令和测试)
```

### 开发工作流程

#### Phase 1: 核心认证流程修改 (feature/phase1-auth-core)
**分支来源**: `develop`  
**目标**: 最小侵入添加Custom Provider支持  
**开发任务**:
- [x] 添加AuthType.CUSTOM_PROVIDER枚举
- [x] 修改validateAuthMethod函数支持Custom Provider
- [x] 扩展Settings接口添加customProviders字段
- [x] 扩展createContentGenerator工厂函数
- [x] Phase1集成测试和代码review

**验收标准**:
- ✅ AuthType枚举包含CUSTOM_PROVIDER
- ✅ validateAuthMethod对Custom Provider返回null
- ✅ Settings接口支持customProviders配置
- ✅ 现有功能完全不受影响

#### Phase 2: AuthDialog组件修改 (feature/phase2-auth-dialog)  
**分支来源**: `develop` (包含Phase1修改)  
**目标**: UI层支持Custom Provider选项  
**开发任务**:
- [x] 修改AuthDialog.tsx添加Custom Provider选项
- [x] 实现handleAuthSelect函数Custom Provider分支
- [x] 添加showCustomProviderFlow状态管理
- [x] Phase2集成测试和UI验证

**验收标准**:
- ✅ 认证选择界面显示Custom Provider选项
- ✅ 选择Custom Provider触发正确的流程分支
- ✅ ESC可以正常返回认证选择界面

#### Phase 3: Custom Provider配置组件 (feature/phase3-config-ui)  
**分支来源**: `develop`  
**目标**: 完整的分步配置流程  
**开发任务**:
- [x] 创建CustomProviderFlow主流程组件
- [x] 创建ProviderSelectionDialog选择组件
- [x] 创建ProviderConfigSteps分步配置组件
- [x] 实现配置验证和错误处理逻辑
- [x] Phase3用户体验测试

**验收标准**:
- ✅ 支持选择已有Provider或新建Provider
- ✅ 分步配置流程: 适配器→名称→BaseURL→API Key→模型
- ✅ 输入验证和错误提示完善
- ✅ 配置完成后自动保存并进入聊天

#### Phase 4: OpenAI适配器实现 ✅ **已完成**
- [x] **开发分支创建**: feature/phase4-openai-adapter
- [x] **适配器基础结构**: 已完成
- [x] **格式转换实现**: 已完成
- [x] **ContentGenerator实现**: 已完成
- [x] **测试和审查**: 已完成
- [x] **合并到develop**: 已完成

#### Phase 5: 分层配置架构重构 🚧 **待实现**
- [ ] **开发分支创建**: feature/phase5-layered-config
- [ ] **Settings接口重构**: 未开始
- [ ] **配置加载器实现**: 未开始
- [ ] **配置解析器实现**: 未开始
- [ ] **适配器配置支持**: 未开始
- [ ] **向后兼容性测试**: 未开始
- [ ] **合并到develop**: 未开始

#### Phase 5.1: 配置结构增强和默认模型选择 ✅ **已完成**
基于Phase 4的实现，需要增强配置结构以支持以下功能：
- [x] **添加modelOverrides字段支持**：允许对特定模型进行详细配置覆盖
- [x] **默认模型选择机制**：配置完成后自动将第一个模型设置为当前模型
- [ ] **当前Provider/Model显示**：在聊天界面显示当前使用的Provider和Model信息
- [x] **配置结构文档更新**：更新文档以反映新的配置结构

##### Phase 5.1 详细需求说明
1. **modelOverrides字段支持**
   - 在CustomProviderConfig接口中添加modelOverrides字段
   - 该字段用于存储特定模型的覆盖配置
   - 配置优先级：用户特定模型配置 > 适配器默认配置

2. **默认模型选择机制**
   - 用户完成Custom Provider配置后，自动将第一个可用模型设置为当前模型
   - 避免用户配置完成后无法立即使用的问题
   - 优先级顺序：models中的第一个模型 > modelOverrides中的第一个模型 > 默认值

3. **当前Provider/Model显示**
   - 在聊天界面的合适位置显示当前使用的Provider和Model
   - 显示格式示例：`当前模型: DeepSeek (deepseek-chat)`
   - 为用户提供清晰的上下文信息

4. **向后兼容性**
   - 确保现有配置文件可以正常工作
   - 对于缺少modelOverrides字段的配置文件保持兼容

#### Phase 5.2: 聊天界面显示当前Provider和Model信息 🚧 **待实现**
基于Phase 5.1的实现，需要在聊天界面显示当前使用的Provider和Model信息：
- [ ] **创建状态显示组件**: 在聊天界面合适位置显示当前Provider和Model
- [ ] **实现信息获取逻辑**: 从配置中获取当前Provider和Model信息
- [ ] **设计显示格式**: 确定清晰直观的显示格式
- [ ] **添加到聊天界面**: 将状态显示组件集成到聊天界面中

##### Phase 5.2 详细需求说明
1. **状态显示组件**
   - 创建一个轻量级的组件，用于显示当前Provider和Model信息
   - 组件应该简洁明了，不干扰正常的聊天体验
   - 显示格式示例："当前模型: DeepSeek (deepseek-chat)"

2. **信息获取逻辑**
   - 从settings配置中获取currentProvider和currentModel值
   - 如果是自定义Provider，显示Provider名称和模型ID
   - 如果是内置Provider（Google），显示相应信息

3. **显示位置**
   - 在聊天界面的顶部或底部显示
   - 可以考虑放在输入框附近，方便用户查看
   - 设计应与整体UI风格保持一致

4. **用户体验**
   - 显示信息应清晰可读
   - 可以考虑添加颜色区分或图标标识
   - 当前模型信息应该实时更新

#### Phase 5.3: 聊天界面显示当前Provider和Model信息 ✅ **已完成**
基于Phase 5.1的实现，需要在聊天界面显示当前使用的Provider和Model信息：
- [x] **创建状态显示组件**: 在聊天界面合适位置显示当前Provider和Model
- [x] **实现信息获取逻辑**: 从配置中获取当前Provider和Model信息
- [x] **设计显示格式**: 确定清晰直观的显示格式
- [x] **添加到聊天界面**: 将状态显示组件集成到聊天界面中

##### Phase 5.3 详细需求说明
1. **状态显示组件**
   - 创建一个轻量级的组件，用于显示当前Provider和Model信息
   - 组件应该简洁明了，不干扰正常的聊天体验
   - 显示格式示例："当前模型: DeepSeek (deepseek-chat)"

2. **信息获取逻辑**
   - 从settings配置中获取currentProvider和currentModel值
   - 如果是自定义Provider，显示Provider名称和模型ID
   - 如果是内置Provider（Google），显示相应信息

3. **显示位置**
   - 在聊天界面的顶部或底部显示
   - 可以考虑放在输入框附近，方便用户查看
   - 设计应与整体UI风格保持一致

4. **用户体验**
   - 显示信息应清晰可读
   - 可以考虑添加颜色区分或图标标识
   - 当前模型信息应该实时更新

#### Phase 6: 配置UI重构 - 参考qwen-code设计 🚧 **待实现**
**分支来源**: `develop`  
**目标**: 实现更好的配置UI体验，支持分层配置  
**开发任务**:
- [ ] **开发分支创建**: feature/phase6-ui-refactor
- [ ] **ConfigFieldInput组件**: 未开始
- [ ] **AdapterModelSelector组件**: 未开始
- [ ] **ModelConfigDialog组件**: 未开始
- [ ] **ProviderConfigSteps重构**: 未开始
- [ ] **键盘导航优化**: 未开始
- [ ] **合并到develop**: 未开始

#### Phase 7: 配置流程优化 (feature/phase7-flow-optimization)
**分支来源**: `develop`  
**目标**: 优化配置流程，支持模型的智能选择和配置  
**开发任务**:
- [ ] **开发分支创建**: feature/phase7-flow-optimization
- [ ] **CustomProviderFlow修改**: 未开始
- [ ] **ModelInheritanceSelector组件**: 未开始
- [ ] **ConfigPreviewDialog组件**: 未开始
- [ ] **智能模型推荐**: 未开始
- [ ] **配置验证增强**: 未开始
- [ ] **合并到develop**: 未开始

#### Phase 8: /model命令和集成测试 (feature/phase8-model-command)
**分支来源**: `develop`  
**目标**: 完善用户体验和质量保证  
**开发任务**:
- [ ] **开发分支创建**: feature/phase8-model-command
- [ ] **/model命令实现**: 未开始
- [ ] **跨Provider切换**: 未开始
- [ ] **测试套件完善**: 未开始
- [ ] **文档更新**: 未开始
- [ ] **合并到develop**: 未开始

#### 最终发布
- [ ] **develop合并到main**: 未开始
- [ ] **版本标签**: 未开始
- [ ] **发布说明**: 未开始

### 开发注意事项

#### 代码质量要求
- 遵循现有代码风格和命名规范
- 添加适当的类型定义和JSDoc注释
- 保持函数和组件的单一职责原则
- 错误处理要完善和用户友好

#### 测试要求
- 每个新增功能都要有对应的单元测试
- 关键用户流程需要集成测试覆盖
- UI组件需要快照测试或视觉回归测试
- 性能敏感部分需要基准测试

#### 文档要求
- 重要接口和函数要有完整的JSDoc
- 用户面向的功能要更新用户指南
- 开发者文档要及时同步更新
- README中的功能清单要保持最新