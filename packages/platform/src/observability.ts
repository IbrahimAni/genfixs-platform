export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  level: LogLevel;
  message: string;
  at: Date;
  service: string;
  organizationId?: string;
  projectId?: string;
  actorUserId?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export interface Logger {
  write(event: LogEvent): void;
}

export class ConsoleJsonLogger implements Logger {
  write(event: LogEvent): void {
    const payload = {
      ...event,
      at: event.at.toISOString(),
    };
    const line = JSON.stringify(payload);
    if (event.level === 'error') console.error(line);
    else if (event.level === 'warn') console.warn(line);
    else console.log(line);
  }
}

export interface TraceContext {
  traceId: string;
  spanId: string;
}

export interface Tracer {
  startSpan(name: string, metadata?: Record<string, unknown>): TraceContext;
  endSpan(context: TraceContext, outcome: 'ok' | 'error', metadata?: Record<string, unknown>): void;
}

export class NoopTracer implements Tracer {
  startSpan(): TraceContext {
    return { traceId: 'trace_unconfigured', spanId: 'span_unconfigured' };
  }

  endSpan(): void {}
}

export class PlatformError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
    readonly metadata: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
