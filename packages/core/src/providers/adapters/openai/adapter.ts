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
  Content,
  Part,
  Candidate,
  FinishReason,
} from '@google/genai';
import { BaseAdapter, UserProviderConfig } from '../../base-adapter.js';

/**
 * OpenAI API 适配器
 * 完全基于JSON配置，专注于格式转换
 */
export class OpenAIAdapter extends BaseAdapter {
  constructor(userConfig: UserProviderConfig) {
    super(userConfig);
  }

  /**
   * 检查错误是否为超时错误
   */
  private isTimeoutError(error: unknown): boolean {
    if (!error) return false;

    const errorMessage =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorCode = (error as any)?.code;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorType = (error as any)?.type;

    // 检查常见的超时错误指示符
    return (
      errorMessage.includes('timeout') ||
      errorMessage.includes('timed out') ||
      errorMessage.includes('connection timeout') ||
      errorMessage.includes('request timeout') ||
      errorMessage.includes('read timeout') ||
      errorMessage.includes('etimedout') || // 包含 ETIMEDOUT 消息检查
      errorMessage.includes('esockettimedout') || // 包含 ESOCKETTIMEDOUT 消息检查
      errorCode === 'ETIMEDOUT' ||
      errorCode === 'ESOCKETTIMEDOUT' ||
      errorType === 'timeout' ||
      // OpenAI 特定的超时指示符
      errorMessage.includes('request timed out') ||
      errorMessage.includes('deadline exceeded')
    );
  }

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    const startTime = Date.now();
    try {
      const apiRequest = this.buildApiRequest(request);
      
      const response = await fetch(this.getEndpointUrl('chat'), {
        method: 'POST',
        headers: this.getRequestHeaders(),
        body: JSON.stringify(apiRequest),
        signal: AbortSignal.timeout(this.getConfigValue('timeout', 30000)),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const apiResponse = await response.json();
      return this.convertToGeminiResponse(apiResponse);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      
      // 识别超时错误
      const isTimeoutError = this.isTimeoutError(error);
      const errorMessage = isTimeoutError
        ? `Request timeout after ${Math.round(durationMs / 1000)}s. Try reducing input length or increasing timeout in config.`
        : error instanceof Error
          ? error.message
          : String(error);

      console.error('OpenAI API Error:', errorMessage);

      // 提供有针对性的超时错误消息
      if (isTimeoutError) {
        throw new Error(
          `${errorMessage}\n\nTroubleshooting tips:\n` +
            `- Reduce input length or complexity\n` +
            `- Increase timeout in config: timeout\n` +
            `- Check network connectivity\n` +
            `- Consider using streaming mode for long responses`,
        );
      }

      throw new Error(`OpenAI API error: ${errorMessage}`);
    }
  }

  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const startTime = Date.now();
    try {
      const apiRequest = {
        ...this.buildApiRequest(request),
        stream: true,
      };

      const response = await fetch(this.getEndpointUrl('chat'), {
        method: 'POST',
        headers: this.getRequestHeaders(),
        body: JSON.stringify(apiRequest),
        signal: AbortSignal.timeout(this.getConfigValue('timeout', 30000)),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      return this.parseStreamResponse(response);
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // 识别超时错误
      const isTimeoutError = this.isTimeoutError(error);
      const errorMessage = isTimeoutError
        ? `Streaming setup timeout after ${Math.round(durationMs / 1000)}s. Try reducing input length or increasing timeout in config.`
        : error instanceof Error
          ? error.message
          : String(error);

      console.error('OpenAI API Streaming Error:', errorMessage);

      // 提供有针对性的流式处理超时错误消息
      if (isTimeoutError) {
        throw new Error(
          `${errorMessage}\n\nStreaming setup timeout troubleshooting:\n` +
            `- Reduce input length or complexity\n` +
            `- Increase timeout in config: timeout\n` +
            `- Check network connectivity and firewall settings\n` +
            `- Consider using non-streaming mode for very long inputs`,
        );
      }

      throw new Error(`OpenAI API error: ${errorMessage}`);
    }
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // 如果配置为使用响应中的token数，我们需要发送一个实际请求
    if (this.adapterConfig.tokenCounting.method === 'response_usage') {
      try {
        // 发送一个最小的请求来获取准确的token计数
        const minimalRequest = this.buildApiRequest({
          model: request.model,
          contents: request.contents,
          // 注意：这里使用any类型绕过类型检查，因为GenerateContentParameters接口中没有generationConfig字段
        } as any);
        
        const response = await fetch(this.getEndpointUrl('chat'), {
          method: 'POST',
          headers: this.getRequestHeaders(),
          body: JSON.stringify(minimalRequest),
          signal: AbortSignal.timeout(this.getConfigValue('timeout', 30000)),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const apiResponse = await response.json();
        const usage = this.extractTokenUsage(apiResponse);
        if (usage) {
          return { totalTokens: usage.promptTokens };
        }
      } catch (error) {
        console.warn('Failed to get accurate token count, falling back to estimation:', error);
      }
    }
    
    // 回退到估算方法
    // 使用基本的字符估算
    const contentStr = JSON.stringify(request.contents);
    const estimatedTokens = Math.ceil(contentStr.length / 4); // 粗略估算: 1 token ≈ 4 字符
    
    return { totalTokens: estimatedTokens };
  }

  async embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    // 提取内容文本（简化版本）
    let text = '';
    if ('contents' in request && request.contents && typeof request.contents === 'object') {
      const content = request.contents as Content;
      if ('parts' in content && content.parts) {
        text = content.parts.map((part: Part) => 
          'text' in part ? part.text : ''
        ).join(' ');
      }
    }
    
    const response = await fetch(this.getEndpointUrl('embedding'), {
      method: 'POST',
      headers: this.getRequestHeaders(),
      body: JSON.stringify({
        model: 'text-embedding-ada-002',
        input: text,
      }),
      signal: AbortSignal.timeout(this.getConfigValue('timeout', 30000)),
    });

    if (!response.ok) {
      throw new Error(`Embeddings API error: ${response.status} ${response.statusText}`);
    }

    const embeddingResponse = await response.json();
    return {
      embeddings: [{
        values: embeddingResponse.data[0].embedding,
      }],
    };
  }

  /**
   * 构建API请求
   */
  private buildApiRequest(request: GenerateContentParameters): any {
    const messages = this.convertContentsToMessages(request.contents);
    
    // 添加系统指令（如果存在）
    // 注意：GenerateContentParameters 接口中没有 systemInstruction 字段
    // 我们需要检查是否存在该字段
    if ('systemInstruction' in request && request.systemInstruction) {
      const systemContent = request.systemInstruction as Content;
      const systemText = systemContent.parts?.[0]?.text;
      if (systemText) {
        messages.unshift({ role: 'system', content: systemText });
      }
    }

    // 映射参数
    // 注意：GenerateContentParameters 接口中没有 generationConfig 字段
    // 我们需要检查是否存在该字段
    const mappedParams: any = {};
    if ('generationConfig' in request && request.generationConfig) {
      const generationConfig: any = request.generationConfig;
      if (generationConfig.temperature !== undefined) {
        mappedParams.temperature = generationConfig.temperature;
      }
      if (generationConfig.topP !== undefined) {
        mappedParams.topP = generationConfig.topP;
      }
      if (generationConfig.maxOutputTokens !== undefined) {
        mappedParams.maxTokens = generationConfig.maxOutputTokens;
      }
      if (generationConfig.stopSequences && generationConfig.stopSequences.length > 0) {
        mappedParams.stop = generationConfig.stopSequences;
      }
      if (generationConfig.presencePenalty !== undefined) {
        mappedParams.presencePenalty = generationConfig.presencePenalty;
      }
      if (generationConfig.frequencyPenalty !== undefined) {
        mappedParams.frequencyPenalty = generationConfig.frequencyPenalty;
      }
    }

    return {
      model: request.model,
      messages,
      ...mappedParams,
    };
  }

  /**
   * 转换内容为消息格式
   */
  private convertContentsToMessages(contents: any): any[] {
    if (typeof contents === 'string') {
      return [{ role: 'user', content: contents }];
    }

    if (Array.isArray(contents) && contents.length > 0 && 'text' in contents[0]) {
      const text = (contents as Part[]).map(part => part.text).join('');
      return [{ role: 'user', content: text }];
    }

    return (contents as Content[]).map(content => {
      // 处理多模态内容
      if (content.parts && content.parts.length === 1 && content.parts[0].text) {
        return {
          role: content.role === 'model' ? 'assistant' : content.role,
          content: content.parts[0].text,
        };
      }

      // 多模态内容
      const messageContent: any[] = [];
      if (content.parts) {
        for (const part of content.parts) {
          if (part.text) {
            messageContent.push({ type: 'text', text: part.text });
          } else if (part.inlineData && this.getSupportedModalities('text').includes('image')) {
            messageContent.push({
              type: 'image_url',
              image_url: {
                url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
              },
            });
          }
        }
      }

      return {
        role: content.role === 'model' ? 'assistant' : content.role,
        content: messageContent.length === 1 && messageContent[0].type === 'text' 
          ? messageContent[0].text 
          : messageContent,
      };
    });
  }
  
  /**
   * 获取支持的模态类型
   * @param role 角色名称
   * @returns 支持的模态数组
   */
  getSupportedModalities(role: string): string[] {
    // OpenAI 支持的模态
    return ['text', 'image'];
  }

  /**
   * 转换为Gemini响应格式
   */
  private convertToGeminiResponse(response: any): GenerateContentResponse {
    const choice = response.choices[0];
    
    const candidate: Candidate = {
      content: {
        parts: [{ text: choice.message.content }],
        role: 'model',
      },
      finishReason: this.convertFinishReason(choice.finish_reason),
      index: choice.index,
    };

    const usage = this.extractTokenUsage(response);

    return {
      candidates: [candidate],
      usageMetadata: usage ? {
        promptTokenCount: usage.promptTokens,
        candidatesTokenCount: usage.completionTokens,
        totalTokenCount: usage.totalTokens,
      } : undefined,
    } as GenerateContentResponse;
  }

  /**
   * 解析流式响应
   */
  private async* parseStreamResponse(
    response: Response,
  ): AsyncGenerator<GenerateContentResponse> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;

            try {
              const parsed = JSON.parse(data);
              const choice = parsed.choices[0];
              
              if (choice.delta?.content) {
                yield {
                  candidates: [{
                    content: {
                      parts: [{ text: choice.delta.content }],
                      role: 'model',
                    },
                    finishReason: choice.finish_reason ? 
                      this.convertFinishReason(choice.finish_reason) : undefined,
                    index: choice.index,
                  }],
                } as GenerateContentResponse;
              }
            } catch (error) {
              console.warn('Failed to parse streaming response:', error);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 转换结束原因
   */
  private convertFinishReason(reason: string): FinishReason {
    switch (reason) {
      case 'stop': return FinishReason.STOP;
      case 'length': return FinishReason.MAX_TOKENS;
      case 'content_filter': return FinishReason.SAFETY;
      default: return FinishReason.OTHER;
    }
  }
}