import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service.js';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

@Injectable()
export class InMemoryCacheService {
  private readonly store = new Map<string, CacheEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly config: AppConfigService) {
    if (this.config.cacheEnabled) {
      this.cleanupInterval = setInterval(
        () => this.prune(),
        Math.max(30_000, this.config.cacheTtlMs / 3),
      );
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  get<T = unknown>(key: string): T | undefined {
    if (!this.config.cacheEnabled) return undefined;
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown): void {
    if (!this.config.cacheEnabled) return;
    if (this.store.size >= this.config.cacheMaxEntries) {
      this.evictOldest();
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    });
  }

  static hashPayload(payload: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  private evictOldest(): void {
    const oldestKey = this.store.keys().next().value;
    if (oldestKey) {
      this.store.delete(oldestKey);
    }
  }
}