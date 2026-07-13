export interface LocalExamDraft {
  answers: Record<string, string>;
  currentQuestionIndex: number;
  version: number;
}

export function selectionsToAnswers(
  questionIds: string[],
  selections: Record<string, string[]>,
): Record<string, string> {
  return Object.fromEntries(questionIds.map((questionId) => [questionId, (selections[questionId] || []).join('')]));
}

export function answersToSelections(answers: Record<string, string>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(answers).map(([questionId, answer]) => [questionId, answer.split('')]),
  );
}

export function shouldUseLocalDraft(
  local: Partial<LocalExamDraft> | null | undefined,
  serverVersion: number,
  _serverAnswers: Record<string, string> = {},
  _serverCurrentQuestionIndex = 0,
): local is LocalExamDraft {
  if (!local?.answers || !Number.isInteger(local.currentQuestionIndex)) return false;
  const localVersion = Number(local.version);
  if (localVersion > serverVersion) return true;
  return false;
}
