import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Question, QuestionCategoryGeneration, QuestionUsage } from '../entities';

export type PublicQuestion = Pick<
  Question,
  | 'id'
  | 'tenantId'
  | 'category'
  | 'generation'
  | 'chapterName'
  | 'chapterOrder'
  | 'chapterQuestionOrder'
  | 'courseId'
  | 'type'
  | 'stem'
  | 'stemImageUrls'
  | 'options'
  | 'imageUrls'
  | 'usage'
  | 'order'
  | 'createdAt'
>;

interface QuestionPoolFilter {
  usage?: QuestionUsage;
  category?: string;
  chapter?: string;
  courseId?: string;
  reloadIfEmpty?: boolean;
}

@Injectable()
export class QuestionPoolCacheService implements OnModuleInit {
  private readonly pools = new Map<string, PublicQuestion[]>();
  private readonly inFlight = new Map<string, Promise<PublicQuestion[]>>();

  constructor(
    @InjectRepository(Question) private readonly questions: Repository<Question>,
    @InjectRepository(QuestionCategoryGeneration)
    private readonly generations: Repository<QuestionCategoryGeneration>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.warmAllTenants();
  }

  async refreshTenant(tenantId: string): Promise<void> {
    for (const key of this.pools.keys()) {
      if (key.startsWith(`${tenantId}|`)) this.pools.delete(key);
    }
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(`${tenantId}|`)) this.inFlight.delete(key);
    }
  }

  async getQuestions(tenantId: string, filter: QuestionPoolFilter = {}): Promise<PublicQuestion[]> {
    const cacheKey = await this.cacheKey(tenantId, filter.category);
    let pool = await this.getPool(cacheKey, tenantId, filter.category);
    let rows = this.filter(pool, filter);
    if (rows.length === 0 && filter.reloadIfEmpty) {
      await this.refreshTenant(tenantId);
      const refreshedKey = await this.cacheKey(tenantId, filter.category);
      pool = await this.getPool(refreshedKey, tenantId, filter.category);
      rows = this.filter(pool, filter);
    }
    return rows;
  }

  private async warmAllTenants(): Promise<void> {
    const rows = await this.questions
      .createQueryBuilder('q')
      .select('q.tenantId', 'tenantId')
      .distinct(true)
      .getRawMany<{ tenantId: string }>();
    await Promise.all(rows.map((row) => this.getQuestions(row.tenantId)));
  }

  private async cacheKey(tenantId: string, category?: string): Promise<string> {
    if (category !== undefined) {
      const row = await this.generations.findOne({ where: { tenantId, category }, select: ['generation'] });
      return `${tenantId}|${category}|${row?.generation ?? 1}`;
    }
    const rows = await this.generations.find({ where: { tenantId }, select: ['category', 'generation'] });
    const vector = rows
      .sort((a, b) => a.category.localeCompare(b.category))
      .map((row) => `${row.category}:${row.generation}`)
      .join(',');
    return `${tenantId}|*|${vector || '1'}`;
  }

  private async getPool(cacheKey: string, tenantId: string, category?: string): Promise<PublicQuestion[]> {
    const cached = this.pools.get(cacheKey);
    if (cached) return cached;
    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;
    const promise = this.loadCurrent(tenantId, category)
      .then((rows) => {
        this.pools.set(cacheKey, rows);
        this.evictOldGenerations(tenantId);
        return rows;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });
    this.inFlight.set(cacheKey, promise);
    return promise;
  }

  private async loadCurrent(tenantId: string, category?: string): Promise<PublicQuestion[]> {
    const generationRows = await this.generations.find({ where: { tenantId }, select: ['category', 'generation'] });
    const current = new Map(generationRows.map((row) => [row.category, row.generation]));
    const rows = await this.questions.find({
      where: category === undefined ? { tenantId } : { tenantId, category },
      select: [
        'id',
        'tenantId',
        'category',
        'generation',
        'chapterName',
        'chapterOrder',
        'chapterQuestionOrder',
        'courseId',
        'type',
        'stem',
        'stemImageUrls',
        'options',
        'imageUrls',
        'usage',
        'order',
        'createdAt',
      ],
      order: { chapterOrder: 'ASC', chapterQuestionOrder: 'ASC', order: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
    return rows.filter((row) => row.generation === (current.get(row.category) ?? 1));
  }

  private evictOldGenerations(tenantId: string): void {
    const keys = [...this.pools.keys()].filter((key) => key.startsWith(`${tenantId}|`));
    while (keys.length > 12) {
      const key = keys.shift();
      if (key) this.pools.delete(key);
    }
  }

  private filter(pool: PublicQuestion[], filter: QuestionPoolFilter): PublicQuestion[] {
    return pool.filter((q) => {
      if (filter.usage && !this.matchesUsage(q.usage, filter.usage)) return false;
      if (filter.category !== undefined && q.category !== filter.category) return false;
      if (filter.chapter !== undefined && q.chapterName !== filter.chapter) return false;
      if (filter.courseId !== undefined && q.courseId !== filter.courseId) return false;
      return true;
    });
  }

  private matchesUsage(actual: QuestionUsage, expected: QuestionUsage): boolean {
    if (expected === 'both') return actual === 'both';
    return actual === expected || actual === 'both';
  }
}

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Question, QuestionCategoryGeneration])],
  providers: [QuestionPoolCacheService],
  exports: [QuestionPoolCacheService],
})
export class QuestionPoolCacheModule {}
