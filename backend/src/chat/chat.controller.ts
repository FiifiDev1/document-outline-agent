import { Body, Controller, HttpException, HttpStatus, Inject, Post, Res } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { AgentService } from '../agent/agent.service';
import { ChatRequestDto } from './chat.dto';

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  // NOTE: explicit @Inject (tsx/esbuild drops decorator metadata).
  constructor(@Inject(AgentService) private readonly agent: AgentService) {}

  @Post()
  @ApiOperation({ summary: 'Send a message; streams tokens, tool activity, outline, done as SSE' })
  @ApiOkResponse({ description: 'text/event-stream of {type: token|tool_start|tool_end|outline|done|error}' })
  @ApiBadRequestResponse({ description: 'Missing or empty message' })
  async chat(@Body() raw: ChatRequestDto, @Res() res: Response): Promise<void> {
    // Manual validation: pipes (global and method-level) do not run on
    // @Res()-manual-mode routes, so an empty message would otherwise reach
    // the model and fail there instead of here with a 400.
    const body = Object.assign(new ChatRequestDto(), raw);
    const errors = await validate(body);
    if (errors.length > 0) {
      res.status(HttpStatus.BAD_REQUEST).json({ message: 'message must not be empty', statusCode: 400 });
      return;
    }
    const threadId = body.threadId?.trim() || randomUUID();
    res.writeHead(HttpStatus.OK, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: unknown) => {
      // Client gone: stop writing. The agent turn still completes server-side,
      // so the outline stays consistent.
      if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      for await (const ev of this.agent.stream(threadId, body.message)) {
        send(ev);
      }
    } catch (err) {
      const message = err instanceof HttpException
        ? err.message
        : err instanceof Error ? err.message : 'chat failed';
      send({ type: 'error', message });
    } finally {
      if (!res.writableEnded && !res.destroyed) res.end();
    }
  }
}
