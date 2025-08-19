/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useInput } from 'ink';
import { LoadedSettings, CustomProviderConfig } from '../../config/settings.js';
import { ProviderSelectionDialog } from './ProviderSelectionDialog.js';
import { CustomProviderConfigForm } from './CustomProviderConfigForm.js';

interface CustomProviderFlowProps {
  settings: LoadedSettings;
  onComplete: (providerConfig: CustomProviderConfig) => void;
  onCancel: () => void;
  onDelete: (providerId: string) => void;
  onModelUpdate: (providerConfig: CustomProviderConfig) => void;
}

type FlowStep = 'list' | 'adapter_selection' | 'config';

export function CustomProviderFlow({ 
  settings, 
  onComplete, 
  onCancel,
  onDelete,
  onModelUpdate
}: CustomProviderFlowProps): React.JSX.Element {
  const [step, setStep] = useState<FlowStep>('list');
  const [selectedProvider, setSelectedProvider] = useState<CustomProviderConfig | null>(null);
  const [selectedAdapterType, setSelectedAdapterType] = useState<'openai' | 'anthropic' | undefined>(undefined);

  useInput((_input, key) => {
    if (key.escape) {
      if (step === 'config') {
        // 从配置界面返回适配器选择或列表
        if (selectedProvider) {
          // 编辑模式：返回列表
          setStep('list');
          setSelectedProvider(null);
        } else {
          // 新建模式：返回适配器选择
          setStep('adapter_selection');
        }
      } else if (step === 'adapter_selection') {
        // 从适配器选择返回列表
        setStep('list');
      } else {
        // 从列表界面取消
        onCancel();
      }
    }
  });

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
        key="provider-list"
        title="Select Custom Provider"
        options={options}
        onSelect={(option) => {
          if (option.type === 'existing' && option.provider) {
            // 选择现有provider进入编辑模式
            setSelectedProvider(option.provider);
            setStep('config');
          } else {
            // 开始新建provider流程：先选择适配器
            setSelectedProvider(null);
            setStep('adapter_selection');
          }
        }}
        onCancel={onCancel}
      />
    );
  }

  // 步骤2: 适配器选择
  if (step === 'adapter_selection') {
    const adapterOptions = [
      { type: 'openai' as const, label: 'OpenAI Compatible (ChatGPT, DeepSeek, etc.)' },
      { type: 'anthropic' as const, label: 'Anthropic Compatible (Claude)' }
    ];

    return (
      <ProviderSelectionDialog
        key="adapter-selection"
        title="Select Adapter Type"
        options={adapterOptions.map(opt => ({
          type: 'add_new' as const,
          label: opt.label,
          adapterType: opt.type
        }))}
        onSelect={(option) => {
          setSelectedAdapterType((option as any).adapterType);
          setStep('config');
        }}
        onCancel={() => setStep('list')}
      />
    );
  }

  // 步骤3: 一体化配置表单
  return (
    <CustomProviderConfigForm
      initialConfig={selectedProvider || undefined}
      selectedAdapterType={selectedProvider ? undefined : selectedAdapterType}
      onComplete={onComplete}
      onCancel={() => {
        if (selectedProvider) {
          // 编辑模式：返回列表
          setStep('list');
          setSelectedProvider(null);
        } else {
          // 新建模式：返回适配器选择
          setStep('adapter_selection');
        }
      }}
      onDelete={(config) => {
        // 删除provider
        if (onDelete && config.id) {
          onDelete(config.id);
        }
        // 删除后返回列表
        setStep('list');
        setSelectedProvider(null);
      }}
      onModelUpdate={onModelUpdate}
    />
  );
}

