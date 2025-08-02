/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
} from '@google/genai';
import { BaseAdapter, UserProviderConfig } from '../../base-adapter.js';

/**
 * Anthropic Claude API 适配器
 * 完全基于JSON配置，专注于格式转换
 */
export class AnthropicAdapter extends BaseAdapter {
  constructor(userConfig: UserProviderConfig) {
    super(userConfig);
  }

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    // TODO: 实现 Anthropic API 调用
    throw new Error('AnthropicAdapter not yet implemented');
  }

  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    // TODO: 实现 Anthropic 流式 API 调用
    throw new Error('AnthropicAdapter not yet implemented');
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // TODO: 实现 Anthropic token 计数
    throw new Error('AnthropicAdapter not yet implemented');
  }

  async embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    // Anthropic 不提供嵌入 API
    throw new Error('Anthropic does not provide embedding API');
  }
}