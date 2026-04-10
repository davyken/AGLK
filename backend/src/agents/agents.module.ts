import { Module } from '@nestjs/common';
import { RouterAgentService } from './agent1-router.service';
import { OrchestratorAgentService } from './agent2-orchestrator.service';
import { ExtractorAgentService } from './agent3-extractor.service';
import { ResponderAgentService } from './agent4-responder.service';
import { PipelineService } from './pipeline.service';

@Module({
  providers: [
    RouterAgentService,
    OrchestratorAgentService,
    ExtractorAgentService,
    ResponderAgentService,
    PipelineService,
  ],
  exports: [PipelineService],
})
export class AgentsModule {}
