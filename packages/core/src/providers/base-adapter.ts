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
import { ContentGenerator } from '../core/contentGenerator.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 适配器JSON配置接口
 */
export interface AdapterConfig {
  adapterType: string;
  adapterName: string;
  description: string;
  version: string;
  author: string;
  
  apiFormat: {
    requestFormat: string;
    responseFormat: string;
    streamingFormat: string;
  };
  
  endpoints: Record<string, string>;
  parameterMapping: Record<string, string>;
  responseMapping: {
    content: string;
    finishReason: string;
    usage: {
      promptTokens: string;
      completionTokens: string;
      totalTokens: string;
    };
    streamContent: string;
    streamFinishReason: string;
  };
  
  tokenCounting: {
    method: 'response_usage' | 'estimation';
    fallbackEstimation: {
      baseRatio: number;
      chineseWeight: number;
      codeWeight: number;
      specialCharWeight: number;
    };
  };
  
  errorHandling: {
    rateLimitStatus: number;
    authErrorStatus: number;
    quotaErrorStatus: number;
    errorMessagePath: string;
  };
  
  requestHeaders?: {
    required?: Record<string, string>;
    optional?: Record<string, string>;
  };
  
  defaultModels: Record<string, {
    displayName: string;
    contextWindow: number;
    maxOutputTokens: number;
    supportedModalities: string[];
    features: {
      streaming: boolean;
      functionCalling: boolean;
      vision: boolean;
    };
  }>;
}

/**
 * 用户提供者配置
 */
export interface UserProviderConfig {
  id: string;
  name: string;
  adapterType: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  
  // 用户可以覆盖的模型配置
  modelOverrides?: Record<string, {
    contextWindow?: number;
    maxOutputTokens?: number;
    supportedModalities?: string[];
    features?: {
      streaming?: boolean;
      functionCalling?: boolean;
      vision?: boolean;
    };
  }>;
  
  // 提供商配置覆盖
  providerOverrides?: {
    timeout?: number;
    maxRetries?: number;
    customHeaders?: Record<string, string>;
    [key: string]: any;
  };
  
  createdAt?: string;
  updatedAt?: string;
}

/**
 * 基础适配器抽象类
 * 完全基于JSON配置工作，专注于格式转换
 */
export abstract class BaseAdapter implements ContentGenerator {
  protected userConfig: UserProviderConfig;
  protected adapterConfig: AdapterConfig;

  constructor(userConfig: UserProviderConfig) {
    this.userConfig = userConfig;
    this.adapterConfig = this.loadAdapterConfig(userConfig.adapterType);
  }

  /**
   * 加载适配器JSON配置
   */
  private loadAdapterConfig(adapterType: string): AdapterConfig {
    // 首先尝试从标准安装位置加载配置文件
    const possiblePaths = [
      // 打包安装后的位置
      path.join(__dirname, '..', 'adapters', adapterType, 'config.json'),
      // 开发环境位置
      path.join(__dirname, 'adapters', adapterType, 'config.json'),
      // 作为后备，尝试从当前工作目录的相对路径
      path.join(process.cwd(), 'adapters', adapterType, 'config.json')
    ];

    for (const configPath of possiblePaths) {
      try {
        if (fs.existsSync(configPath)) {
          const configData = fs.readFileSync(configPath, 'utf-8');
          return JSON.parse(configData) as AdapterConfig;
        }
      } catch (error) {
        // 继续尝试下一个路径
        continue;
      }
    }
    
    // 如果所有路径都失败了，抛出详细错误信息
    throw new Error(`Failed to load adapter config for '${adapterType}'. Searched paths: ${possiblePaths.join(', ')}`);
  }

  /**
   * 获取模型配置（合并用户覆盖）
   */
  protected getModelConfig(modelId: string) {
    const defaultConfig = this.adapterConfig.defaultModels[modelId];
    const userOverride = this.userConfig.modelOverrides?.[modelId];
    
    if (!defaultConfig) {
      return null;
    }
    
    // 深度合并用户覆盖配置
    return this.deepMerge(defaultConfig, userOverride || {});
  }

  /**
   * 获取配置值，优先使用用户配置
   */
  protected getConfigValue<T>(key: string, defaultValue: T): T {
    // 优先从providerOverrides获取
    if (this.userConfig.providerOverrides && key in this.userConfig.providerOverrides) {
      const value = (this.userConfig.providerOverrides as any)[key];
      if (value !== undefined && value !== null) {
        return value as T;
      }
    }
    
    // 其次从userConfig本身获取
    if (key in this.userConfig) {
      const value = (this.userConfig as any)[key];
      if (value !== undefined && value !== null) {
        return value as T;
      }
    }
    
    // 最后返回默认值
    return defaultValue;
  }

  /**
   * 获取API端点URL
   */
  protected getEndpointUrl(endpointType: string): string {
    const endpoint = this.adapterConfig.endpoints[endpointType];
    if (!endpoint) {
      throw new Error(`Endpoint '${endpointType}' not found in adapter config`);
    }
    
    return `${this.userConfig.baseUrl}${endpoint}`;
  }

