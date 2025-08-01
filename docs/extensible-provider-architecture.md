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

## 优化后的架构设计

### 1. 扩展现有认证系统

#### 1.1 AuthType 枚举扩展

```typescript
// packages/core/src/core/contentGenerator.ts
export enum AuthType {
  LOGIN_WITH_GOOGLE = 'oauth-personal',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  CLOUD_SHELL = 'cloud-shell',
  CUSTOM_PROVIDER = 'custom-provider', // 新增
}
```

#### 1.2 认证验证逻辑修改

```typescript
// packages/cli/src/config/auth.ts - 精确修改 validateAuthMethod 函数
export const validateAuthMethod = (authMethod: string): string | null => {
  loadEnvironment();
  
  // ← 关键新增：Custom Provider 绕过 Google 认证验证
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

### 2. AuthDialog 组件精确修改

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
    { label: 'Custom Provider', value: AuthType.CUSTOM_PROVIDER }, // ← 新增
  ];

  // ← 关键修改：handleAuthSelect 函数 (第101-109行)
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
          settings.setValue(SettingScope.User, 'currentModel', providerConfig.models[0]);
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
          
          onComplete(finalConfig);
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

#### 3.2 ProviderConfigSteps - 分步配置界面

```typescript
// packages/cli/src/ui/components/ProviderConfigSteps.tsx
export function ProviderConfigSteps({ step, config, onStepComplete, onBack, onCancel }: Props) {
  const [input, setInput] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const stepConfigs = {
    adapter: {
      title: '选择适配器类型',
      type: 'select' as const,
      options: [
        { 
          value: 'openai', 
          label: 'OpenAI Compatible', 
          description: '兼容 OpenAI API 格式 (DeepSeek, Qwen, Ollama, etc.)' 
        },
        { 
          value: 'anthropic', 
          label: 'Anthropic', 
          description: 'Claude API 格式' 
        }
      ]
    },
    name: {
      title: '输入配置名称',
      type: 'input' as const,
      placeholder: '例如: DeepSeek, Claude, Qwen 等',
      validation: (value: string) => value.trim().length > 0 ? null : '名称不能为空'
    },
    baseurl: {
      title: '输入 Base URL',
      type: 'input' as const,
      placeholder: '例如: https://api.deepseek.com/v1',
      validation: (value: string) => {
        try {
          new URL(value);
          return null;
        } catch {
          return 'URL 格式不正确';
        }
      }
    },
    apikey: {
      title: '输入 API Key',
      type: 'input' as const,
      placeholder: '输入你的 API Key',
      sensitive: true,
      validation: (value: string) => value.trim().length > 0 ? null : 'API Key 不能为空'
    },
    models: {
      title: '输入模型列表',
      type: 'input' as const,
      placeholder: '多个模型用逗号分隔，例如: deepseek-chat,deepseek-coder',
      validation: (value: string) => {
        const models = parseModels(value);
        return models.length > 0 ? null : '至少需要输入一个模型';
      }
    }
  };

  const currentStep = stepConfigs[step];
  
  const handleSubmit = () => {
    if (currentStep.type === 'select') {
      const selected = currentStep.options[selectedIndex];
      onStepComplete({ [step]: selected.value });
    } else {
      const error = currentStep.validation?.(input);
      if (error) {
        // 显示错误提示
        return;
      }
      
      let value: any = input;
      if (step === 'models') {
        value = parseModels(input);
      }
      
      onStepComplete({ [step]: value });
    }
  };

  return (
    <Box borderStyle="round" borderColor="gray" padding={1} flexDirection="column">
      <Text bold>{currentStep.title}</Text>
      
      {currentStep.type === 'select' ? (
        <Box flexDirection="column" marginTop={1}>
          {currentStep.options.map((option, index) => (
            <Box key={option.value} marginTop={index > 0 ? 1 : 0}>
              <Text>
                {index === selectedIndex ? '● ' : '○ '}
                {option.label}
              </Text>
              {option.description && (
                <Text color="gray" marginLeft={4}>
                  {option.description}
                </Text>
              )}
            </Box>
          ))}
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text>
            {currentStep.sensitive ? '•'.repeat(input.length) : input}
          </Text>
          <Text color="gray">{currentStep.placeholder}</Text>
        </Box>
      )}
      
      <Box marginTop={1}>
        <Text color="gray">
          ↑↓ Navigate • Enter Submit • Backspace Back • Esc Cancel
        </Text>
      </Box>
    </Box>
  );
}

// 辅助函数：解析模型列表，支持中英文逗号
function parseModels(input: string): string[] {
  return input
    .split(/[,，]/) // 支持中英文逗号
    .map(model => model.trim())
    .filter(model => model.length > 0);
}
```

### 4. 配置文件结构扩展

#### 4.1 Settings 接口扩展

```typescript
// packages/cli/src/config/settings.ts - 扩展现有 Settings 接口
export interface Settings {
  // ... 现有字段保持不变
  selectedAuthType?: AuthType;
  
