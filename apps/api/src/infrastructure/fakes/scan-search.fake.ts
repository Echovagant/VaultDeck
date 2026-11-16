import type {
  SearchHit,
  SearchIndexEntry,
  SearchPort,
  SearchQuery,
} from '../../application/ports/search.port';

export class ScanSearchFake implements SearchPort {
  private readonly entries = new Map<string, SearchIndexEntry>();

  async search(query: SearchQuery): Promise<SearchHit[]> {
    const keyword = query.keyword.toLowerCase();
    return [...this.entries.values()]
      .filter((entry) => query.projectIds.includes(entry.projectId))
      .filter((entry) => entry.fileName.toLowerCase().includes(keyword))
      .slice(0, query.limit)
      .map((entry) => ({ fileId: entry.fileId, fileName: entry.fileName, score: 1 }));
  }

  async index(entry: SearchIndexEntry): Promise<void> {
    this.entries.set(entry.fileId, entry);
  }

  async remove(fileId: string): Promise<void> {
    this.entries.delete(fileId);
  }
}
