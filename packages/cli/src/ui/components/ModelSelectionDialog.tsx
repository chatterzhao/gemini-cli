/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { CustomProviderConfig, LoadedSettings } from '../../config/settings.js';

interface ModelOption {
  providerId: string;
  provider: CustomProviderConfig;
  modelId: string;
}

interface ModelSelectionDialogProps {
  settings: LoadedSettings;
  onModelSelect: (providerId: string, modelId: string) => void;
  onCancel: () => void;
}

export function ModelSelectionDialog({
  settings,
  onModelSelect,
  onCancel
}: ModelSelectionDialogProps): React.JSX.Element {
  // 获取所有可用的模型选项
  const getModelOptions = (): ModelOption[] => {
    const customProviders = settings.user.settings.customProviders || {};
    const options: ModelOption[] = [];
    
    Object.entries(customProviders).forEach(([providerId, provider]) => {
      if (provider.models) {
        // models是一个字符串数组
        provider.models.forEach((modelId) => {
          options.push({
            providerId,
            provider,
            modelId,
          });
        });
      }
    });
    
    return options;
  };

  const modelOptions = getModelOptions();
  const items = modelOptions.map(option => ({
    label: `${option.modelId} (${option.providerId})`,
    value: option
  }));

  const handleSelect = (option: ModelOption) => {
    // 直接调用回调函数处理模型选择
    onModelSelect(option.providerId, option.modelId);
  };

  // 如果没有配置自定义提供者，显示提示信息
  if (modelOptions.length === 0) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.AccentBlue}
        flexDirection="column"
        padding={1}
        width="100%">
        <Text bold color={Colors.AccentBlue}>Select Model</Text>
        
        <Box marginTop={1}>
          <Text color={Colors.Gray}>No custom providers configured.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Use /provider add to configure a custom provider first.</Text>
        </Box>

        <Box marginTop={1}>
          <Text color={Colors.Gray}>
            Esc Cancel
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.AccentBlue}
      flexDirection="column"
      padding={1}
      width="100%">
      <Text bold color={Colors.AccentBlue}>Select Model</Text>
      
      <Box marginTop={1}>
        <RadioButtonSelect
          items={items}
          initialIndex={0}
          onSelect={(option) => handleSelect(option)}
          isFocused={true}
        />
      </Box>

      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          ↑↓ Navigate • Enter Select • Esc Cancel
        </Text>
      </Box>
    </Box>
  );
}