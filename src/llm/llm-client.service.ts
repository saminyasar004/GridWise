import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { LlmProviderException } from '../common/errors.js';
import type { LlmChatMessage } from '../common/types.js';

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: unknown; role?: string };
    finish_reason?: string | null;
  }>;
  error?: unknown;
}

@Injectable()
export class LlmClientService {
  private readonly logger = new Logger('LlmClientService');
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxProviderRetries: number;
  private readonly temperature: number;
  private readonly chatPath: string;

  constructor(private readonly config: AppConfigService) {
    this.baseUrl = config.llmBaseUrl.replace(/\/+$/, '');
    this.apiKey = config.llmApiKey;
    this.model = config.llmModel;
    this.timeoutMs = config.llmTimeoutMs;
    this.maxProviderRetries = config.llmMaxProviderRetries;
    this.temperature = config.llmTemperature;
    this.chatPath = config.chatCompletionsPath;
  }

  get providerReady(): boolean {
    return this.apiKey.length > 0 && this.model.length > 0;
  }

  async chatJson(system: string, user: string): Promise<unknown> {
    if (!this.providerReady) {
      throw new LlmProviderException(
        'LLM provider is not configured (missing LLM_API_KEY or LLM_MODEL)',
      );
    }
    const messages: LlmChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    const attempts = this.maxProviderRetries + 1;
    let lastError: LlmProviderException | null = null;
    for (let attempt = 0; attempt <= this.maxProviderRetries; attempt += 1) {
      try {
        return await this.callOnce(messages, true, attempt);
      } catch (error) {
        const err =
          error instanceof LlmProviderException
            ? error
            : new LlmProviderException(
                error instanceof Error ? error.message : 'Unknown LLM provider error',
              );
        lastError = err;
        if (attempt === this.maxProviderRetries) {
          break;
        }
        if (!err.retryable) {
          this.logger.warn(
            `LLM provider non-retryable failure (attempt ${attempt + 1}/${attempts})`,
          );
          break;
        }
        this.logger.warn(`LLM provider failure (attempt ${attempt + 1}/${attempts}), retrying`);
      }
    }
    throw lastError ?? new LlmProviderException('LLM provider call failed');
  }

  private async callOnce(
    messages: LlmChatMessage[],
    useJsonMode: boolean,
    providerAttempt: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${this.baseUrl}${this.chatPath}`;
      const body: Record<string, unknown> = {
        model: this.model,
        messages,
        temperature: this.temperature,
      };
      if (useJsonMode) {
        body.response_format = { type: 'json_object' };
      }

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          throw new LlmProviderException(
            `LLM provider timed out after ${this.timeoutMs}ms`,
          );
        }
        throw new LlmProviderException('LLM provider network error', undefined, true);
      }

      if (!response.ok) {
        const text = await this.safeResponseText(response);
        if (
          useJsonMode &&
          response.status >= 400 &&
          response.status < 500 &&
          /response_format|json_schema|unsupported|parameter/i.test(text)
        ) {
          this.logger.warn(
            'Provider does not support response_format; retrying without JSON mode',
          );
          return this.callOnce(messages, false, providerAttempt);
        }
        throw new LlmProviderException(
          `LLM provider returned HTTP ${response.status}`,
          response.status,
          response.status >= 500 || response.status === 429,
        );
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new LlmProviderException('LLM provider returned empty content');
      }
      return this.parseJson(content);
    } finally {
      clearTimeout(timer);
    }
  }

  private parseJson(content: string): unknown {
    const trimmed = content.trim();
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      const extracted = this.extractJsonObject(trimmed);
      if (extracted !== undefined) {
        return extracted;
      }
      throw new LlmProviderException('LLM output was not valid JSON');
    }
  }

  private extractJsonObject(content: string): unknown {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : content;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as unknown;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private async safeResponseText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }
}