  /**
   * 获取请求头
   */
  protected getRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // 添加适配器要求的头部
    if (this.adapterConfig.requestHeaders?.required) {
      for (const [key, value] of Object.entries(this.adapterConfig.requestHeaders.required)) {
        // 处理API密钥替换
        let resolvedApiKey = this.userConfig.apiKey;
        
        // 如果API密钥以$开头，尝试从环境变量获取
        if (resolvedApiKey && resolvedApiKey.startsWith('$')) {
          const envVarName = resolvedApiKey.substring(1);
          const envValue = process.env[envVarName];
          if (envValue) {
            resolvedApiKey = envValue;
          } else {
            console.error(`Warning: Environment variable '${envVarName}' not found for API key`);
          }
        }
        
        // 替换模板值并设置头部
        headers[key] = value.replace('{apiKey}', resolvedApiKey || '');
      }
    }
    
    // 添加用户自定义头部
    const customHeaders = this.getConfigValue('customHeaders', {});
    Object.assign(headers, customHeaders);
    
    return headers;
  }

  /**
   * 映射参数到API格式
   */
  protected mapParameters(params: Record<string, any>): Record<string, any> {
    const mapped: Record<string, any> = {};
    
    for (const [geminiParam, value] of Object.entries(params)) {
      const apiParam = this.adapterConfig.parameterMapping[geminiParam];
      if (apiParam && value !== undefined) {
        mapped[apiParam] = value;
      }
    }
    
    return mapped;
  }

  /**
   * 从响应中提取token使用情况
   */
  protected extractTokenUsage(response: any): { promptTokens: number; completionTokens: number; totalTokens: number } | null {
    if (this.adapterConfig.tokenCounting.method !== 'response_usage') {
      return null;
    }
    
    try {
      const usage = this.adapterConfig.responseMapping.usage;
      const promptTokens = this.getNestedValue(response, usage.promptTokens);
      const completionTokens = this.getNestedValue(response, usage.completionTokens);
      
      // 处理计算表达式（如 "usage.input_tokens + usage.output_tokens"）
      let totalTokens: number;
      if (usage.totalTokens.includes('+')) {
        const parts = usage.totalTokens.split('+').map(part => 
          this.getNestedValue(response, part.trim())
        );
        totalTokens = parts.reduce((sum, val) => sum + (val || 0), 0);
      } else {
        totalTokens = this.getNestedValue(response, usage.totalTokens);
      }
      
      return {
        promptTokens: promptTokens || 0,
        completionTokens: completionTokens || 0,
        totalTokens: totalTokens || 0,
      };
    } catch (error) {
      console.warn('Failed to extract token usage from response:', error);
      return null;
    }
  }

  /**
   * 获取嵌套对象的值
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split(/[\.\[\]]/).filter(Boolean).reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  /**
   * 深度合并对象，支持字段级覆盖
   * 用户配置的字段会覆盖默认配置的对应字段
   */
  private deepMerge(target: any, source: any): any {
    if (!source) return target;
    if (!target) return source;
    
    const result = { ...target };
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        const sourceValue = source[key];
        const targetValue = result[key];
        
        // 如果源值是对象且不是数组，进行深度合并
        if (
          sourceValue && 
          typeof sourceValue === 'object' && 
          !Array.isArray(sourceValue) &&
          targetValue &&
          typeof targetValue === 'object' &&
          !Array.isArray(targetValue)
        ) {
          result[key] = this.deepMerge(targetValue, sourceValue);
        } 
        // 如果是数组，直接覆盖
        else if (Array.isArray(sourceValue)) {
          result[key] = [...sourceValue];
        }
        // 否则直接覆盖（包括基本类型、null、undefined）
        else {
          result[key] = sourceValue;
        }
      }
    }
    
    return result;
  }

  /**
   * 获取模型的上下文窗口大小
   */
  getContextWindow(modelId: string): number {
    const modelConfig = this.getModelConfig(modelId);
    return modelConfig?.contextWindow || 4096;
  }

  /**
   * 检查是否支持某个模型
   */
  supportsModel(modelId: string): boolean {
    return this.userConfig.models.includes(modelId);
  }

  /**
   * 获取模型支持的模态
   */
  getSupportedModalities(modelId: string): string[] {
    const modelConfig = this.getModelConfig(modelId);
    return modelConfig?.supportedModalities || ['text'];
  }

  /**
   * 检查模型是否支持某个功能
   */
  supportsFeature(modelId: string, feature: string): boolean {
    const modelConfig = this.getModelConfig(modelId);
    if (!modelConfig) return false;
    
    return (modelConfig.features as any)[feature] === true;
  }

  // 抽象方法，子类必须实现
  abstract generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse>;

  abstract generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  abstract countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse>;

  abstract embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse>;
}