/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BaseAdapter, UserProviderConfig } from './base-adapter.js';
import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
} from '@google/genai';

// 测试适配器实现
class TestAdapter extends BaseAdapter {
  constructor(userConfig: UserProviderConfig) {
    super(userConfig);
  }

  async generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse> {
    throw new Error('Not implemented for test');
  }

  async generateContentStream(request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> {
    throw new Error('Not implemented for test');
  }

  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    throw new Error('Not implemented for test');
  }

  async embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse> {
    throw new Error('Not implemented for test');
  }

  // 暴露私有方法用于测试
  public testDeepMerge(target: any, source: any): any {
    return (this as any).deepMerge(target, source);
  }

  public testGetModelConfig(modelId: string) {
    return this.getModelConfig(modelId);
  }
}

describe('BaseAdapter', () => {
  let adapter: TestAdapter;
  let userConfig: UserProviderConfig;

  beforeEach(() => {
    userConfig = {
      id: 'test-provider',
      name: 'Test Provider',
      adapterType: 'openai',
      baseUrl: 'https://api.test.com/v1',
      apiKey: 'test-key',
      models: ['test-model'],
    };
  });

  describe('deepMerge', () => {
    beforeEach(() => {
      adapter = new TestAdapter(userConfig);
    });

    it('should merge simple objects', () => {
      const target = { a: 1, b: 2 };
      const source = { b: 3, c: 4 };
      const result = adapter.testDeepMerge(target, source);
      
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('should deep merge nested objects', () => {
      const target = {
        features: {
          streaming: true,
          functionCalling: false,
          vision: false,
        },
        contextWindow: 4096,
      };
      
      const source = {
        features: {
          functionCalling: true,
          vision: true,
        },
        maxOutputTokens: 2048,
      };
      
      const result = adapter.testDeepMerge(target, source);
      
      expect(result).toEqual({
        features: {
          streaming: true,        // 保留原值
          functionCalling: true,  // 覆盖
          vision: true,          // 覆盖
        },
        contextWindow: 4096,     // 保留原值
        maxOutputTokens: 2048,   // 新增
      });
    });

    it('should handle array replacement (not merge)', () => {
      const target = {
        supportedModalities: ['text'],
        features: { streaming: true },
      };
      
      const source = {
        supportedModalities: ['text', 'image'],
      };
      
      const result = adapter.testDeepMerge(target, source);
      
      expect(result).toEqual({
        supportedModalities: ['text', 'image'], // 数组被完全替换
        features: { streaming: true },
      });
    });

    it('should handle null and undefined values', () => {
      const target = { a: 1, b: 2, c: 3 };
      const source = { b: null, c: undefined, d: 4 };
      const result = adapter.testDeepMerge(target, source);
      
      expect(result).toEqual({ a: 1, b: null, c: undefined, d: 4 });
    });

    it('should handle empty source', () => {
      const target = { a: 1, b: 2 };
      const source = {};
      const result = adapter.testDeepMerge(target, source);
      
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should handle null/undefined source', () => {
      const target = { a: 1, b: 2 };
      
      expect(adapter.testDeepMerge(target, null)).toEqual({ a: 1, b: 2 });
      expect(adapter.testDeepMerge(target, undefined)).toEqual({ a: 1, b: 2 });
    });
  });

  describe('model configuration override', () => {
    it('should apply model overrides correctly', () => {
      // 模拟适配器JSON配置中的默认模型
      const mockAdapterConfig = {
        adapterType: 'openai',
        adapterName: 'OpenAI Compatible',
        description: 'Test adapter',
        version: '1.0.0',
        author: 'Test',
        apiFormat: { requestFormat: 'openai', responseFormat: 'openai', streamingFormat: 'sse' },
        endpoints: { chat: '/chat/completions' },
        parameterMapping: {},
        responseMapping: {
          content: 'choices[0].message.content',
          finishReason: 'choices[0].finish_reason',
          usage: { promptTokens: 'usage.prompt_tokens', completionTokens: 'usage.completion_tokens', totalTokens: 'usage.total_tokens' },
          streamContent: 'choices[0].delta.content',
          streamFinishReason: 'choices[0].finish_reason'
        },
        tokenCounting: { method: 'response_usage' as const, fallbackEstimation: { baseRatio: 0.75, chineseWeight: 0.5, codeWeight: 0.2, specialCharWeight: 0.3 } },
        errorHandling: { rateLimitStatus: 429, authErrorStatus: 401, quotaErrorStatus: 429, errorMessagePath: 'error.message' },
        defaultModels: {
          'test-model': {
            displayName: 'Test Model',
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
      };

      // 用户配置中的模型覆盖
      const userConfigWithOverrides: UserProviderConfig = {
        ...userConfig,
        modelOverrides: {
          'test-model': {
            contextWindow: 8192,
            features: {
              functionCalling: true,
              vision: true,
            },
          },
        },
      };

      // 模拟适配器加载配置
      const adapter = new TestAdapter(userConfigWithOverrides);
      (adapter as any).adapterConfig = mockAdapterConfig;

      const modelConfig = adapter.testGetModelConfig('test-model');

      expect(modelConfig).toEqual({
        displayName: 'Test Model',        // 保留默认值
        contextWindow: 8192,              // 用户覆盖
        maxOutputTokens: 2048,            // 保留默认值
        supportedModalities: ['text'],    // 保留默认值
        features: {
          streaming: true,                // 保留默认值
          functionCalling: true,          // 用户覆盖
          vision: true,                   // 用户覆盖
        },
      });
    });

    it('should return null for non-existent model', () => {
      const adapter = new TestAdapter(userConfig);
      (adapter as any).adapterConfig = {
        defaultModels: {},
      };

      const modelConfig = adapter.testGetModelConfig('non-existent-model');
      expect(modelConfig).toBeNull();
    });
  });
});