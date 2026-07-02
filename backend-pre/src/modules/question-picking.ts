import { ExamAttempt, Question, QuestionPractice, WrongQuestion } from '../entities';

type PickableQuestion = Pick<Question, 'id' | 'category' | 'order' | 'createdAt'>;

export interface AdaptiveQuestionState {
  attempts: Pick<ExamAttempt, 'questionIds' | 'submittedAt' | 'createdAt'>[];
  practices: Pick<QuestionPractice, 'questionId' | 'seenCount' | 'lastSeenAt'>[];
  wrongs: Pick<WrongQuestion, 'questionId' | 'wrongCount' | 'status' | 'lastWrongAt'>[];
}

interface SeenMeta {
  seenCount: number;
  lastSeenAt: Date | null;
}

const STUDY_PATTERN = [
  'new',
  'new',
  'new',
  'new',
  'new',
  'new',
  'review',
  'review',
  'review',
  'wrong',
  'new',
  'new',
  'new',
  'new',
  'new',
  'new',
  'review',
  'review',
  'wrong',
  'wrong',
] as const;

type BucketName = (typeof STUDY_PATTERN)[number];

function ts(d: Date | null | undefined): number {
  return d ? d.getTime() : 0;
}

function baseQuestionSort<T extends PickableQuestion>(a: T, b: T): number {
  return a.category.localeCompare(b.category) || a.order - b.order || ts(a.createdAt) - ts(b.createdAt) || a.id.localeCompare(b.id);
}

function buildSeenMap(state: AdaptiveQuestionState): Map<string, SeenMeta> {
  const seen = new Map<string, SeenMeta>();
  for (const p of state.practices) {
    if (p.seenCount <= 0) continue;
    seen.set(p.questionId, { seenCount: p.seenCount, lastSeenAt: p.lastSeenAt ?? null });
  }
  for (const attempt of state.attempts) {
    const at = attempt.submittedAt ?? attempt.createdAt;
    for (const questionId of attempt.questionIds ?? []) {
      const prev = seen.get(questionId);
      seen.set(questionId, {
        seenCount: (prev?.seenCount ?? 0) + 1,
        lastSeenAt: ts(prev?.lastSeenAt) > ts(at) ? prev?.lastSeenAt ?? null : at,
      });
    }
  }
  return seen;
}

function buildWrongMap(state: AdaptiveQuestionState): Map<string, Pick<WrongQuestion, 'questionId' | 'wrongCount' | 'status' | 'lastWrongAt'>> {
  const wrong = new Map<string, Pick<WrongQuestion, 'questionId' | 'wrongCount' | 'status' | 'lastWrongAt'>>();
  for (const row of state.wrongs) {
    if (row.status === 'open') wrong.set(row.questionId, row);
  }
  return wrong;
}

function pullFallback<T>(buckets: Record<BucketName, T[]>): T | undefined {
  return buckets.new.shift() ?? buckets.review.shift() ?? buckets.wrong.shift();
}

// 选题先按学习规律分桶: 新题为主, 搭配原题复习和错题; 最终是否打乱由调用方决定。
export function orderAdaptiveQuestions<T extends PickableQuestion>(
  pool: T[],
  state: AdaptiveQuestionState,
): T[] {
  const seen = buildSeenMap(state);
  const wrong = buildWrongMap(state);
  const buckets: Record<BucketName, T[]> = {
    new: [],
    review: [],
    wrong: [],
  };

  for (const question of pool) {
    if (wrong.has(question.id)) {
      buckets.wrong.push(question);
    } else if (seen.has(question.id)) {
      buckets.review.push(question);
    } else {
      buckets.new.push(question);
    }
  }

  buckets.new.sort(baseQuestionSort);
  buckets.review.sort((a, b) => {
    const am = seen.get(a.id);
    const bm = seen.get(b.id);
    return ts(am?.lastSeenAt) - ts(bm?.lastSeenAt) || (am?.seenCount ?? 0) - (bm?.seenCount ?? 0) || baseQuestionSort(a, b);
  });
  buckets.wrong.sort((a, b) => {
    const aw = wrong.get(a.id);
    const bw = wrong.get(b.id);
    return (bw?.wrongCount ?? 0) - (aw?.wrongCount ?? 0) || ts(bw?.lastWrongAt) - ts(aw?.lastWrongAt) || baseQuestionSort(a, b);
  });

  const ordered: T[] = [];
  while (buckets.new.length || buckets.review.length || buckets.wrong.length) {
    let moved = false;
    for (const bucket of STUDY_PATTERN) {
      const picked = buckets[bucket].shift() ?? pullFallback(buckets);
      if (!picked) continue;
      ordered.push(picked);
      moved = true;
    }
    if (!moved) break;
  }
  return ordered;
}

export function pickAdaptiveQuestions<T extends PickableQuestion>(
  pool: T[],
  state: AdaptiveQuestionState,
  count: number,
): T[] {
  return orderAdaptiveQuestions(pool, state).slice(0, Math.max(0, count));
}