  // 新增：Custom Provider 相关配置
  currentProvider?: string;    // 当前使用的 provider ID  
  currentModel?: string;       // 当前使用的 model
  customProviders?: Record<string, CustomProviderConfig>;
}

export interface CustomProviderConfig {
  id: string;                  // 唯一标识
  name: string;               // 显示名称  
  adapterType: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  models: string[];           // 可用模型列表
  createdAt?: string;         // 创建时间
  updatedAt?: string;         // 更新时间
}
```

#### 4.2 配置文件示例

```json
{
  "selectedAuthType": "custom-provider",
  "currentProvider": "deepseek",
  "currentModel": "deepseek-chat",
  "customProviders": {
    "deepseek": {
      "id": "deepseek",
      "name": "DeepSeek",
      "adapterType": "openai",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "${DEEPSEEK_API_KEY}",
      "models": ["deepseek-chat", "deepseek-coder"],
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
    throw new Error(`Custom provider not found: ${currentProvider}`);
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

3. **packages/cli/src/ui/components/AuthDialog.tsx**
   - 修改内容：handleAuthSelect 函数 (第101-109行) 添加 Custom Provider 处理
   - 修改内容：items 数组添加 Custom Provider 选项
   - 修改内容：添加 showCustomProviderFlow 状态和条件渲染
   - 侵入程度：**中等** (核心UI组件修改，但逻辑封装良好)

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

### Phase 5: /model 命令和集成测试 (PR5)
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

## 总结

### 架构优势
1. **最小侵入**：仅修改关键函数，保持现有架构稳定
2. **完全绕过Google登录**：Custom Provider 不依赖任何 Google 服务
3. **用户体验优化**：ESC 返回选择界面，分步配置流程直观
4. **易于扩展**：支持 OpenAI 兼容和 Anthropic 适配器
5. **配置持久化**：用户配置自动保存和加载

### 关键特性
- ✅ **启动时自动 Google 登录，用户可按 ESC 返回选择其他方式**
- ✅ **选择 Custom Provider 完全绕过 Google 认证**
- ✅ **分步配置：适配器 → 名称 → BaseURL → API Key → 模型**
- ✅ **支持已有配置列表和新建配置**
- ✅ **多模型用逗号分隔，支持中英文逗号**
- ✅ **配置完成后直接进入聊天，记住用户选择**
- ✅ **/model 命令支持跨 Provider 模型切换**

这个方案完美融合了现有设计的架构完整性和我们分析得出的精确修改需求，实现了最小侵入、最大兼容的目标。

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
- [ ] 添加AuthType.CUSTOM_PROVIDER枚举
- [ ] 修改validateAuthMethod函数支持Custom Provider
- [ ] 扩展Settings接口添加customProviders字段
- [ ] 扩展createContentGenerator工厂函数
- [ ] Phase1集成测试和代码review

**验收标准**:
- ✅ AuthType枚举包含CUSTOM_PROVIDER
- ✅ validateAuthMethod对Custom Provider返回null
- ✅ Settings接口支持customProviders配置
- ✅ 现有功能完全不受影响

#### Phase 2: AuthDialog组件修改 (feature/phase2-auth-dialog)  
**分支来源**: `develop` (包含Phase1修改)  
**目标**: UI层支持Custom Provider选项  
**开发任务**:
- [ ] 修改AuthDialog.tsx添加Custom Provider选项
- [ ] 实现handleAuthSelect函数Custom Provider分支
- [ ] 添加showCustomProviderFlow状态管理
- [ ] Phase2集成测试和UI验证

**验收标准**:
- ✅ 认证选择界面显示Custom Provider选项
- ✅ 选择Custom Provider触发正确的流程分支
- ✅ ESC可以正常返回认证选择界面

#### Phase 3: Custom Provider配置组件 (feature/phase3-config-ui)  
**分支来源**: `develop`  
**目标**: 完整的分步配置流程  
**开发任务**:
- [ ] 创建CustomProviderFlow主流程组件
- [ ] 创建ProviderSelectionDialog选择组件
- [ ] 创建ProviderConfigSteps分步配置组件
- [ ] 实现配置验证和错误处理逻辑
- [ ] Phase3用户体验测试

**验收标准**:
- ✅ 支持选择已有Provider或新建Provider
- ✅ 分步配置流程: 适配器→名称→BaseURL→API Key→模型
- ✅ 输入验证和错误提示完善
- ✅ 配置完成后自动保存并进入聊天

#### Phase 4: OpenAI适配器实现 (feature/phase4-openai-adapter)
**分支来源**: `develop`  
**目标**: ContentGenerator适配器实现  
**开发任务**:
- [ ] 创建OpenAI适配器基础结构
- [ ] 实现格式转换方法(Gemini ↔ OpenAI)
- [ ] 实现generateContent方法
- [ ] 实现generateContentStream流式方法
- [ ] 实现工具调用和错误处理
- [ ] Phase4适配器功能测试

**验收标准**:
- ✅ OpenAI适配器完全实现ContentGenerator接口
- ✅ 支持标准对话、流式响应、工具调用
- ✅ 错误处理和重试机制完善
- ✅ 与现有功能完全兼容

#### Phase 5: /model命令和集成测试 (feature/phase5-model-command)
**分支来源**: `develop`  
**目标**: 完善用户体验和质量保证  
**开发任务**:
- [ ] 创建/model斜杠命令
- [ ] 实现跨Provider模型切换逻辑
- [ ] 编写单元测试覆盖关键组件
- [ ] 编写集成测试验证端到端流程
- [ ] 性能测试和压力测试
- [ ] 文档更新和用户指南

**验收标准**:
- ✅ /model命令支持跨Provider模型选择
- ✅ 模型切换无缝衔接，保持聊天历史
- ✅ 测试覆盖率达到90%以上
- ✅ 性能表现与原生Gemini相当

### 分支保护规则

#### main分支保护
- ✅ 禁止直接推送代码
- ✅ 需要Pull Request审查
- ✅ 需要所有CI/CD状态检查通过
- ✅ 需要分支为最新状态
- ✅ **仅允许项目管理员手动合并**
- ✅ 合并前需要完整的功能验收测试

#### develop分支保护
- ✅ 需要Pull Request审查
- ✅ 需要至少1人代码审查通过
- ✅ 需要CI/CD检查通过
- ✅ 需要单元测试通过
- ✅ 需要integration测试通过

### 开发流程规范

#### 1. 创建开发分支
```bash
# 从main创建develop分支
git checkout main
git pull origin main
git checkout -b develop
git push -u origin develop

# 从develop创建功能分支
git checkout develop
git pull origin develop
git checkout -b feature/phase1-auth-core
```

#### 2. 开发和提交
```bash
# 开发完成后提交
git add .
git commit -m "feat(auth): add CUSTOM_PROVIDER support

- Add AuthType.CUSTOM_PROVIDER enum
- Modify validateAuthMethod for custom provider bypass
- Extend Settings interface with customProviders field
- Update createContentGenerator factory function

Closes #issue-number"

git push origin feature/phase1-auth-core
```

#### 3. 创建Pull Request
- **目标分支**: develop
- **标题格式**: `[Phase X] 功能简述`
- **描述包含**: 
  - 功能变更说明
  - 测试验证结果
  - 截图或演示
  - 破坏性变更说明

#### 4. 代码审查和合并
- 至少1人审查通过
- 所有CI检查通过
- 手动功能验证通过
- 合并到develop分支

#### 5. 最终合并到main
- develop分支所有Phase完成
- 完整的端到端测试通过
- 性能回归测试通过
- 文档更新完成
- **项目管理员手动合并**

### 实现状态跟踪

#### Phase 1: 核心认证流程修改
- [ ] **开发分支创建**: feature/phase1-auth-core
- [ ] **AuthType枚举扩展**: 未开始
- [ ] **validateAuthMethod修改**: 未开始  
- [ ] **Settings接口扩展**: 未开始
- [ ] **工厂函数扩展**: 未开始
- [ ] **测试和审查**: 未开始
- [ ] **合并到develop**: 未开始

#### Phase 2: AuthDialog组件修改
- [ ] **开发分支创建**: feature/phase2-auth-dialog
- [ ] **AuthDialog UI修改**: 未开始
- [ ] **handleAuthSelect逻辑**: 未开始
- [ ] **状态管理**: 未开始
- [ ] **测试和审查**: 未开始
- [ ] **合并到develop**: 未开始

#### Phase 3: Custom Provider配置组件
- [ ] **开发分支创建**: feature/phase3-config-ui
- [ ] **CustomProviderFlow组件**: 未开始
- [ ] **ProviderSelectionDialog组件**: 未开始
- [ ] **ProviderConfigSteps组件**: 未开始
- [ ] **测试和审查**: 未开始
- [ ] **合并到develop**: 未开始

#### Phase 4: OpenAI适配器实现
- [ ] **开发分支创建**: feature/phase4-openai-adapter
- [ ] **适配器基础结构**: 未开始
- [ ] **格式转换实现**: 未开始
- [ ] **ContentGenerator实现**: 未开始
- [ ] **测试和审查**: 未开始
- [ ] **合并到develop**: 未开始

#### Phase 5: /model命令和集成测试
- [ ] **开发分支创建**: feature/phase5-model-command
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