import type { AuthPort, Credentials } from '../ports/auth.port';
import type { NotifyPort } from '../ports/notify.port';
import type { FolderRecord, ProjectRecord, ProjectStorePort } from '../ports/project-store.port';

export interface ProvisionInput {
  credentials: Credentials;
  projectCode: string;
  projectName: string;
  rootFolderName: string;
}

export interface ProvisionResult {
  principalUserId: string;
  project: ProjectRecord;
  folder: FolderRecord;
}

export class ProvisionProjectUseCase {
  constructor(
    private readonly auth: AuthPort,
    private readonly projects: ProjectStorePort,
    private readonly notify: NotifyPort,
  ) {}

  async execute(input: ProvisionInput): Promise<ProvisionResult> {
    const principal = await this.auth.authenticate(input.credentials);

    const project = await this.projects.createProject({
      projectCode: input.projectCode,
      projectName: input.projectName,
      createdBy: principal.userId,
    });

    const folder = await this.projects.createFolder({
      projectId: project.projectId,
      folderName: input.rootFolderName,
      parentId: null,
      createdBy: principal.userId,
    });

    await this.notify.publish({
      level: 'info',
      title: '项目已创建',
      message: `${project.projectName} / ${folder.folderName}`,
      occurredAt: new Date().toISOString(),
    });

    return { principalUserId: principal.userId, project, folder };
  }
}
