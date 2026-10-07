import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ChatRequestDto {
  @ApiProperty({ example: "What's in my outline?", type: String })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiProperty({ example: 'a1b2c3', type: String, required: false, description: 'Thread to continue; omitted to start a new one' })
  @IsString()
  @IsOptional()
  threadId?: string;
}
