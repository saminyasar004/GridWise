import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV', 'development');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.int('PORT', 3000);
  }

  get host(): string {
    return this.config.get<string>('HOST', '0.0.0.0');
  }

  get llmBaseUrl(): string {
    return this.config.get<string>(
      'LLM_BASE_URL',
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );
  }

  get llmApiKey(): string {
    return this.config.get<string>('LLM_API_KEY', '');
  }

  get llmModel(): string {
    return this.config.get<string>('LLM_MODEL', 'gemini-2.0-flash');
  }

  get llmTimeoutMs(): number {
    return this.int('LLM_TIMEOUT_MS', 9_000);
  }

  get llmMaxReprompts(): number {
    return this.int('LLM_MAX_REPROMPTS', 1);
  }

  get llmMaxProviderRetries(): number {
    return this.int('LLM_MAX_PROVIDER_RETRIES', 1);
  }

  get llmTemperature(): number {
    return this.float('LLM_TEMPERATURE', 0);
  }

  get chatCompletionsPath(): string {
    return this.config.get<string>('LLM_CHAT_COMPLETIONS_PATH', '/chat/completions');
  }

  get heuristicFallbackEnabled(): boolean {
    return this.bool('ENABLE_HEURISTIC_FALLBACK', true);
  }

  get cacheEnabled(): boolean {
    return this.bool('CACHE_ENABLED', true);
  }

  get cacheTtlMs(): number {
    return this.int('CACHE_TTL_MS', 300_000);
  }

  get cacheMaxEntries(): number {
    return this.int('CACHE_MAX_ENTRIES', 128);
  }

  get requestTimeoutMs(): number {
    return this.int('REQUEST_TIMEOUT_MS', 25_000);
  }

  get bodyLimitBytes(): number {
    return this.int('BODY_LIMIT_MB', 1) * 1_048_576;
  }

  get swaggerEnabled(): boolean {
    return this.bool('SWAGGER_ENABLED', true);
  }

  private int(name: string, fallback: number): number {
    const raw = this.config.get<string>(name);
    const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private float(name: string, fallback: number): number {
    const raw = this.config.get<string>(name);
    const parsed = raw === undefined ? NaN : Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private bool(name: string, fallback: boolean): boolean {
    const raw = this.config.get<string>(name);
    if (raw === undefined) {
      return fallback;
    }
    return raw.toLowerCase() === 'true' || raw === '1';
  }
}