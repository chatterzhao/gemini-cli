/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from 'ink-testing-library';
import { vi } from 'vitest';
import { CustomProviderConfigForm } from './CustomProviderConfigForm.js';
import { CustomProviderConfig } from '../../config/settings.js';

describe('CustomProviderConfigForm', () => {
  const mockOnComplete = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders new provider form correctly', () => {
    const { lastFrame } = render(
      <CustomProviderConfigForm
        onComplete={mockOnComplete}
        onCancel={mockOnCancel}
      />
    );

    expect(lastFrame()).toContain('Add Custom Provider');
    expect(lastFrame()).toContain('Provider Information');
    expect(lastFrame()).toContain('Provider Name *:');
    expect(lastFrame()).toContain('Base URL *:');
    expect(lastFrame()).toContain('API Key *:');
    expect(lastFrame()).toContain('Models Configuration');
  });

  it('renders edit provider form correctly', () => {
    const initialConfig: CustomProviderConfig = {
      id: 'test-provider',
      name: 'Test Provider',
      displayName: 'Test Provider',
      adapterType: 'openai',
      baseUrl: 'https://api.test.com/v1',
      apiKey: 'test-key',
      models: ['test-model'],
      modelOverrides: {
        'test-model': {
          contextWindow: 4096,
          maxOutputTokens: 2048,
          supportedModalities: ['text'],
          features: {
            streaming: true,
            functionCalling: false,
            vision: false,
          },
        },
      },
      providerOverrides: {
        timeout: 60000,
        maxRetries: 5,
      },
      createdAt: '2025-01-01T00:00:00Z',
    };

    const { lastFrame } = render(
      <CustomProviderConfigForm
        initialConfig={initialConfig}
        onComplete={mockOnComplete}
        onCancel={mockOnCancel}
      />
    );

    expect(lastFrame()).toContain('Edit Custom Provider');
    expect(lastFrame()).toContain('Test Provider');
    expect(lastFrame()).toContain('test-provider');
  });

  it('shows navigation instructions', () => {
    const { lastFrame } = render(
      <CustomProviderConfigForm
        onComplete={mockOnComplete}
        onCancel={mockOnCancel}
      />
    );

    expect(lastFrame()).toContain('Ctrl+1-9 Jump to field');
    expect(lastFrame()).toContain('Tab/↑↓ Navigate');
    expect(lastFrame()).toContain('Ctrl+A Add Model');
    expect(lastFrame()).toContain('Esc Cancel');
  });
});