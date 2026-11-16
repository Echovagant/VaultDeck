import { Controller, Get } from '@nestjs/common';

interface HealthResponse {
  status: string;
  uptimeSeconds: number;
}

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }
}
