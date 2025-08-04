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

```typescript
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

```typescript
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

```typescript
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

```typescript
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

```typescript
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

```typescript
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

```typescript
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

```typescript
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

```json
{
  "selectedAuthType": "oauth-personal",
  "currentProvider": "deepseek",
  "currentModel": "deepseek-chat",
  "customProviders": {
    "deepseek": {
      "id": "deepseek",
      "name": "DeepSeek",
      "adapterType": "openai",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "${DEEPSEEK_API_KEY}",
      "models": ["deepseek-chat", "deepseek-reasoner"],
      "modelOverrides": {
        "deepseek-chat": {
          "contextWindow": 32768,
          "maxOutputTokens": 4096,
          "supportedModalities": ["text"],
          "features": {
            "streaming": true,
            "functionCalling": true,
            "vision": false
          }
        },
        "deepseek-reasoner": {
          "contextWindow": 32768,
          "maxOutputTokens": 4096,
          "supportedModalities": ["text"],
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
    },
    "anthropic": {
      "id": "anthropic",
      "name": "Anthropic",
      "adapterType": "openai",
      "baseUrl": "https://api.anthropic.com/v1",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "models": ["claude-sonnet-4-20250514","claude-opus-4-20250514"],
      "modelOverrides": {
        "claude-sonnet-4-20250514": {
          "contextWindow": 200000,
          "maxOutputTokens": 64000,
          "supportedModalities": ["text", "image"],
          "features": {
            "streaming": true,
            "functionCalling": true,
            "vision": false
          }
        },
        "claude-opus-4-20250514": {
          "contextWindow": 200000,
          "maxOutputTokens": 32000,
          "supportedModalities": ["text", "image"],
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
  }
}
```

### 5. ContentGenerator 适配器系统

#### 5.1 OpenAI 兼容适配器

```typescript
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

```typescript
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

```typescript
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

### Phase 1: 核心认证流程修改 ✅ **已完成**
**目标**：最小侵入式地添加 Custom Provider 支持
**关键修改**：
- AuthType 枚举添加 `CUSTOM_PROVIDER = 'custom-provider'`
- validateAuthMethod 函数支持 Custom Provider 绕过 Google 认证
- Settings 接口扩展支持 customProviders 配置

### Phase 2: AuthDialog 组件修改 ✅ **已完成**
**目标**：扩展认证对话框支持 Custom Provider 选项
**关键修改**：
- AuthDialog 添加 Custom Provider 选项
- handleAuthSelect 函数特殊处理 Custom Provider 分支
- 条件渲染显示 CustomProviderFlow 配置流程

### Phase 3: Custom Provider 配置组件 ✅ **已完成**
**目标**：实现完整的分步配置流程
**核心组件**：
- **CustomProviderFlow** - 主流程控制器，管理配置步骤
- **ProviderSelectionDialog** - 选择现有 Provider 或新建
- **ProviderConfigSteps** - 分步配置：适配器→名称→BaseURL→API Key→模型
- **ConfigFieldInput** - 通用配置输入组件，参考 qwen-code 设计

### Phase 4: OpenAI 适配器实现 ✅ **已完成**
**目标**：实现 OpenAI 兼容的 ContentGenerator
**核心功能**：
- OpenAI 格式与 Gemini 格式的双向转换
- 流式响应支持
- createContentGenerator 工厂函数扩展

### Phase 5: 模拟配置进行测试 ✅ **已完成**
**目标**：现在已经实现了phase1-4，应该有能正常使用了才对
**测试准备**：
- 准备 custom provider 正常配置会对应生成的那个配置文件，手工创建一个
- 准备里面真实的 baseurl,apikey,model,modelOverride等配置
**测试项目**：
- 测试启动 gemini cli，当有 custom provider 配置时，gemini cli 应该直接启动
- 测试根ai 对话是否能正确对话

### Phase 6: Custom Provider 配置 UI 重构  ✅ **已完成**

**设计目标**：重构现有的分步配置流程，实现类似 qwen-code 项目的一体化表单界面，支持键盘导航，在单个界面中同时显示所有配置项，提升用户体验。

#### 6.1 UI 设计原则

**参考设计**：基于 qwen-code 项目的 `OpenAIKeyPrompt.tsx` 组件设计理念
- **一体化界面**：所有配置项在同一界面显示，避免多步骤跳转
- **键盘友好**：支持 Tab/↑↓ 键导航，Enter 确认，Esc 取消
- **视觉指示**：使用 `>` 符号标识当前焦点字段，颜色区分活跃/非活跃状态
- **即时反馈**：字段验证和错误提示实时显示

#### 6.2 配置流程重新设计

**新建 Custom Provider 流程**：
```
认证界面选择 Custom Provider 
    ↓
