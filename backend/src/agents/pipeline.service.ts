import { Injectable, Logger } from '@nestjs/common';
import { RouterAgentService } from './agent1-router.service';
import { OrchestratorAgentService } from './agent2-orchestrator.service';
import { ExtractorAgentService } from './agent3-extractor.service';
import { ResponderAgentService } from './agent4-responder.service';
import {
  ConversationState,
  ConversationTurn,
  ExtractorOutput,
  PipelineResult,
  AgentLanguage,
} from './agents.types';

/**
 * Pipeline Service — chains all 4 agents sequentially for a single incoming message.
 *
 * Flow:
 *   Message → Router → Orchestrator → (Extractor?) → Responder → Reply
 *
 * Features:
 *  - Structured per-agent logging (input summary, output summary, latency, model)
 *  - Graceful error handling: if any agent fails, falls back to safe defaults
 *  - Conversation state passed through and updated each turn
 *  - Extractor is only invoked when Orchestrator sets requires_extraction: true
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly router: RouterAgentService,
    private readonly orchestrator: OrchestratorAgentService,
    private readonly extractor: ExtractorAgentService,
    private readonly responder: ResponderAgentService,
  ) {}

  async run(
    message: string,
    state: ConversationState,
    history: ConversationTurn[],
    /** Optional DB query results pre-fetched by the caller */
    dbResults: Record<string, any> = {},
  ): Promise<PipelineResult> {
    const pipelineStart = Date.now();
    const logs: PipelineResult['agentLogs'] = [];

    this.logger.log(
      `[Pipeline] START userId=${state.userId} turn=${state.turnCount} message="${message.slice(0, 60)}"`,
    );

    // ── Agent 1: Router ───────────────────────────────────────────────────────
    const { output: routerOutput, log: routerLog } = await this.router.run(message, state);
    logs.push(routerLog);

    this.logger.log(
      `[Pipeline] Router → intent=${routerOutput.intent} conf=${routerOutput.confidence} lang=${routerOutput.language}`,
    );

    // ── Agent 2: Orchestrator ─────────────────────────────────────────────────
    const { output: orchestratorOutput, log: orchestratorLog } =
      await this.orchestrator.run(routerOutput, state, history, message);
    logs.push(orchestratorLog);

    this.logger.log(
      `[Pipeline] Orchestrator → action=${orchestratorOutput.action} extract=${orchestratorOutput.requires_extraction}`,
    );

    // ── Agent 3: Data Extractor (conditional) ─────────────────────────────────
    let extractorOutput: ExtractorOutput = null;
    if (orchestratorOutput.requires_extraction) {
      const { output, log: extractorLog } = await this.extractor.run(
        message,
        orchestratorOutput,
      );
      extractorOutput = output;
      logs.push(extractorLog);

      this.logger.log(
        `[Pipeline] Extractor → type=${output?.type ?? 'null'} crop=${(output as any)?.cropNormalized ?? '-'}`,
      );
    } else {
      this.logger.log(`[Pipeline] Extractor → skipped (requires_extraction=false)`);
    }

    // ── Agent 4: Response Generator ───────────────────────────────────────────
    const { output: reply, log: responderLog } = await this.responder.run(
      orchestratorOutput,
      extractorOutput,
      state,
      dbResults,
    );
    logs.push(responderLog);

    this.logger.log(
      `[Pipeline] Responder → "${reply.slice(0, 80)}"`,
    );

    // ── Compute state update ──────────────────────────────────────────────────
    const detectedLang = routerOutput.language;
    const stateUpdate: Partial<ConversationState> = {
      language: detectedLang as AgentLanguage,
      turnCount: state.turnCount + 1,
      lastIntent: routerOutput.intent,
      ...orchestratorOutput.state_update,
    };

    const totalMs = Date.now() - pipelineStart;
    this.logger.log(
      `[Pipeline] DONE totalLatency=${totalMs}ms agentsRun=${logs.length}`,
    );

    // Per-agent latency table for structured logging
    this.printAgentTable(logs);

    return {
      reply,
      stateUpdate,
      agentLogs: logs,
    };
  }

  private printAgentTable(logs: PipelineResult['agentLogs']): void {
    this.logger.debug('─── Agent Pipeline Trace ────────────────────────────────');
    for (const log of logs) {
      const status = log.success ? '✓' : '✗ (fallback)';
      this.logger.debug(
        `  ${status} [${log.agent}] model=${log.model} latency=${log.latencyMs}ms`,
      );
      this.logger.debug(`     in:  ${log.inputSummary}`);
      this.logger.debug(`     out: ${log.outputSummary}`);
      if (log.error) this.logger.debug(`     err: ${log.error}`);
    }
    this.logger.debug('────────────────────────────────────────────────────────');
  }
}
