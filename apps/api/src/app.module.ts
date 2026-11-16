import { Module } from '@nestjs/common';

import { AuthController } from './interfaces/http/controllers/auth.controller';
import { AuditController } from './interfaces/http/controllers/audit.controller';
import { BundlesController } from './interfaces/http/controllers/bundles.controller';
import { CategoriesController } from './interfaces/http/controllers/categories.controller';
import { FilesController } from './interfaces/http/controllers/files.controller';
import { FoldersController } from './interfaces/http/controllers/folders.controller';
import { HealthController } from './interfaces/http/health.controller';
import { ProjectsController } from './interfaces/http/controllers/projects.controller';
import { SearchController } from './interfaces/http/controllers/search.controller';
import { StatsController } from './interfaces/http/controllers/stats.controller';
import { TrashController } from './interfaces/http/controllers/trash.controller';
import { UploadController } from './interfaces/http/controllers/upload.controller';
import { UsersController } from './interfaces/http/controllers/users.controller';
import { SystemSettingsController } from './interfaces/http/controllers/settings.controller';

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
    SearchController,
    BundlesController,
    StatsController,
    UsersController,
    CategoriesController,
    SystemSettingsController,
  ],
})
export class AppModule {}
