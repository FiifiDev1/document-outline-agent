import { Module } from '@nestjs/common';
import { OutlineController } from './outline.controller';
import { OutlineStore } from './outline.store';

// Persistence + read/reset API for the single outline.json file.
@Module({
  controllers: [OutlineController],
  providers: [OutlineStore],
  exports: [OutlineStore],
})
export class OutlineModule {}
