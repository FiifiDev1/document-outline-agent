import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('app')
@Controller()
export class AppController {
  @Get('health')
  @ApiOperation({ summary: 'Liveness check' })
  @ApiOkResponse({ schema: { example: { ok: true } } })
  health() {
    return { ok: true };
  }
}
