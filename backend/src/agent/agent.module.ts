import { Module } from '@nestjs/common';
import { OutlineModule } from '../outline/outline.module';
import { AgentService } from './agent.service';

@Module({
  imports: [OutlineModule],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
