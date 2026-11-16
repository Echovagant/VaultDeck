import { randomUUID } from 'node:crypto';

import type {
  CreateFolderInput,
  CreateProjectInput,
  FolderRecord,
  ProjectRecord,
  ProjectStorePort,
} from '../../application/ports/project-store.port';

export class InMemoryProjectStoreFake implements ProjectStorePort {
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly folders = new Map<string, FolderRecord>();

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const project: ProjectRecord = {
      projectId: randomUUID(),
      projectCode: input.projectCode,
      projectName: input.projectName,
    };
    this.projects.set(project.projectId, project);
    return project;
  }

  async createFolder(input: CreateFolderInput): Promise<FolderRecord> {
    const folder: FolderRecord = {
      folderId: randomUUID(),
      projectId: input.projectId,
      folderName: input.folderName,
      parentId: input.parentId,
    };
    this.folders.set(folder.folderId, folder);
    return folder;
  }

  async listFolders(projectId: string): Promise<FolderRecord[]> {
    return [...this.folders.values()].filter((folder) => folder.projectId === projectId);
  }
}
