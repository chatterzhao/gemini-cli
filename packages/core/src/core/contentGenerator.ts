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
  GoogleGenAI,
} from '@google/genai';
import { createCodeAssistContentGenerator } from '../code_assist/codeAssist.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { Config } from '../config/config.js';
import { getEffectiveModel } from './modelCheck.js';
import { UserTierId } from '../code_assist/types.js';

// 添加适配器管理器导入
import { loadAdapter, type AdapterType } from '../providers/index.js';

/**
 * Interface abstracting the core functionalities for generating content and counting tokens.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;

  userTier?: UserTierId;
}

export enum AuthType {
  LOGIN_WITH_GOOGLE = 'oauth-personal',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  CLOUD_SHELL = 'cloud-shell',
  CUSTOM_PROVIDER = 'custom-provider',
}

export interface CustomProviderConfig {
  name: string;
  displayName: string;
  adapterType: 'openai-compatible' | 'anthropic' | 'custom';
  baseUrl: string;
  apiKey: string;
  models: string[];
}

export type ContentGeneratorConfig = {
  model: string;
  apiKey?: string;
  vertexai?: boolean;
  authType?: AuthType | undefined;
  proxy?: string | undefined;
  customProviderConfig?: CustomProviderConfig;
  provider?: string;
};

export function createContentGeneratorConfig(
  config: Config,
  authType: AuthType | undefined,
  customProviderSettings?: { currentProvider?: string; customProviders?: Record<string, CustomProviderConfig> }
): ContentGeneratorConfig {
  const geminiApiKey = process.env.GEMINI_API_KEY || undefined;
  const googleApiKey = process.env.GOOGLE_API_KEY || undefined;
  const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT || undefined;
  const googleCloudLocation = process.env.GOOGLE_CLOUD_LOCATION || undefined;

  // Use runtime model from config if available; otherwise, fall back to parameter or default
  const effectiveModel = config.getModel() || DEFAULT_GEMINI_MODEL;

  const contentGeneratorConfig: ContentGeneratorConfig = {
    model: effectiveModel,
    authType,
    proxy: config?.getProxy(),
  };

  // If we are using Google auth or we are in Cloud Shell, there is nothing else to validate for now
  if (
    authType === AuthType.LOGIN_WITH_GOOGLE ||
    authType === AuthType.CLOUD_SHELL
  ) {
    return contentGeneratorConfig;
  }

  if (authType === AuthType.USE_GEMINI && geminiApiKey) {
    contentGeneratorConfig.apiKey = geminiApiKey;
    contentGeneratorConfig.vertexai = false;
    getEffectiveModel(
      contentGeneratorConfig.apiKey,
      contentGeneratorConfig.model,
      contentGeneratorConfig.proxy,
    );

    return contentGeneratorConfig;
  }

  if (
    authType === AuthType.USE_VERTEX_AI &&
    (googleApiKey || (googleCloudProject && googleCloudLocation))
  ) {
    contentGeneratorConfig.apiKey = googleApiKey;
    contentGeneratorConfig.vertexai = true;

    return contentGeneratorConfig;
  }

  // Handle custom provider
  if (authType === AuthType.CUSTOM_PROVIDER && customProviderSettings?.currentProvider && customProviderSettings?.customProviders) {
    const currentProviderId = customProviderSettings.currentProvider;
    const customProviders = customProviderSettings.customProviders;
    const providerConfig = customProviders[currentProviderId];
    
    if (providerConfig) {
      contentGeneratorConfig.customProviderConfig = providerConfig;
      // Use the model from the custom provider if available, otherwise keep the default
      if (providerConfig.models && providerConfig.models.length > 0) {
        contentGeneratorConfig.model = providerConfig.models[0];
      }
    }
  }

  return contentGeneratorConfig;
}

export async function createContentGenerator(
  config: ContentGeneratorConfig,
  gcConfig: Config,
  sessionId?: string,
): Promise<ContentGenerator> {
  const version = process.env.CLI_VERSION || process.version;
  const httpOptions = {
    headers: {
      'User-Agent': `GeminiCLI/${version} (${process.platform}; ${process.arch})`,
    },
  };

  // Custom Provider 处理
  if (config.authType === AuthType.CUSTOM_PROVIDER) {
    return createCustomProviderContentGenerator(config, gcConfig, sessionId);
  }

  if (
    config.authType === AuthType.LOGIN_WITH_GOOGLE ||
    config.authType === AuthType.CLOUD_SHELL
  ) {
    return createCodeAssistContentGenerator(
      httpOptions,
      config.authType,
      gcConfig,
      sessionId,
    );
  }

  if (
    config.authType === AuthType.USE_GEMINI ||
    config.authType === AuthType.USE_VERTEX_AI
  ) {
    const googleGenAI = new GoogleGenAI({
      apiKey: config.apiKey === '' ? undefined : config.apiKey,
      vertexai: config.vertexai,
      httpOptions,
    });

    return googleGenAI.models;
  }

  throw new Error(
    `Error creating contentGenerator: Unsupported authType: ${config.authType}`,
  );
}

async function createCustomProviderContentGenerator(
  config: ContentGeneratorConfig,
  gcConfig: Config,
  sessionId?: string
): Promise<ContentGenerator> {
  // 获取自定义提供商配置
  const providerConfig = config.customProviderConfig;
  
  if (!providerConfig) {
    throw new Error(`Custom provider configuration is missing`);
  }

  // 使用适配器系统创建内容生成器
  return loadAdapter(
    providerConfig.adapterType as AdapterType,
    {
      id: providerConfig.name,
      name: providerConfig.displayName,
      adapterType: providerConfig.adapterType,
      baseUrl: providerConfig.baseUrl,
      apiKey: providerConfig.apiKey,
      models: providerConfig.models,
    }
  );
}
