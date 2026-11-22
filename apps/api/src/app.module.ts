import { Module } from '@nestjs/common';

import { AuthController } from './interfaces/http/controllers/auth.controller';
import { AgentController } from './interfaces/http/controllers/agent.controller';
import { AiController } from './interfaces/http/controllers/ai.controller';
import { AuditController } from './interfaces/http/controllers/audit.controller';
import { BundlesController } from './interfaces/http/controllers/bundles.controller';
import { CategoriesController } from './interfaces/http/controllers/categories.controller';
import { FilesController } from './interfaces/http/controllers/files.controller';
import { FoldersController } from './interfaces/http/controllers/folders.controller';
import { HealthController } from './interfaces/http/health.controller';
import { ProjectsController } from './interfaces/http/controllers/projects.controller';
import { SearchController } from './interfaces/http/controllers/search.controller';
import { StatsController } from './interfaces/http/controllers/stats.controller';
import { ShareController } from './interfaces/http/controllers/share.controller';
import { TrashController } from './interfaces/http/controllers/trash.controller';
import { UploadController } from './interfaces/http/controllers/upload.controller';
import { UsersController } from './interfaces/http/controllers/users.controller';
import { SystemSettingsController } from './interfaces/http/controllers/settings.controller';
import { SystemIntegrityController } from './interfaces/http/controllers/system-integrity.controller';

@Module({
  controllers: [
    HealthController,
    AuthController,
    AiController,
    ProjectsController,
    FoldersController,
    FilesController,
    UploadController,
    TrashController,
    AuditController,
    SearchController,
    BundlesController,
    StatsController,
    UsersController,
    CategoriesController,
    SystemSettingsController,
    SystemIntegrityController,
    ShareController,
    AgentController,
  ],
})
export class AppModule {}
