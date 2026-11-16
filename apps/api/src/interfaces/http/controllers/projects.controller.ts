import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';

import { memoryStore } from '../../../infrastructure/memory/memory-store';
import { DomainError } from '../errors/problem-details';
import { StrictBodyPipe } from '../validation/strict-body.pipe';
import { requireUser } from './auth.controller';

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

interface AddMemberBody {
  userId: string;
  memberRole: 'DEPUTY_LEADER' | 'MEMBER';
}

const addMemberSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['userId', 'memberRole'],
  properties: {
    userId: { type: 'string', format: 'uuid' },
    memberRole: { type: 'string', enum: ['DEPUTY_LEADER', 'MEMBER'] },
  },
};

@Controller('projects')
export class ProjectsController {
  @Get()
  list(@Headers('authorization') authorization?: string) {
    const user = requireUser(authorization);
    const visible = memoryStore.visibleProjectIds(user);
    const items = [...memoryStore.projects.values()]
      .filter((project) => (visible === null ? true : visible.includes(project.projectId)))
      .map((project) => {
        const files = [...memoryStore.files.values()].filter(
          (file) => file.projectId === project.projectId && file.status === 'active',
        );
        return {
          ...project,
          fileCount: files.length,
          totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
        };
      });
    return { items };
  }

  @Post()
  create(
    @Body(new StrictBodyPipe<CreateProjectBody>(createProjectSchema)) body: CreateProjectBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = requireUser(authorization);
    if (user.role !== 'LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }
    const duplicated = [...memoryStore.projects.values()].some(
      (project) => project.projectCode.toLowerCase() === body.projectCode.toLowerCase(),
    );
    if (duplicated) {
      throw new DomainError('VAL', 'VD-VAL-002', '项目编码已存在', { status: 409 });
    }
    const project = memoryStore.createProject(body);
    memoryStore.recordAudit({
      actor: user,
      action: 'project.create',
      objectType: 'project',
      objectId: project.projectId,
      result: 'success',
      detail: project.projectName,
    });
    return project;
  }

  @Get(':projectId/members')
  listMembers(
    @Param('projectId') projectId: string,
    @Headers('authorization') authorization?: string,
  ) {
    const user = requireUser(authorization);
    if (!memoryStore.canAccessProject(user, projectId)) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '项目不存在', { status: 404 });
    }
    const items = [...memoryStore.members.values()]
      .filter((member) => member.projectId === projectId)
      .map((member) => ({
        ...member,
        username: memoryStore.users.get(member.userId)?.username ?? '',
        displayName: memoryStore.users.get(member.userId)?.displayName ?? '',
      }));
    return { items };
  }

  @Post(':projectId/members')
  addMember(
    @Param('projectId') projectId: string,
    @Body(new StrictBodyPipe<AddMemberBody>(addMemberSchema)) body: AddMemberBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = requireUser(authorization);
    if (user.role !== 'LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }
    if (!memoryStore.projects.has(projectId)) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '项目不存在', { status: 404 });
    }
    if (!memoryStore.users.has(body.userId)) {
      throw new DomainError('VAL', 'VD-VAL-002', '用户不存在', { status: 404 });
    }
    const member = memoryStore.addMember({
      projectId,
      userId: body.userId,
      memberRole: body.memberRole,
    });
    memoryStore.recordAudit({
      actor: user,
      action: 'project.member_add',
      objectType: 'project',
      objectId: projectId,
      result: 'success',
      detail: body.userId,
    });
    return member;
  }
}
