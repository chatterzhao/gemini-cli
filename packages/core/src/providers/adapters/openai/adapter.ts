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
  Tool,
  ToolListUnion,
  CallableTool,
  FunctionCall,
  FunctionResponse,
} from '@google/genai';
import { BaseAdapter, UserProviderConfig } from '../../base-adapter.js';

// OpenAI API type definitions for tool calling
interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * OpenAI API 适配器
 * 完全基于JSON配置，专注于格式转换
 */
export class OpenAIAdapter extends BaseAdapter {
  private streamingToolCalls: Map<
    number,
    {
      id?: string;
      name?: string;
      arguments: string;
    }
  > = new Map();

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
      // 处理responseMimeType和responseSchema参数
      let modifiedRequest = request;
      if (request.config?.responseMimeType === 'application/json') {
        // 对于需要JSON响应的请求，修改提示词以确保返回JSON格式
        modifiedRequest = this.modifyRequestForJsonResponse(request);
      }
      
      const apiRequest = await this.buildApiRequest(modifiedRequest);
      
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

  /**
   * 修改请求以确保返回JSON格式的响应
   */
  private modifyRequestForJsonResponse(request: GenerateContentParameters): GenerateContentParameters {
    // 创建请求的副本
    const modifiedRequest: any = JSON.parse(JSON.stringify(request));
    
    // 在最后一条用户消息中添加JSON格式的说明
    if (modifiedRequest.contents && modifiedRequest.contents.length > 0) {
      const lastContentIndex = modifiedRequest.contents.length - 1;
      const lastContent = modifiedRequest.contents[lastContentIndex];
      
      if (lastContent.role === 'user' && lastContent.parts && lastContent.parts.length > 0) {
        // 添加JSON格式说明到用户消息的末尾
        const jsonInstruction = "\n\n请以严格的JSON格式返回结果，不要包含其他文本或解释。" +
          "确保输出是有效的JSON，可以被JSON.parse()解析。";
        
        // 合并到最后一部分文本中
        const lastPart = lastContent.parts[lastContent.parts.length - 1];
        if (lastPart.text) {
          lastPart.text += jsonInstruction;
        } else {
          lastContent.parts.push({ text: jsonInstruction });
        }
      }
    }
    
    // 添加response_format参数以启用JSON模式
    if (!modifiedRequest.config) {
      modifiedRequest.config = {};
    }
    
    // 设置response_format为json_object以启用DeepSeek的JSON模式
    modifiedRequest.config.response_format = { type: 'json_object' };
    
    return modifiedRequest;
  }

  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const startTime = Date.now();
    try {
      const apiRequest = {
        ...(await this.buildApiRequest(request)),
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
        ? `Stream timeout after ${Math.round(durationMs / 1000)}s. Try reducing input length or increasing timeout in config.`
        : error instanceof Error
          ? error.message
          : String(error);

      console.error('OpenAI API Stream Error:', errorMessage);

      // 提供有针对性的超时错误消息
      if (isTimeoutError) {
        throw new Error(
          `${errorMessage}\n\nTroubleshooting tips:\n` +
            `- Reduce input length or complexity\n` +
            `- Increase timeout in config: timeout\n` +
            `- Check network connectivity`,
        );
      }

      throw new Error(`OpenAI API stream error: ${errorMessage}`);
    }
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // 如果配置了使用响应中的token计数，则尝试调用API获取准确计数
    if (this.adapterConfig.tokenCounting.method === 'response_usage') {
      try {
        // 构建一个最小的请求，只用于token计数
        const apiRequest = await this.buildApiRequest(request);
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
  private async buildApiRequest(request: GenerateContentParameters): Promise<any> {
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

    // 添加response_format参数（如果存在）
    if (request.config && (request.config as any).response_format) {
      mappedParams.response_format = (request.config as any).response_format;
    }

    const apiRequest: any = {
      model: request.model,
      messages,
      ...mappedParams,
    };

    // 添加工具支持
    if (request.config?.tools) {
      apiRequest.tools = await this.convertGeminiToolsToOpenAI(request.config.tools);
    }

    return apiRequest;
  }

  /**
   * 转换内容为消息格式，支持工具调用和工具响应
   */
  private convertContentsToMessages(contents: any): OpenAIMessage[] {
    if (typeof contents === 'string') {
      return [{ role: 'user', content: contents }];
    }

    if (Array.isArray(contents) && contents.length > 0 && 'text' in contents[0]) {
      const text = (contents as Part[]).map(part => part.text).join('');
      return [{ role: 'user', content: text }];
    }

    const messages: OpenAIMessage[] = [];

    for (const content of contents as Content[]) {
      if (!content.parts) continue;

      // 分析消息部分
      const functionCalls: FunctionCall[] = [];
      const functionResponses: FunctionResponse[] = [];
      const textParts: string[] = [];
      const imageParts: any[] = [];

      for (const part of content.parts) {
        if (typeof part === 'string') {
          textParts.push(part);
        } else if ('text' in part && part.text) {
          textParts.push(part.text);
        } else if ('functionCall' in part && part.functionCall) {
          functionCalls.push(part.functionCall);
        } else if ('functionResponse' in part && part.functionResponse) {
          functionResponses.push(part.functionResponse);
        } else if ('inlineData' in part && part.inlineData && this.getSupportedModalities('text').includes('image')) {
          imageParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
            },
          });
        }
      }

      // 处理工具响应（tool results）
      if (functionResponses.length > 0) {
        for (const funcResponse of functionResponses) {
          messages.push({
            role: 'tool',
            tool_call_id: funcResponse.id || '',
            content: typeof funcResponse.response === 'string'
              ? funcResponse.response
              : JSON.stringify(funcResponse.response),
          });
        }
      }
      // 处理模型消息（包含工具调用）
      else if (content.role === 'model' && functionCalls.length > 0) {
        const toolCalls = functionCalls.map((fc, index) => ({
          id: fc.id || `call_${index}`,
          type: 'function' as const,
          function: {
            name: fc.name || '',
            arguments: JSON.stringify(fc.args || {}),
          },
        }));

        messages.push({
          role: 'assistant',
          content: textParts.join('\n') || null,
          tool_calls: toolCalls,
        });
      }
      // 处理常规文本消息
      else {
        const role = content.role === 'model' ? 'assistant' : 'user';
        
        // 如果有图片，创建多模态消息
        if (imageParts.length > 0) {
          const messageContent: any[] = [];
          if (textParts.length > 0) {
            messageContent.push({ type: 'text', text: textParts.join('\n') });
          }
          messageContent.push(...imageParts);
          
          messages.push({
            role,
            content: JSON.stringify(messageContent), // OpenAI 期望字符串格式
          });
        } else {
          const text = textParts.join('\n');
          if (text) {
            messages.push({ role, content: text });
          }
        }
      }
    }

    return messages;
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
   * 转换API响应为Gemini格式，支持工具调用
   */
  private convertToGeminiResponse(response: any): GenerateContentResponse {
    // 处理错误响应
    if (response.error) {
      throw new Error(`API error: ${response.error.message}`);
    }

    const candidates: Candidate[] = [];
    
    // 处理选择项
    if (response.choices && response.choices.length > 0) {
      for (const choice of response.choices) {
        const parts: Part[] = [];

        // 处理文本内容
        if (choice.message?.content) {
          parts.push({ text: choice.message.content });
        }

        // 处理工具调用
        if (choice.message?.tool_calls) {
          for (const toolCall of choice.message.tool_calls) {
            if (toolCall.function) {
              let args: Record<string, unknown> = {};
              if (toolCall.function.arguments) {
                try {
                  args = JSON.parse(toolCall.function.arguments);
                } catch (error) {
                  console.error('Failed to parse function arguments:', error);
                  args = {};
                }
              }

              parts.push({
                functionCall: {
                  id: toolCall.id,
                  name: toolCall.function.name,
                  args,
                },
              });
            }
          }
        }

        const candidate: Candidate = {
          index: choice.index || 0,
          content: {
            role: 'model',
            parts,
          },
          finishReason: this.convertFinishReason(choice.finish_reason),
        };
        
        candidates.push(candidate);
      }
    }

    // 创建一个基础的GenerateContentResponse对象
    const baseResponse: any = {
      candidates,
    };

    // 如果有使用情况数据，添加到响应中
    if (response.usage) {
      baseResponse.usageMetadata = {
        promptTokenCount: response.usage.prompt_tokens,
        candidatesTokenCount: response.usage.completion_tokens,
        totalTokenCount: response.usage.total_tokens,
      };
    }

    return baseResponse as GenerateContentResponse;
  }

  /**
   * 转换完成原因
   */
  private convertFinishReason(finishReason: string): FinishReason {
    switch (finishReason) {
      case 'stop':
        return FinishReason.STOP;
      case 'length':
        return FinishReason.MAX_TOKENS;
      case 'content_filter':
        return FinishReason.SAFETY;
      case 'tool_calls':
        return FinishReason.STOP;
      default:
        return FinishReason.OTHER;
    }
  }

  /**
   * 解析流式响应，支持工具调用
   */
  private async* parseStreamResponse(
    response: Response,
  ): AsyncGenerator<GenerateContentResponse> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    // 重置流式工具调用累积器
    this.streamingToolCalls.clear();

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
              yield this.convertStreamChunkToGeminiFormat(parsed);
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
   * 转换流式响应块为 Gemini 格式，支持工具调用
   */
  private convertStreamChunkToGeminiFormat(chunk: any): GenerateContentResponse {
    const choice = chunk.choices?.[0];
    const parts: Part[] = [];

    if (choice) {
      // 处理文本内容
      if (choice.delta?.content) {
        parts.push({ text: choice.delta.content });
      }

      // 处理工具调用 - 只在流式传输期间累积，在完成时发出
      if (choice.delta?.tool_calls) {
        for (const toolCall of choice.delta.tool_calls) {
          const index = toolCall.index ?? 0;

          // 获取或创建此索引的工具调用累积器
          let accumulatedCall = this.streamingToolCalls.get(index);
          if (!accumulatedCall) {
            accumulatedCall = { arguments: '' };
            this.streamingToolCalls.set(index, accumulatedCall);
          }

          // 更新累积数据
          if (toolCall.id) {
            accumulatedCall.id = toolCall.id;
          }
          if (toolCall.function?.name) {
            accumulatedCall.name = toolCall.function.name;
          }
          if (toolCall.function?.arguments) {
            accumulatedCall.arguments += toolCall.function.arguments;
          }
        }
      }

      // 只在流式传输完成时发出函数调用（存在 finish_reason）
      if (choice.finish_reason) {
        for (const [, accumulatedCall] of this.streamingToolCalls) {
          if (accumulatedCall.name) {
            let args: Record<string, unknown> = {};
            if (accumulatedCall.arguments) {
              try {
                args = JSON.parse(accumulatedCall.arguments);
              } catch (error) {
                console.error('Failed to parse final tool call arguments:', error);
              }
            }

            parts.push({
              functionCall: {
                id: accumulatedCall.id,
                name: accumulatedCall.name,
                args,
              },
            });
          }
        }
        // 清除所有累积的工具调用
        this.streamingToolCalls.clear();
      }
    }

    const response = new GenerateContentResponse();
    response.candidates = [
      {
        content: {
          parts,
          role: 'model' as const,
        },
        finishReason: choice?.finish_reason
          ? this.convertFinishReason(choice.finish_reason)
          : FinishReason.FINISH_REASON_UNSPECIFIED,
        index: 0,
        safetyRatings: [],
      },
    ];

    // 添加使用情况元数据（如果在块中可用）
    if (chunk.usage) {
      response.usageMetadata = {
        promptTokenCount: chunk.usage.prompt_tokens || 0,
        candidatesTokenCount: chunk.usage.completion_tokens || 0,
        totalTokenCount: chunk.usage.total_tokens || 0,
      };
    }

    return response;
  }

  /**
   * 从API响应中提取token使用情况
   */
  protected extractTokenUsage(response: any): { promptTokens: number; completionTokens: number; totalTokens: number } | null {
    if (response.usage) {
      return {
        promptTokens: response.usage.prompt_tokens || 0,
        completionTokens: response.usage.completion_tokens || 0,
        totalTokens: response.usage.total_tokens || 0,
      };
    }
    return null;
  }

  /**
   * 转换 Gemini 工具格式到 OpenAI 格式
   */
  private async convertGeminiToolsToOpenAI(geminiTools: ToolListUnion): Promise<OpenAITool[]> {
    const openAITools: OpenAITool[] = [];

    for (const tool of geminiTools) {
      let actualTool: Tool;

      // 处理 CallableTool vs Tool
      if ('tool' in tool) {
        // 这是一个 CallableTool，需要调用 tool() 方法获取实际工具
        actualTool = await (tool as CallableTool).tool();
      } else {
        // 这已经是一个 Tool
        actualTool = tool as Tool;
      }

      if (actualTool.functionDeclarations) {
        for (const func of actualTool.functionDeclarations) {
          if (func.name && func.description) {
            openAITools.push({
              type: 'function',
              function: {
                name: func.name,
                description: func.description,
                parameters: this.convertGeminiParametersToOpenAI(
                  func.parameters as Record<string, unknown>
                ),
              },
            });
          }
        }
      }
    }

    return openAITools;
  }

  /**
   * 转换 Gemini 参数格式到 OpenAI JSON Schema 格式
   */
  private convertGeminiParametersToOpenAI(
    parameters?: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    if (!parameters || typeof parameters !== 'object') {
      return parameters;
    }

    const converted = JSON.parse(JSON.stringify(parameters));

    const convertTypes = (obj: unknown): unknown => {
      if (typeof obj !== 'object' || obj === null) {
        return obj;
      }

      if (Array.isArray(obj)) {
        return obj.map(convertTypes);
      }

      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'type' && typeof value === 'string') {
          // 转换 Gemini 类型到 OpenAI JSON Schema 类型
          const lowerValue = value.toLowerCase();
          if (lowerValue === 'integer') {
            result[key] = 'integer';
          } else if (lowerValue === 'number') {
            result[key] = 'number';
          } else {
            result[key] = lowerValue;
          }
        } else if (
          key === 'minimum' ||
          key === 'maximum' ||
          key === 'multipleOf'
        ) {
          // 确保数值约束是实际数字，而不是字符串
          if (typeof value === 'string' && !isNaN(Number(value))) {
            result[key] = Number(value);
          } else {
            result[key] = value;
          }
        } else if (
          key === 'minLength' ||
          key === 'maxLength' ||
          key === 'minItems' ||
          key === 'maxItems'
        ) {
          // 确保长度约束是整数，而不是字符串
          if (typeof value === 'string' && !isNaN(Number(value))) {
            result[key] = parseInt(value, 10);
          } else {
            result[key] = value;
          }
        } else if (typeof value === 'object') {
          result[key] = convertTypes(value);
        } else {
          result[key] = value;
        }
      }
      return result;
    };

    return convertTypes(converted) as Record<string, unknown> | undefined;
  }
}