import { Module } from '@nestjs/common';
import { VoltAgentService } from './voltagent.service';

@Module({
  providers: [VoltAgentService],
  exports: [VoltAgentService],
})
export class VoltAgentModule {}
