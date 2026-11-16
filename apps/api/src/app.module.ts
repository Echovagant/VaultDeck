import { Module } from '@nestjs/common';

import { AuthController } from './interfaces/http/controllers/auth.controller';
import { AuditController } from './interfaces/http/controllers/audit.controller';
import { FilesController } from './interfaces/http/controllers/files.controller';
import { FoldersController } from './interfaces/http/controllers/folders.controller';
import { HealthController } from './interfaces/http/health.controller';
import { ProjectsController } from './interfaces/http/controllers/projects.controller';
import { TrashController } from './interfaces/http/controllers/trash.controller';
import { UploadController } from './interfaces/http/controllers/upload.controller';

@Module({
  controllers: [
    HealthController,
    AuthController,
    ProjectsController,
    FoldersController,
    FilesController,
    UploadController,
    TrashController,
    AuditController,
  ],
})
export class AppModule {}
