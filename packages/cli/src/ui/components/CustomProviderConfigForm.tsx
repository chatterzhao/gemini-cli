/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../colors.js';
import { CustomProviderConfig } from '../../config/settings.js';

// 字段类型定义
type FieldType =
  | 'name'
  | 'adapterType'
  | 'baseUrl'
  | 'apiKey'
  | 'timeout'
  | 'maxRetries'
  | `model-${number}-modelId`
  | `model-${number}-contextWindow`
  | `model-${number}-maxOutputTokens`
  | `model-${number}-supportedModalities`
  | `model-${number}-streaming`
  | `model-${number}-functionCalling`
  | `model-${number}-vision`;

interface ModelConfig {
  modelId: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportedModalities: string;
  streaming: string;
  functionCalling: string;
  vision: string;
}

interface FormData {
  name: string;
  id: string;
  adapterType: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  timeout: number;
  maxRetries: number;
  models: ModelConfig[];
}

interface CustomProviderConfigFormProps {
  initialConfig?: CustomProviderConfig;
  selectedAdapterType?: 'openai' | 'anthropic';
  onComplete: (config: CustomProviderConfig) => void;
  onCancel: () => void;
  onDelete?: (config: CustomProviderConfig) => void;
  onModelUpdate?: (config: CustomProviderConfig) => void;
}

