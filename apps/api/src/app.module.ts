import { Module } from '@nestjs/common';

import { AuthController } from './interfaces/http/controllers/auth.controller';
import { FilesController } from './interfaces/http/controllers/files.controller';
import { FoldersController } from './interfaces/http/controllers/folders.controller';
import { HealthController } from './interfaces/http/health.controller';
import { ProjectsController } from './interfaces/http/controllers/projects.controller';

@Module({
  controllers: [
    HealthController,
    AuthController,
    ProjectsController,
    FoldersController,
    FilesController,
  ],
})
export class AppModule {}
