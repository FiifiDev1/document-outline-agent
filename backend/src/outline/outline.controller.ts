import { Controller, Get, Inject, Post } from '@nestjs/common';
import { ApiInternalServerErrorResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OutlineStore } from './outline.store';
import { toHttpException } from './outline.error';
import { seedOutline, withPositions } from '../common/utils';
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
}
