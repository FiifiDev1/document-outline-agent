import { Configuration, Value } from '@itgorillaz/configify';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

@Configuration()
export class LlmConfig {
  // Required: the agent cannot run without a key. Loaded from backend/.env
  // or the repo-root .env (see AppModule configFilePath).
  @Value('ANTHROPIC_API_KEY')
  @IsString()
  @IsNotEmpty()
  apiKey!: string;

  @Value('ANTHROPIC_MODEL', { default: 'claude-sonnet-4-5' })
  @IsString()
  @IsOptional()
  model!: string;
}
