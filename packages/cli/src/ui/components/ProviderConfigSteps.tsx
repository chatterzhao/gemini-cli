/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../colors.js';
import { CustomProviderConfig } from '../../config/settings.js';

type FlowStep = 'adapter' | 'name' | 'baseurl' | 'apikey' | 'models';

interface ProviderConfigStepsProps {
  step: FlowStep;
  config: Partial<CustomProviderConfig>;
  onStepComplete: (stepData: Partial<CustomProviderConfig>) => void;
  onBack: () => void;
  onCancel: () => void;
}

interface StepConfig {
  title: string;
  type: 'select' | 'input';
  options?: Array<{ value: string; label: string; description?: string }>;
  placeholder?: string;
  sensitive?: boolean;
  validation?: (value: string) => string | null;
}

export function ProviderConfigSteps({
  step,
  config,
  onStepComplete,
  onBack,
  onCancel
}: ProviderConfigStepsProps): React.JSX.Element {
  const [input, setInput] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stepConfigs: Record<FlowStep, StepConfig> = {
    adapter: {
      title: 'Select Adapter Type',
      type: 'select',
      options: [
        { 
          value: 'openai', 
          label: 'OpenAI Compatible', 
          description: 'Compatible with OpenAI API format (DeepSeek, Qwen, Ollama, etc.)' 
        },
        { 
          value: 'anthropic', 
          label: 'Anthropic', 
          description: 'Claude API format' 
        }
      ]
    },
    name: {
      title: 'Enter Configuration Name',
      type: 'input',
      placeholder: 'e.g., DeepSeek, Claude, Qwen, etc.',
      validation: (value: string) => value.trim().length > 0 ? null : 'Name cannot be empty'
    },
    baseurl: {
      title: 'Enter Base URL',
      type: 'input',
      placeholder: 'e.g., https://api.deepseek.com/v1',
      validation: (value: string) => {
        try {
          new URL(value);
          return null;
        } catch {
          return 'Invalid URL format';
        }
      }
    },
    apikey: {
      title: 'Enter API Key',
      type: 'input',
      placeholder: 'Enter your API Key',
      sensitive: true,
      validation: (value: string) => value.trim().length > 0 ? null : 'API Key cannot be empty'
    },
    models: {
      title: 'Enter Model List',
      type: 'input',
      placeholder: 'Multiple models separated by commas, e.g., deepseek-chat,deepseek-coder',
      validation: (value: string) => {
        const models = parseModels(value);
        return models.length > 0 ? null : 'At least one model is required';
      }
    }
  };

  const currentStep = stepConfigs[step];

  // 重置状态当步骤改变时
  useEffect(() => {
    setInput('');
    setSelectedIndex(0);
    setErrorMessage(null);
  }, [step]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.backspace || key.delete) {
      if (input.length === 0) {
        // 如果输入为空，返回上一步
        onBack();
        return;
      }
    }

    if (key.return) {
      handleSubmit();
      return;
    }

    if (currentStep.type === 'select') {
      if (key.upArrow) {
        setSelectedIndex(prev => 
          prev > 0 ? prev - 1 : (currentStep.options?.length || 1) - 1
        );
      } else if (key.downArrow) {
        setSelectedIndex(prev => 
          prev < (currentStep.options?.length || 1) - 1 ? prev + 1 : 0
        );
      }
    } else if (currentStep.type === 'input') {
      if (key.backspace || key.delete) {
        setInput(prev => prev.slice(0, -1));
        setErrorMessage(null);
      } else if (input && !key.meta && !key.ctrl) {
        setInput(prev => prev + input);
        setErrorMessage(null);
      }
    }
  });

  const handleSubmit = () => {
    if (currentStep.type === 'select') {
      const selected = currentStep.options?.[selectedIndex];
      if (selected) {
        onStepComplete({ [step]: selected.value });
      }
    } else {
      const error = currentStep.validation?.(input);
      if (error) {
        setErrorMessage(error);
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
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold>{currentStep.title}</Text>
      
      {currentStep.type === 'select' ? (
        <Box flexDirection="column" marginTop={1}>
          {currentStep.options?.map((option, index) => (
            <Box key={option.value} marginTop={index > 0 ? 1 : 0}>
              <Text>
                {index === selectedIndex ? '● ' : '○ '}
                {option.label}
              </Text>
              {option.description && (
                <Box marginLeft={4}>
                  <Text color={Colors.Gray}>
                    {option.description}
                  </Text>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      ) : (
        <Box marginTop={1}>
          <Box>
            <Text>
              {currentStep.sensitive ? '•'.repeat(input.length) : input}
              <Text color={Colors.Gray}>_</Text>
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={Colors.Gray}>{currentStep.placeholder}</Text>
          </Box>
        </Box>
      )}

      {errorMessage && (
        <Box marginTop={1}>
          <Text color={Colors.AccentRed}>{errorMessage}</Text>
        </Box>
      )}
      
      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          {currentStep.type === 'select' 
            ? '↑↓ Navigate • Enter Select • Backspace Back • Esc Cancel'
            : 'Type input • Enter Submit • Backspace Back • Esc Cancel'
          }
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