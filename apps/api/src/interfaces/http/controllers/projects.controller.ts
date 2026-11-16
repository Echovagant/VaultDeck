import { Body, Controller, Get, Headers, Post } from '@nestjs/common';

import { memoryStore } from '../../../infrastructure/memory/memory-store';
import { DomainError } from '../errors/problem-details';
import { requireUser } from './auth.controller';
import { StrictBodyPipe } from '../validation/strict-body.pipe';

interface CreateProjectBody {
  projectCode: string;
  projectName: string;
}

const createProjectSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['projectCode', 'projectName'],
  properties: {
    projectCode: { type: 'string', minLength: 1, maxLength: 32 },
    projectName: { type: 'string', minLength: 1, maxLength: 128 },
  },
};

@Controller('projects')
export class ProjectsController {
  @Get()
  list(@Headers('authorization') authorization?: string) {
    requireUser(authorization);
    const items = [...memoryStore.projects.values()].map((project) => ({
      ...project,
      fileCount: [...memoryStore.files.values()].filter(
        (file) => file.projectId === project.projectId,
      ).length,
      totalBytes: [...memoryStore.files.values()]
        .filter((file) => file.projectId === project.projectId)
        .reduce((sum, file) => sum + file.sizeBytes, 0),
    }));
    return { items };
  }

  @Post()
  create(
    @Body(new StrictBodyPipe<CreateProjectBody>(createProjectSchema)) body: CreateProjectBody,
    @Headers('authorization') authorization?: string,
  ) {
    requireUser(authorization);
    const duplicated = [...memoryStore.projects.values()].some(
      (project) => project.projectCode.toLowerCase() === body.projectCode.toLowerCase(),
    );
    if (duplicated) {
      throw new DomainError('VAL', 'VD-VAL-002', '项目编码已存在', { status: 409 });
    }
    return memoryStore.createProject(body);
  }
}
