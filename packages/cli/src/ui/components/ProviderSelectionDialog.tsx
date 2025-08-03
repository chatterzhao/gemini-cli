/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { CustomProviderConfig } from '../../config/settings.js';

interface ProviderOption {
  type: 'existing' | 'add_new';
  label: string;
  provider?: CustomProviderConfig;
  adapterType?: 'openai' | 'anthropic';
}

interface ProviderSelectionDialogProps {
  title: string;
  options: ProviderOption[];
  onSelect: (option: ProviderOption) => void;
  onCancel: () => void;
}

export function ProviderSelectionDialog({
  title,
  options,
  onSelect,
  onCancel
}: ProviderSelectionDialogProps): React.JSX.Element {
  const items = options.map(option => ({
    label: option.label,
    value: option
  }));

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.AccentBlue}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold color={Colors.AccentBlue}>{title}</Text>
      
      <Box marginTop={1}>
        <RadioButtonSelect
          items={items}
          initialIndex={0}
          onSelect={onSelect}
          isFocused={true}
        />
      </Box>

      {options.length === 1 && options[0].type === 'add_new' && (
        <Box marginTop={1}>
          <Text color={Colors.Gray}>No existing custom providers found.</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          ↑↓ Navigate • Enter Select • Esc Cancel
        </Text>
      </Box>
    </Box>
  );
}