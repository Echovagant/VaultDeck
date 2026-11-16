export interface ProjectRecord {
  projectId: string;
  projectCode: string;
  projectName: string;
}

export interface FolderRecord {
  folderId: string;
  projectId: string;
  folderName: string;
  parentId: string | null;
}

export interface CreateProjectInput {
  projectCode: string;
  projectName: string;
  createdBy: string;
}

export interface CreateFolderInput {
  projectId: string;
  folderName: string;
  parentId: string | null;
  createdBy: string;
}

export interface ProjectStorePort {
  createProject(input: CreateProjectInput): Promise<ProjectRecord>;
  createFolder(input: CreateFolderInput): Promise<FolderRecord>;
  listFolders(projectId: string): Promise<FolderRecord[]>;
}
