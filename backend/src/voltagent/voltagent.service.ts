import { Injectable, Logger } from '@nestjs/common';
import { runPipeline } from './pipeline';

/**
 * VoltAgentService
 *
 * NestJS injectable wrapper around the VoltAgent pipeline.
 * This is the single entry point for all incoming messages —
 * it delegates to runPipeline() which routes through the
 * orchestrator → routerTool → dataExtractionTool → dbOperationsTool
 * → responseGeneratorTool chain.
 */
@Injectable()
export class VoltAgentService {
  private readonly logger = new Logger(VoltAgentService.name);

  async handle(message: string, phoneNumber: string): Promise<string> {
    try {
      const result = await runPipeline(message, phoneNumber);
      this.logger.log(
        `[VoltAgent] phone=${phoneNumber} durationMs=${result.durationMs} ` +
          `reply="${result.reply.slice(0, 80)}"`,
      );
      return result.reply;
    } catch (err) {
      this.logger.error(`[VoltAgent] Pipeline error for ${phoneNumber}`, err);
      return `Sorry, something went wrong. Please try again 🙏`;
    }
  }
}
