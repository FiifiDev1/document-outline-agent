import * as path from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigifyModule } from '@itgorillaz/configify';
import { AppController } from './app.controller';
import { OutlineModule } from './outline/outline.module';
import { AgentModule } from './agent/agent.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    // Backend runs with cwd=backend/, but the .env lives at the repo root:
    // load it explicitly. backend/.env (default discovery) still wins on
    // conflict; real env vars always win over both files.
    ConfigifyModule.forRootAsync({
      configFilePath: [path.resolve(process.cwd(), '..', '.env')],
    }),
    OutlineModule,
    AgentModule,
    ChatModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
