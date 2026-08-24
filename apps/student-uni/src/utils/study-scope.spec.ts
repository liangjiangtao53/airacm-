import { describe, expect, it } from 'vitest';
import { buildStudyScope, resolveStudyChapter, shouldReloadStudyScope } from './study-scope';

describe('chapter study scope', () => {
  it('isolates two chapters in the same category', () => {
    expect(buildStudyScope('M1 航空概论', '第1章')).not.toBe(buildStudyScope('M1 航空概论', '第2章'));
  });

  it('keeps the same chapter when returning from the exam tab', () => {
    const loaded = buildStudyScope('M1 航空概论', '第1章');
    expect(shouldReloadStudyScope(loaded, 'M1 航空概论', '第1章')).toBe(false);
    expect(shouldReloadStudyScope(loaded, 'M1 航空概论', '第2章')).toBe(true);
  });

  it('restores a valid requested chapter and safely falls back to the first', () => {
    const rows = [{ name: '第1章' }, { name: '第2章' }];
    expect(resolveStudyChapter(rows, '第2章')?.name).toBe('第2章');
    expect(resolveStudyChapter(rows, '失效章节')?.name).toBe('第1章');
    expect(resolveStudyChapter([], '第1章')).toBeNull();
  });
});
