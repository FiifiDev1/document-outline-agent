import { ApiProperty } from '@nestjs/swagger';

export class PositionedItemDto {
  // NOTE: explicit `type` on every property — tsx/esbuild drops design:type
  // metadata, same reason controllers need explicit @Inject().
  @ApiProperty({ example: 1, type: Number, description: '1-indexed position in the current outline order' })
  position!: number;

  @ApiProperty({ example: 'a1', type: String, description: 'Stable short item ID (never guessed, always from list)' })
  id!: string;

  @ApiProperty({ example: 'Introduction', type: String })
  title!: string;

  @ApiProperty({ example: 'Set context and agenda.', type: String })
  description!: string;
}

export class OutlineResponseDto {
  @ApiProperty({ type: [PositionedItemDto] })
  items!: PositionedItemDto[];
}

export class ResetResponseDto extends OutlineResponseDto {
  @ApiProperty({ example: true, type: Boolean, description: 'True when the seed was restored by this call' })
  reset!: boolean;
}

export class OutlineCorruptErrorDto {
  @ApiProperty({ example: 'outline_corrupt', type: String })
  error!: string;

  @ApiProperty({ example: 'outline.json is not valid. Fix the file by hand or POST /api/outline/reset to restore the seed.', type: String })
  hint!: string;

  @ApiProperty({ example: 'outline store corrupt at /path/outline.json: file is not valid JSON', type: String })
  detail!: string;
}
