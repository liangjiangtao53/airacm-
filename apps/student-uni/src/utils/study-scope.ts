export function buildStudyScope(category: string, chapter: string): string {
  return `${category}\u0000${chapter}`;
}

export function shouldReloadStudyScope(loadedScope: string, category: string, chapter: string): boolean {
  return loadedScope !== buildStudyScope(category, chapter);
}

export function resolveStudyChapter<T extends { name: string }>(rows: T[], requested?: string): T | null {
  if (!rows.length) return null;
  return rows.find((row) => row.name === requested) ?? rows[0];
}
