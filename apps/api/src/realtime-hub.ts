import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

/** Thin holder so domain services can emit without depending on the gateway lifecycle. */
@Injectable()
export class RealtimeHub {
  server: Server | null = null;
  emit(room: string | string[], event: string, payload: unknown) {
    this.server?.to(room).emit(event, payload);
  }
}
