import { describe, expect, it } from 'vitest';
import { answersToSelections, selectionsToAnswers, shouldUseLocalDraft } from './exam-draft';

describe('exam draft utilities', () => {
  it('round trips answer selections', () => {
    const answers = selectionsToAnswers(['q1', 'q2'], { q1: ['A'], q2: ['A', 'C'] });
    expect(answers).toEqual({ q1: 'A', q2: 'AC' });
    expect(answersToSelections(answers)).toEqual({ q1: ['A'], q2: ['A', 'C'] });
  });

  it('uses only unsaved local changes based on the current server version', () => {
    expect(
      shouldUseLocalDraft(
        { answers: { q1: 'A' }, currentQuestionIndex: 1, baseServerVersion: 2, localRevision: 1 },
        2,
      ),
    ).toBe(true);
    expect(
      shouldUseLocalDraft(
        { answers: { q1: 'A' }, currentQuestionIndex: 1, baseServerVersion: 1, localRevision: 5 },
        2,
      ),
    ).toBe(false);
  });

  it('keeps the server authoritative after local changes have been synchronized', () => {
    const local = {
      answers: { q1: 'B' },
      currentQuestionIndex: 1,
      baseServerVersion: 2,
      localRevision: 0,
    };
    expect(shouldUseLocalDraft(local, 2, { q1: 'A' }, 1)).toBe(false);
    expect(shouldUseLocalDraft(local, 2, { q1: 'B' }, 0)).toBe(false);
    expect(shouldUseLocalDraft(local, 2, { q1: 'B' }, 1)).toBe(false);
  });
});
