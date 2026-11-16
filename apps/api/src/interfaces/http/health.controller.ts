import { Controller, Get } from '@nestjs/common';

interface HealthResponse {
  status: string;
  uptimeSeconds: number;
}

@Controller('system/health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }
}
