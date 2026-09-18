import { Injectable, Logger } from '@nestjs/common';
import type { BatteryInput, DirectiveInterpretation } from '../common/types.js';
import { LlmClassificationException } from '../common/errors.js';
import { GuardrailValidatorService } from '../guardrails/guardrail-validator.service.js';
import { HeuristicFallbackService } from '../guardrails/heuristic-fallback.service.js';
import { AppConfigService } from '../config/app-config.service.js';
import { LlmClientService } from './llm-client.service.js';
import {
  buildCorrectionPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from './llm-prompts.js';

@Injectable()
export class LlmInterpreterService {
  private readonly logger = new Logger('LlmInterpreterService');
  private readonly maxReprompts: number;

  constructor(
    private readonly llmClient: LlmClientService,
    private readonly validator: GuardrailValidatorService,
    private readonly heuristicFallback: HeuristicFallbackService,
    private readonly config: AppConfigService,
  ) {
    this.maxReprompts = config.llmMaxReprompts;
  }

  /**
   * Interprets every operator note into a validated, machine-checkable
   * DirectiveInterpretation (in order 0..notes.length-1).
   *
   * Strategy per note: LLM call -> deterministic validation; on rejection,
   * reprompt with the validation errors; on final rejection, best-effort
   * heuristic classification; if that yields nothing valid, throw (-> 500).
   */
  async interpretAll(
    notes: string[],
    battery: BatteryInput,
  ): Promise<DirectiveInterpretation[]> {
    const results: DirectiveInterpretation[] = [];
    for (let index = 0; index < notes.length; index += 1) {
      const note = notes[index];
      let outcome = await this.attemptLlm(index, note, notes.length, battery, 0, []);
      if (!outcome.ok) {
        for (let attempt = 1; attempt <= this.maxReprompts; attempt += 1) {
          outcome = await this.attemptLlm(
            index,
            note,
            notes.length,
            battery,
            attempt,
            outcome.reasons,
          );
          if (outcome.ok) break;
        }
      }
      if (!outcome.ok) {
        const fallback = this.heuristicFallback.classify(index, note, battery);
        if (fallback === null) {
          this.logger.error(
            `Heuristic fallback produced no valid classification for note ${index}`,
          );
          throw new LlmClassificationException(
            `Unable to interpret operator note ${index}`,
            index,
            outcome.reasons,
          );
        }
        this.logger.warn(
          `Using heuristic fallback for note ${index} after ${this.maxReprompts + 1} LLM attempt(s) failed`,
        );
        results.push(fallback);
        continue;
      }
      results.push(outcome.value!);
    }
    return results;
  }

  private async attemptLlm(
    index: number,
    note: string,
    noteCount: number,
    battery: BatteryInput,
    attempt: number,
    failureReasons: string[],
  ): Promise<{
    ok: boolean;
    value?: DirectiveInterpretation;
    reasons: string[];
  }> {
    const system = buildSystemPrompt();
    const user =
      attempt === 0
        ? buildUserPrompt(index, note, battery)
        : buildCorrectionPrompt(index, note, battery, failureReasons);
    let parsed: unknown;
    try {
      parsed = await this.llmClient.chatJson(system, user);
    } catch (error) {
      this.logger.warn(
        `LLM call failed for note ${index} (attempt ${attempt + 1}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { ok: false, reasons: failureReasons };
    }
    const validated = this.validator.validateRaw(parsed, {
      noteCount,
      battery,
    }, index);
    if (!validated.ok || validated.value === null) {
      return { ok: false, reasons: validated.reasons };
    }
    return { ok: true, value: validated.value, reasons: [] };
  }
}