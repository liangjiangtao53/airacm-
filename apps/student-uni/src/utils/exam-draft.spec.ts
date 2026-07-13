import { describe, expect, it } from 'vitest';
import { answersToSelections, selectionsToAnswers, shouldUseLocalDraft } from './exam-draft';

describe('exam draft utilities', () => {
  it('round trips answer selections', () => {
    const answers = selectionsToAnswers(['q1', 'q2'], { q1: ['A'], q2: ['A', 'C'] });
    expect(answers).toEqual({ q1: 'A', q2: 'AC' });
    expect(answersToSelections(answers)).toEqual({ q1: ['A'], q2: ['A', 'C'] });
  });

  it('uses only a complete local draft newer than the server', () => {
    expect(shouldUseLocalDraft({ answers: { q1: 'A' }, currentQuestionIndex: 1, version: 3 }, 2)).toBe(true);
    expect(shouldUseLocalDraft({ answers: { q1: 'A' }, currentQuestionIndex: 1, version: 1 }, 2)).toBe(false);
  });

  it('keeps the server authoritative when versions are equal', () => {
    const local = { answers: { q1: 'B' }, currentQuestionIndex: 1, version: 2 };
    expect(shouldUseLocalDraft(local, 2, { q1: 'A' }, 1)).toBe(false);
    expect(shouldUseLocalDraft(local, 2, { q1: 'B' }, 0)).toBe(false);
    expect(shouldUseLocalDraft(local, 2, { q1: 'B' }, 1)).toBe(false);
  });
});
