/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// 导出基础适配器类和接口
export { BaseAdapter, type UserProviderConfig, type AdapterConfig } from './base-adapter.js';

// 导出具体的适配器实现
export { OpenAIAdapter } from './adapters/openai/adapter.js';
export { AnthropicAdapter } from './adapters/anthropic/adapter.js';

// 适配器注册表
export const AVAILABLE_ADAPTERS = {
  openai: () => import('./adapters/openai/adapter.js').then(m => m.OpenAIAdapter),
  anthropic: () => import('./adapters/anthropic/adapter.js').then(m => m.AnthropicAdapter),
} as const;

export type AdapterType = keyof typeof AVAILABLE_ADAPTERS;

/**
 * 动态加载适配器
 */
export async function loadAdapter(
  adapterType: AdapterType, 
  userConfig: import('./base-adapter.js').UserProviderConfig
) {
  const AdapterClass = await AVAILABLE_ADAPTERS[adapterType]();
  return new AdapterClass(userConfig);
}