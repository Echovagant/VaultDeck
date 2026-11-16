export interface SearchQuery {
  keyword: string;
  projectIds: string[];
  limit: number;
}

export interface SearchHit {
  fileId: string;
  fileName: string;
  score: number;
}

export interface SearchIndexEntry {
  fileId: string;
  fileName: string;
  projectId: string;
}

export interface SearchPort {
  search(query: SearchQuery): Promise<SearchHit[]>;
  index(entry: SearchIndexEntry): Promise<void>;
  remove(fileId: string): Promise<void>;
}