Provider 选择页面（列表现有 + "Add New Provider..."）
    ↓
一体化配置表单界面：
├── Provider 基本信息区域
│   ├── Provider Name *     [> DeepSeek                    ]
│   ├── Provider ID         [  deepseek (auto-generated)  ]
│   ├── Adapter Type        [  openai/anthropic          ]
│   ├── Base URL *          [> https://api.deepseek.com/v1]
│   └── API Key *           [  ${DEEPSEEK_API_KEY} 引提醒两种，一种直接粘贴 apikey，将保存在 .gemini/settings.json内，可可自己设置环境变量，然后填写美元符号开头:$环境变量名        ]
├── Provider 设置区域  
│   ├── Timeout (ms)        [  30000                       ]
│   └── Max Retries         [  3                           ]
└── Models 配置区域
    ├── Model 1:
    │   ├── Model ID *      [  deepseek-chat               ]
    │   ├── Context Window  [  32768                       ]
    │   ├── Max Output      [  4096                        ]
    │   ├── Modalities      [  text                        ]
    │   ├── Streaming       [  Yes                         ]
    │   ├── Function Call   [  Yes                         ]
    │   └── Vision          [  No                          ]
    └── [Add New Model...] / [Remove Model]

Tab/↑↓ Navigate • Enter Continue/Toggle • Ctrl+A Add Model • Esc Cancel
```

**编辑已有 Provider 流程**：
```
认证界面选择 Custom Provider 
    ↓
Provider 选择页面（选择已有配置）
    ↓
一体化配置表单界面（与新增界面一致，只是预填充现有数据）
    ↓
修改后保存覆盖
```

#### 6.3 核心组件重构

**主要组件**：`CustomProviderConfigForm.tsx`（已存在，需重构）

**重构要点**：
1. **移除分步流程**：将现有的多步骤配置合并为单一表单界面
2. **键盘导航优化**：参考 qwen-code 的 `useInput` 处理逻辑
3. **字段管理**：实现动态字段列表，支持模型的添加/删除
4. **视觉设计**：采用 qwen-code 的视觉风格，包括边框、颜色、焦点指示

**关键实现细节**：
```typescript
// 字段导航系统
type FieldType = 
  | 'name' | 'id' | 'adapterType' | 'baseUrl' | 'apiKey' 
  | 'timeout' | 'maxRetries' 
  | `model-${number}-modelId` | `model-${number}-contextWindow` 
  | `model-${number}-maxOutputTokens` | `model-${number}-supportedModalities`
  | `model-${number}-streaming` | `model-${number}-functionCalling` | `model-${number}-vision`;

// 键盘导航处理
useInput((input, key) => {
  // Tab/方向键导航
  if (key.tab || key.downArrow) {
    const nextIndex = (currentFieldIndex + 1) % allFields.length;
    setCurrentField(allFields[nextIndex]);
  }
  
  // 特殊操作
  if (key.ctrl && input === 'a') {
    addNewModel(); // Ctrl+A 添加新模型
  }
  
  if (key.ctrl && input === 'd') {
    removeCurrentModel(); // Ctrl+D 删除当前模型
  }
});

// 字段渲染
const renderField = (label: string, field: FieldType, isRequired?: boolean) => (
  <Box marginTop={1} flexDirection="row">
    <Box width={20}>
      <Text color={currentField === field ? Colors.AccentBlue : Colors.Gray}>
        {label}{isRequired ? ' *' : ''}:
      </Text>
    </Box>
    <Box flexGrow={1}>
      <Text>
        {currentField === field ? '> ' : '  '}
        {getFieldValue(field)}
        {currentField === field && <Text color={Colors.Gray}>_</Text>}
      </Text>
    </Box>
  </Box>
);
```

#### 6.4 配置数据结构

**目标配置格式**（与现有保持一致）：
```json
{
  "selectedAuthType": "custom-provider",
  "currentProvider": "deepseek",
  "currentModel": "deepseek-chat",
  "customProviders": {
    "deepseek": {
      "id": "deepseek",
      "name": "DeepSeek",
      "displayName": "DeepSeek",
      "adapterType": "openai",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "${DEEPSEEK_API_KEY}",
      "models": ["deepseek-chat", "deepseek-reasoner"],
      "modelOverrides": {
        "deepseek-chat": {
          "contextWindow": 32768,
          "maxOutputTokens": 4096,
          "supportedModalities": ["text"],
          "features": {
            "streaming": true,
            "functionCalling": true,
            "vision": false
          }
        }
      },
      "providerOverrides": {
        "timeout": 30000,
        "maxRetries": 3
      },
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    }
  }
}
```

#### 6.5 用户体验优化

**易用性特性**：
1. **智能默认值**：customProviders下的provider 对象名默认与Provider ID一致， 自动从名称生成provider id，控制一些常见不允许的字符，新增配置的场景，需要填写的空显示灰色 placeholer
2. **实时验证**：必填字段检查，URL 格式验证，API Key 格式提示
3. **错误处理**：清晰的错误信息，对应输入框变红色和修复建议

**视觉设计**：
- 使用边框和颜色区分不同配置区域
- 当前焦点字段高亮显示（蓝色）
- 必填字段标记 `*` 
- 长文本字段支持自动换行，高度自适应

#### 6.6 实现优先级

**Phase 6.1**：重构 `CustomProviderConfigForm.tsx`
- 实现一体化表单界面
- 完善键盘导航系统
- 添加模型动态管理功能

**Phase 6.2**：用户体验优化
- 添加字段验证和错误处理
- 优化视觉设计和布局

**Phase 6.3**：测试和完善
- 全面测试键盘导航
- 验证配置数据正确性
- 优化性能和响应速度

**成功标准**：
- ✅ 用户可以在单一界面完成所有配置
- ✅ 键盘导航流畅，无需鼠标操作
- ✅ 支持多模型配置和动态添加/删除
- ✅ 新增和编辑已有配置数据格式正确
- ✅ 视觉设计清晰，用户体验良好

### Phase 7: 聊天界面状态显示 🚧 **待实现**
**目标**：修改聊天界面输入框下方现在显示model的位置，显示 provider/model这样的信息
**核心功能**：
- 轻量级状态显示组件
- 实时获取当前 Provider 和 Model 信息
- 清晰直观的显示格式(当前已经显示model信息了，需要拼接上porvider 信息，建议 xx/yy 这样)

**详细实现说明**：
1. **状态显示组件**
   - 创建了一个轻量级的状态显示组件，用于显示当前Provider和Model信息
   - 组件简洁明了，不干扰正常的聊天体验
   - 显示格式采用 "provider/model" 格式，例如："deepseek/deepseek-chat"

2. **信息获取逻辑**
   - 从settings配置中获取currentProvider和currentModel值
   - 如果是自定义Provider，显示Provideid
   - 如果是内置Provider（Google），显示相应信息

3. **显示位置**
   - 在聊天界面的输入框下方现有显示model的位置显示

### Phase 8: /model 命令支持  ✅ **已完成**
**目标**：支持切换已经配置好的自定义模型
**核心功能**：
- **/model 命令实现** - 跨 Provider 模型切换功能
- **模型选择对话框** - 统一的模型选择界面，似乎应该复用类似 provider 选择的那个选项组件

**关键特性**：
- 直观的模型选择界面，显示 Provider 和模型信息
- 方向键可选择，回车确认，确认后回到聊天界面，显示切换后的最新 provider 和 model信息
- 修改后更新 ～/.gemini/settings.json 文件的 "currentProvider": "deepseek","currentModel": "deepseek-chat" 这两个字段的值。更新方法可以参考 custom provider 的实现


## Git分支管理策略与开发TODO

### 分支结构设计
```
main (受保护，仅允许人工合并)
└── develop (开发主线，所有开发分支的基础)
    ├── feature/phase1-auth-core (Phase 1: 核心认证流程)
    ├── feature/phase2-auth-dialog (Phase 2: AuthDialog组件修改)  
    ├── feature/phase3-config-ui (Phase 3: 配置UI组件)
    ├── feature/phase4-openai-adapter (Phase 4: OpenAI适配器)
```

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