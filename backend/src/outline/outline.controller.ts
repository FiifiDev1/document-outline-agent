import { Controller, Get, Inject, Post, Res } from '@nestjs/common';
import { ApiInternalServerErrorResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { OutlineStore } from './outline.store';
import { toHttpException } from './outline.error';
import { seedOutline, toMarkdown, withPositions } from '../common/utils';
import { OutlineCorruptErrorDto, OutlineResponseDto, ResetResponseDto } from './outline.dto';

@ApiTags('outline')
@Controller('outline')
export class OutlineController {
  // NOTE: explicit @Inject required — tsx/esbuild does not emit decorator
  // metadata, so design:paramtypes-based resolution yields undefined.
  constructor(@Inject(OutlineStore) private readonly store: OutlineStore) {}

  @Get()
  // Current outline with 1-indexed positions (the panel's read path).
  @ApiOperation({ summary: 'Get current outline with positions' })
  @ApiOkResponse({ type: OutlineResponseDto })
  @ApiInternalServerErrorResponse({ type: OutlineCorruptErrorDto })
  async get(): Promise<OutlineResponseDto> {
    try {
      const doc = await this.store.load();
      return { items: withPositions(doc) };
    } catch (err) {
      throw toHttpException(err);
    }
  }

  @Post('reset')
  // Dev/test helper: restore the seed so the 11-prompt script reruns from fresh state.
  @ApiOperation({ summary: 'Reset outline to the 6-item seed (dev/test helper)' })
  @ApiOkResponse({ type: ResetResponseDto })
  async reset(): Promise<ResetResponseDto> {
    try {
      const doc = await this.store.save(seedOutline());
      return { items: withPositions(doc), reset: true };
    } catch (err) {
      throw toHttpException(err);
    }
  }

  @Get('export')
  // Downloads the file-on-disk outline as Markdown (source of truth, not panel state).
  @ApiOperation({ summary: 'Export current outline as a Markdown download' })
  @ApiProduces('text/markdown')
  @ApiOkResponse({ description: 'outline.md attachment' })
  @ApiInternalServerErrorResponse({ type: OutlineCorruptErrorDto })
  async export(@Res() res: Response): Promise<void> {
    try {
      const doc = await this.store.load();
      res.set({ 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename="outline.md"' });
      res.send(toMarkdown(doc));
    } catch (err) {
      throw toHttpException(err);
    }
  }
}