export function CustomProviderConfigForm({
  initialConfig,
  selectedAdapterType,
  onComplete,
  onCancel,
  onDelete,
  onModelUpdate
}: CustomProviderConfigFormProps): React.JSX.Element {
  // 初始化表单数据
  const [formData, setFormData] = useState<FormData>(() => {
    if (initialConfig) {
      // 编辑模式：从现有配置初始化
      const models: ModelConfig[] = initialConfig.models.map(modelId => {
        const override = initialConfig.modelOverrides?.[modelId];
        return {
          modelId,
          contextWindow: override?.contextWindow || 32768,
          maxOutputTokens: override?.maxOutputTokens || 4096,
          supportedModalities: Array.isArray(override?.supportedModalities) ? override.supportedModalities.join(', ') : (override?.supportedModalities || 'text'),
          streaming: override?.features?.streaming?.toString() ?? 'true',
          functionCalling: override?.features?.functionCalling?.toString() ?? 'true',
          vision: override?.features?.vision?.toString() ?? 'false',
        };
      });

      return {
        name: initialConfig.name,
        id: initialConfig.id,
        adapterType: initialConfig.adapterType,
        baseUrl: initialConfig.baseUrl,
        apiKey: initialConfig.apiKey,
        timeout: initialConfig.providerOverrides?.timeout || 30000,
        maxRetries: initialConfig.providerOverrides?.maxRetries || 3,
        models: models.length > 0 ? models : [createDefaultModel()],
      };
    } else {
      // 新建模式：使用默认值和预选的适配器类型
      return {
        name: '',
        id: '',
        adapterType: selectedAdapterType || 'openai',
        baseUrl: '',
        apiKey: '',
        timeout: 0,
        maxRetries: 0,
        models: [createDefaultModel()],
      };
    }
  });

  const [currentField, setCurrentField] = useState<FieldType>('name');
  const [inputValue, setInputValue] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<{ 
    type: 'model' | 'provider'; 
    modelIndex?: number; 
    modelId?: string; 
    isLastModel?: boolean;
  } | null>(null);

  // 生成所有字段列表
  const getAllFields = (): FieldType[] => {
    const baseFields: FieldType[] = [
      'name', 'adapterType', 'baseUrl', 'apiKey', 'timeout', 'maxRetries'
    ];

    const modelFields: FieldType[] = [];
    formData.models.forEach((_, index) => {
      modelFields.push(
        `model-${index}-modelId` as FieldType,
        `model-${index}-contextWindow` as FieldType,
        `model-${index}-maxOutputTokens` as FieldType,
        `model-${index}-supportedModalities` as FieldType,
        `model-${index}-streaming` as FieldType,
        `model-${index}-functionCalling` as FieldType,
        `model-${index}-vision` as FieldType
      );
    });

    return [...baseFields, ...modelFields];
  };

  // 获取字段值
  const getFieldValue = (field: FieldType): string => {
    if (field.startsWith('model-')) {
      const [, indexStr, fieldName] = field.split('-');
      const index = parseInt(indexStr);
      const model = formData.models[index];
      if (!model) return '';

      switch (fieldName) {
        case 'modelId': return model.modelId;
        case 'contextWindow': return model.contextWindow === 0 ? '' : model.contextWindow.toString();
        case 'maxOutputTokens': return model.maxOutputTokens === 0 ? '' : model.maxOutputTokens.toString();
        case 'supportedModalities': return model.supportedModalities;
        case 'streaming': return model.streaming;
        case 'functionCalling': return model.functionCalling;
        case 'vision': return model.vision;
        default: return '';
      }
    }

    switch (field) {
      case 'name': return formData.name;
      case 'adapterType': return formData.adapterType;
      case 'baseUrl': return formData.baseUrl;
      case 'apiKey': return formData.apiKey;
      case 'timeout': return formData.timeout === 0 ? '' : formData.timeout.toString();
      case 'maxRetries': return formData.maxRetries === 0 ? '' : formData.maxRetries.toString();
      default: return '';
    }
  };

  // 设置字段值
  const setFieldValue = (field: FieldType, value: string) => {
    if (field.startsWith('model-')) {
      const [, indexStr, fieldName] = field.split('-');
      const index = parseInt(indexStr);

      setFormData(prev => {
        const newModels = [...prev.models];
        const model = { ...newModels[index] };

        switch (fieldName) {
          case 'modelId':
            model.modelId = value;
            break;
          case 'contextWindow':
            model.contextWindow = parseInt(value) || 0;
            break;
          case 'maxOutputTokens':
            model.maxOutputTokens = parseInt(value) || 0;
            break;
          case 'supportedModalities':
            model.supportedModalities = value;
            break;
          case 'streaming':
            model.streaming = value;
            break;
          case 'functionCalling':
            model.functionCalling = value;
            break;
          case 'vision':
            model.vision = value;
            break;
        }

        newModels[index] = model;
        const updatedData = { ...prev, models: newModels };
        
        // 如果提供了onModelUpdate回调，则构建配置并调用
        if (onModelUpdate) {
          const modelConfig: CustomProviderConfig = {
            id: updatedData.id,
            name: updatedData.name,
            displayName: updatedData.name,
            adapterType: updatedData.adapterType,
            baseUrl: updatedData.baseUrl,
            apiKey: updatedData.apiKey,
            models: updatedData.models.map(m => m.modelId),
            modelOverrides: {},
            providerOverrides: {
              timeout: updatedData.timeout,
              maxRetries: updatedData.maxRetries,
            },
            createdAt: initialConfig?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          
          // 添加模型覆盖配置
          updatedData.models.forEach(model => {
            modelConfig.modelOverrides![model.modelId] = {
              contextWindow: model.contextWindow,
              maxOutputTokens: model.maxOutputTokens,
              supportedModalities: model.supportedModalities.split(',').map(s => s.trim()).filter(s => s),
              features: {
                streaming: model.streaming.toLowerCase() === 'true',
                functionCalling: model.functionCalling.toLowerCase() === 'true',
                vision: model.vision.toLowerCase() === 'true',
              },
            };
          });
          
          onModelUpdate(modelConfig);
        }
        
        return updatedData;
      });
    } else {
      setFormData(prev => {
        const newData = { ...prev };
        switch (field) {
          case 'name':
            newData.name = value;
            // 自动填充相关字段
            if (!initialConfig) {
              newData.id = generateProviderId(value);
              // 如果没有预选适配器类型，则根据名称推断
              if (!selectedAdapterType) {
                if (value.toLowerCase().includes('claude') || value.toLowerCase().includes('anthropic')) {
                  newData.adapterType = 'anthropic';
                } else {
                  newData.adapterType = 'openai';
                }
              }
            }
            break;
          case 'adapterType':
            newData.adapterType = value as 'openai' | 'anthropic';
            break;
          case 'baseUrl':
            newData.baseUrl = value;
            break;
          case 'apiKey':
            newData.apiKey = value;
            break;
          case 'timeout':
            newData.timeout = parseInt(value) || 0;
            break;
          case 'maxRetries':
            newData.maxRetries = parseInt(value) || 0;
            break;
        }
        return newData;
      });
    }
  };

  // 字段验证
  const validateField = (field: FieldType, value: string): string | null => {
    // 所有字段都必填（除了 adapterType 已经从上一步选择）
    if (field !== 'adapterType' && value.trim().length === 0) {
      return `${getFieldLabel(field)} cannot be empty`;
    }

    switch (field) {
      case 'name':
        return null; // 已在上面检查过非空
      case 'adapterType':
        if (value !== 'openai' && value !== 'anthropic') {
          return 'Adapter type must be "openai" or "anthropic"';
        }
        return null;
      case 'baseUrl':
        try {
          new URL(value);
          return null;
        } catch {
          return 'Invalid URL format';
        }
      case 'apiKey':
        return null; // 已在上面检查过非空
      case 'timeout':
        const timeout = parseInt(value);
        if (isNaN(timeout) || timeout <= 0) {
          return 'Timeout must be a positive number';
        }
        return null;
      case 'maxRetries':
        const retries = parseInt(value);
        if (isNaN(retries) || retries < 0) {
          return 'Max retries must be a non-negative number';
        }
        return null;
      default:
        if (field.includes('modelId')) {
          return null; // 已在上面检查过非空
        }
        if (field.includes('contextWindow') || field.includes('maxOutputTokens')) {
          const num = parseInt(value);
          if (isNaN(num) || num <= 0) {
            return `${getFieldLabel(field)} must be a positive number`;
          }
        }
        if (field.includes('streaming') || field.includes('functionCalling') || field.includes('vision')) {
          const lowerValue = value.toLowerCase().trim();
          if (lowerValue !== 'true' && lowerValue !== 'false') {
            return 'Must be "true" or "false"';
          }
        }
        if (field.includes('supportedModalities')) {
          const modalities = value.split(',').map(s => s.trim()).filter(s => s);
          const validModalities = ['text', 'image', 'audio', 'video'];
          const invalidModalities = modalities.filter(m => !validModalities.includes(m));
          if (invalidModalities.length > 0) {
            return `Invalid modalities: ${invalidModalities.join(', ')}. Valid: text, image, audio, video`;
          }
        }
        return null;
    }
  };



  // 键盘导航处理
  useInput((input, key) => {
    // 过滤终端焦点跟踪序列
    if (input === '[I' || input === '[O' || input === '[o') {
      return; // 忽略焦点进入/离开事件
    }

    // 处理删除确认
    if (confirmDelete) {
      if (key.escape || input.toLowerCase() === 'n') {
        setConfirmDelete(null);
        return;
      }
      if (input.toLowerCase() === 'y') {
        // 确认删除
        if (confirmDelete.type === 'provider') {
          // 删除整个provider
          if (onDelete && initialConfig) {
            onDelete(initialConfig);
          } else {
            // 如果没有删除回调或不是编辑模式，直接取消
            onCancel();
          }
        } else if (confirmDelete.type === 'model' && confirmDelete.modelIndex !== undefined) {
          // 删除模型
          setFormData(prev => {
            const updatedFormData = {
              ...prev,
              models: prev.models.filter((_, i) => i !== confirmDelete.modelIndex)
            };
            
            // 如果提供了 onModelUpdate 回调，则使用它来更新模型配置
            if (onModelUpdate && initialConfig) {
              // 构建更新后的配置
              const modelConfig: CustomProviderConfig = {
                id: initialConfig.id,
                name: updatedFormData.name,
                displayName: updatedFormData.name,
                adapterType: updatedFormData.adapterType,
                baseUrl: updatedFormData.baseUrl,
                apiKey: updatedFormData.apiKey,
                models: updatedFormData.models.map(m => m.modelId),
                modelOverrides: {},
                providerOverrides: {
                  timeout: updatedFormData.timeout,
                  maxRetries: updatedFormData.maxRetries,
                },
                createdAt: initialConfig.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };

              // 添加模型覆盖配置
              updatedFormData.models.forEach(model => {
                modelConfig.modelOverrides![model.modelId] = {
                  contextWindow: model.contextWindow,
                  maxOutputTokens: model.maxOutputTokens,
                  supportedModalities: model.supportedModalities.split(',').map(s => s.trim()).filter(s => s),
                  features: {
                    streaming: model.streaming.toLowerCase() === 'true',
                    functionCalling: model.functionCalling.toLowerCase() === 'true',
                    vision: model.vision.toLowerCase() === 'true',
                  },
                };
              });
              
              // 调用回调更新模型配置
              onModelUpdate(modelConfig);
            }
            
            return updatedFormData;
          });
          setConfirmDelete(null);
          // 重新设置焦点到第一个字段
          setCurrentField('name');
          setInputValue(formData.name);
        }
        return;
      }
      return; // 忽略其他按键
    }

    if (key.escape) {
      onCancel();
      return;
    }

    const allFields = getAllFields();
    const currentIndex = allFields.indexOf(currentField);

    // Tab/方向键导航
    if (key.tab || key.downArrow) {
      const nextIndex = (currentIndex + 1) % allFields.length;
      setCurrentField(allFields[nextIndex]);
      setInputValue(getFieldValue(allFields[nextIndex]));
      return;
    }

    if (key.upArrow) {
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : allFields.length - 1;
      setCurrentField(allFields[prevIndex]);
      setInputValue(getFieldValue(allFields[prevIndex]));
      return;
    }

    // Ctrl+A 添加新模型
    if (key.ctrl && input === 'a') {
      setFormData(prev => ({
        ...prev,
        models: [...prev.models, createDefaultModel()]
      }));
      return;
    }

    // Ctrl+R 删除当前模型或provider
    if (key.ctrl && input === 'r') {
      if (formData.models.length === 0) {
        if (initialConfig) {
          // 编辑模式：删除整个provider
          setConfirmDelete({ 
            type: 'provider'
          });
        } else {
          // 新建模式：返回上级界面
          onCancel();
          return;
        }
      } else if (currentField.startsWith('model-')) {
        // 删除当前模型
        const [, indexStr] = currentField.split('-');
        const index = parseInt(indexStr);
        const modelId = formData.models[index]?.modelId || `Model ${index + 1}`;
        const isLastModel = formData.models.length === 1;
        
        setConfirmDelete({ 
          type: 'model',
          modelIndex: index, 
          modelId,
          isLastModel
        });
      } else if (formData.models.length === 1) {
        // 当前焦点不在模型字段上，但只有一个模型，提示删除最后一个模型
        const index = 0;
        const modelId = formData.models[index]?.modelId || `Model ${index + 1}`;
        setConfirmDelete({ 
          type: 'model',
          modelIndex: index, 
          modelId,
          isLastModel: true
        });
      } else {
        // 当前焦点不在模型字段上，且有多个模型，直接删除整个 provider
        setConfirmDelete({ 
          type: 'provider'
        });
      }
      return;
    }

    // Enter 处理
    if (key.return) {
      // 提交表单
      handleSubmit();
      return;
    }



    // 处理输入
    if (key.backspace || key.delete) {
      const newValue = inputValue.slice(0, -1);
      setInputValue(newValue);
      setFieldValue(currentField, newValue);

      // 清除错误
      if (errors[currentField]) {
        setErrors(prev => ({ ...prev, [currentField]: '' }));
      }
    } else if (input && !key.meta && !key.ctrl) {
      // 过滤终端控制序列和非打印字符
      if (input.startsWith('[') || input.match(/[\x00-\x1F\x7F-\x9F]/)) {
        return; // 忽略控制序列
      }

      const newValue = inputValue + input;
      setInputValue(newValue);
      setFieldValue(currentField, newValue);

      // 清除错误
      if (errors[currentField]) {
        setErrors(prev => ({ ...prev, [currentField]: '' }));
      }
    }
  });

  // 提交表单
  const handleSubmit = () => {
    const allFields = getAllFields();
    const newErrors: Record<string, string> = {};

    // 验证所有字段
    allFields.forEach(field => {
      const value = getFieldValue(field);
      const error = validateField(field, value);
      if (error) {
        newErrors[field] = error;
      }
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // 构建最终配置
    const finalConfig: CustomProviderConfig = {
      id: formData.id,
      name: formData.name,
      displayName: formData.name,
      adapterType: formData.adapterType,
      baseUrl: formData.baseUrl,
      apiKey: formData.apiKey,
      models: formData.models.map(m => m.modelId),
      modelOverrides: {},
      providerOverrides: {
        timeout: formData.timeout,
        maxRetries: formData.maxRetries,
      },
      createdAt: initialConfig?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 添加模型覆盖配置
    formData.models.forEach(model => {
      finalConfig.modelOverrides![model.modelId] = {
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        supportedModalities: model.supportedModalities.split(',').map(s => s.trim()).filter(s => s),
        features: {
          streaming: model.streaming.toLowerCase() === 'true',
          functionCalling: model.functionCalling.toLowerCase() === 'true',
          vision: model.vision.toLowerCase() === 'true',
        },
      };
    });

    onComplete(finalConfig);
  };

  // 初始化输入值
  useEffect(() => {
    setInputValue(getFieldValue(currentField));
  }, [currentField]);

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.AccentBlue}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold color={Colors.AccentBlue}>
        {initialConfig ? 'Edit Custom Provider' : 'Add Custom Provider'}
      </Text>

      {/* Provider 基本信息区域 - 双列布局 */}
      <Box>
        <Text bold>Provider Information</Text>
      </Box>

      <Box flexDirection="row">
        <Box width="50%" paddingRight={1}>
          {renderField('Provider Name', 'name', true)}
        </Box>
        <Box width="50%" paddingLeft={1}>
          {renderField('Adapter Type', 'adapterType', true)}
        </Box>
      </Box>

      <Box flexDirection="row">
        <Box width="50%" paddingRight={1}>
          {renderField('Base URL', 'baseUrl', true)}
        </Box>
        <Box width="50%" paddingLeft={1}>
          {renderField('API Key', 'apiKey', true)}
        </Box>
      </Box>

      {/* Provider 设置区域 - 双列布局 */}
      <Box>
        <Text bold>Provider Settings</Text>
      </Box>

      <Box flexDirection="row">
        <Box width="50%" paddingRight={1}>
          {renderField('Timeout (ms)', 'timeout')}
        </Box>
        <Box width="50%" paddingLeft={1}>
          {renderField('Max Retries', 'maxRetries')}
        </Box>
      </Box>

      {/* Models 配置区域 */}
      <Box>
        <Text bold>Models Configuration</Text>
      </Box>

      {formData.models.map((_, index) => (
        <Box key={index} flexDirection="column" paddingLeft={2}>
          {index > 0 && (
            <Box>
              <Text color={Colors.Gray}>{'─'.repeat(60)}</Text>
            </Box>
          )}
          <Box>
            <Text bold color={Colors.AccentBlue}>Model {index + 1}:</Text>
          </Box>

          {/* 模型基本信息 - 单独一行 */}
          {renderField('Model ID', `model-${index}-modelId` as FieldType, true)}

          {/* 模型参数配置 - 三列布局 */}
          <Box flexDirection="row">
            <Box width="33%" paddingRight={1}>
              {renderField('Context Window', `model-${index}-contextWindow` as FieldType)}
            </Box>
            <Box width="33%" paddingX={1}>
              {renderField('Max Output', `model-${index}-maxOutputTokens` as FieldType)}
            </Box>
            <Box width="34%" paddingLeft={1}>
              {renderField('Modalities', `model-${index}-supportedModalities` as FieldType)}
            </Box>
          </Box>

          {/* 模型能力配置 - 三列布局 */}
          <Box flexDirection="row">
            <Box width="33%" paddingRight={1}>
              {renderField('Streaming', `model-${index}-streaming` as FieldType)}
            </Box>
            <Box width="33%" paddingX={1}>
              {renderField('Function Call', `model-${index}-functionCalling` as FieldType)}
            </Box>
            <Box width="34%" paddingLeft={1}>
              {renderField('Vision', `model-${index}-vision` as FieldType)}
            </Box>
          </Box>
        </Box>
      ))}

      <Box borderStyle="single" borderColor={Colors.Gray} paddingX={1} flexDirection="column">
        {confirmDelete ? (
          <Box flexDirection="column">
            <Text color="#ff0000">
              ⚠ {confirmDelete.type === 'provider' 
                ? `Delete entire provider "${formData.name}"?` 
                : `Remove model "${confirmDelete.modelId}"?`
              } Y to confirm, N/Esc to cancel
            </Text>
            {confirmDelete.type === 'model' && confirmDelete.isLastModel && (
              <Text color="#ff6666">
                Note: This is the last model. After deletion, you can press Ctrl+R again to remove the entire provider.
              </Text>
            )}
          </Box>
        ) : (
          <Text color={Colors.Gray}>
            Tab/↑↓ Navigate • Enter Submit/Toggle • Ctrl+A Add Model • Ctrl+R Remove model(Tab/↑↓ Navigate focus model first)/provider • Esc Cancel
          </Text>
        )}
      </Box>
    </Box>
  );

  // 渲染字段的辅助函数 - 标题在上面
  function renderField(label: string, field: FieldType, isRequired?: boolean) {
    const value = getFieldValue(field);
    const isFocused = currentField === field;
    const error = errors[field];
    const placeholder = getFieldPlaceholder(field);
    const isReadOnly = false; // 移除了 id 字段，所以没有只读字段

    // 显示值：如果有值显示值，否则显示 placeholder
    const displayValue = value || placeholder;
    const isPlaceholder = !value;

    return (
      <Box flexDirection="column" width="100%">
        {/* 标题在上面 */}
        <Box>
          <Text color={isFocused ? Colors.AccentBlue : Colors.Foreground}>
            {label}{isRequired ? ' *' : ''}
          </Text>
        </Box>

        {/* 输入框 - 左边缘与标题对齐 */}
        <Box
          borderStyle="single"
          borderColor={isFocused ? Colors.AccentBlue : Colors.Gray}
          paddingX={1}
          width="100%"
          marginLeft={-1}
        >
          <Text color={isPlaceholder ? Colors.Gray : Colors.Foreground}>
            {displayValue}
            {isFocused && !isReadOnly && <Text color={Colors.AccentBlue}>|</Text>}
          </Text>
        </Box>

        {/* 错误信息 */}
        {error && (
          <Box>
            <Text color={Colors.AccentRed}>⚠ {error}</Text>
          </Box>
        )}
      </Box>
    );
  }
}

// 辅助函数
function createDefaultModel(): ModelConfig {
  return {
    modelId: '',
    contextWindow: 0,
    maxOutputTokens: 0,
    supportedModalities: '',
    streaming: '',
    functionCalling: '',
    vision: '',
  };
}

function generateProviderId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'custom-provider';
}

function getFieldLabel(field: FieldType): string {
  switch (field) {
    case 'name': return 'Name';
    case 'adapterType': return 'Adapter Type';
    case 'baseUrl': return 'Base URL';
    case 'apiKey': return 'API Key';
    case 'timeout': return 'Timeout';
    case 'maxRetries': return 'Max Retries';
    default:
      if (field.includes('modelId')) return 'Model ID';
      if (field.includes('contextWindow')) return 'Context Window';
      if (field.includes('maxOutputTokens')) return 'Max Output Tokens';
      if (field.includes('supportedModalities')) return 'Supported Modalities';
      if (field.includes('streaming')) return 'Streaming';
      if (field.includes('functionCalling')) return 'Function Calling';
      if (field.includes('vision')) return 'Vision';
      return 'Field';
  }
}

function getFieldPlaceholder(field: FieldType): string {
  switch (field) {
    case 'name': return 'e.g., DeepSeek';
    case 'adapterType': return 'openai or anthropic';
    case 'baseUrl': return 'https://api.deepseek.com/v1';
    case 'apiKey': return 'Enter $ENV_NAME (tip: need $) or paste your API key here';
    case 'timeout': return '30000';
    case 'maxRetries': return '3';
    default:
      if (field.includes('modelId')) return 'deepseek-chat';
      if (field.includes('contextWindow')) return '32768';
      if (field.includes('maxOutputTokens')) return '4096';
      if (field.includes('supportedModalities')) return 'text, image (comma separated)';
      if (field.includes('streaming')) return 'true or false';
      if (field.includes('functionCalling')) return 'true or false';
      if (field.includes('vision')) return 'true or false';
      return '';
  }
}