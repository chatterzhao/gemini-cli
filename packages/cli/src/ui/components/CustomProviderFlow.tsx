/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../colors.js';
import { LoadedSettings, SettingScope, CustomProviderConfig } from '../../config/settings.js';
import { AuthType } from '@google/gemini-cli-core';
import { ProviderSelectionDialog } from './ProviderSelectionDialog.js';
import { ProviderConfigSteps } from './ProviderConfigSteps.js';

interface CustomProviderFlowProps {
  settings: LoadedSettings;
  onComplete: (providerConfig: CustomProviderConfig) => void;
  onCancel: () => void;
}

type FlowStep = 'list' | 'adapter' | 'name' | 'baseurl' | 'apikey' | 'models';

export function CustomProviderFlow({ 
  settings, 
  onComplete, 
  onCancel 
}: CustomProviderFlowProps): React.JSX.Element {
  const [step, setStep] = useState<FlowStep>('list');
  const [config, setConfig] = useState<Partial<CustomProviderConfig>>({});

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
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
        title="Select Custom Provider"
        options={options}
        onSelect={(option) => {
          if (option.type === 'existing' && option.provider) {
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
        const stepFlow: Record<FlowStep, FlowStep | 'complete'> = {
          'list': 'adapter',
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
            createdAt: new Date().toISOString(),
          } as CustomProviderConfig;
          
          onComplete(finalConfig);
        } else {
          setStep(stepFlow[step] as FlowStep);
        }
      }}
      onBack={() => {
        const backFlow: Record<FlowStep, FlowStep> = {
          'list': 'list',
          'adapter': 'list',
          'name': 'adapter',
          'baseurl': 'name',
          'apikey': 'baseurl',
          'models': 'apikey'
        };
        setStep(backFlow[step]);
      }}
      onCancel={onCancel}
    />
  );
}

// 辅助函数：生成provider ID
function generateProviderId(name: string): string {
  // 将名称转换为小写，移除特殊字符，用连字符替换空格
  const baseId = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  
  // 添加时间戳确保唯一性
  const timestamp = Date.now().toString(36);
  return `${baseId}-${timestamp}`;
}