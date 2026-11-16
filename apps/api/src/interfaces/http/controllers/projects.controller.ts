import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';

import { store } from '../../../infrastructure/store';
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
  async list(@Headers('authorization') authorization?: string) {
    const user = await requireUser(authorization);
    const visible = await store.visibleProjectIds(user);
    const projects = await store.listProjects();

    const items = [];
    for (const project of projects) {
      if (visible !== null && !visible.includes(project.projectId)) continue;
      const files = (await store.listFiles(project.projectId)).filter(
        (file) => file.status === 'active',
      );
      items.push({
        ...project,
        fileCount: files.length,
        totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      });
    }
    return { items };
  }

  @Post()
  async create(
    @Body(new StrictBodyPipe<CreateProjectBody>(createProjectSchema)) body: CreateProjectBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (user.role !== 'LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }

    const projects = await store.listProjects();
    const duplicated = projects.some(
      (project) => project.projectCode.toLowerCase() === body.projectCode.toLowerCase(),
    );
    if (duplicated) {
      throw new DomainError('VAL', 'VD-VAL-002', '项目编码已存在', { status: 409 });
    }

    const project = await store.createProject(body);
    await store.recordAudit({
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
  async listMembers(
    @Param('projectId') projectId: string,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (!(await store.canAccessProject(user, projectId))) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '项目不存在', { status: 404 });
    }

    const members = await store.listMembers(projectId);
    const items = [];
    for (const member of members) {
      const account = await store.getUser(member.userId);
      items.push({
        ...member,
        username: account?.username ?? '',
        displayName: account?.displayName ?? '',
      });
    }
    return { items };
  }

  @Post(':projectId/members')
  async addMember(
    @Param('projectId') projectId: string,
    @Body(new StrictBodyPipe<AddMemberBody>(addMemberSchema)) body: AddMemberBody,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireUser(authorization);
    if (user.role !== 'LEADER') {
      throw new DomainError('AUTH', 'VD-AUTH-404', '无权访问', { status: 404 });
    }

    const projects = await store.listProjects();
    if (!projects.some((project) => project.projectId === projectId)) {
      throw new DomainError('AUTH', 'VD-AUTH-404', '项目不存在', { status: 404 });
    }
    if (!(await store.getUser(body.userId))) {
      throw new DomainError('VAL', 'VD-VAL-002', '用户不存在', { status: 404 });
    }

    const member = await store.addMember({
      projectId,
      userId: body.userId,
      memberRole: body.memberRole,
    });
    await store.recordAudit({
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
