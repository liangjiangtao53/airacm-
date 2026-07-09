import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Question, QuestionUsage } from '../entities';

export type PublicQuestion = Pick<
  Question,
  | 'id'
  | 'tenantId'
  | 'category'
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
  courseId?: string;
  reloadIfEmpty?: boolean;
}

@Injectable()
export class QuestionPoolCacheService implements OnModuleInit {
  private readonly pools = new Map<string, PublicQuestion[]>();
  private readonly inFlight = new Map<string, Promise<PublicQuestion[]>>();

  constructor(@InjectRepository(Question) private readonly questions: Repository<Question>) {}

  async onModuleInit(): Promise<void> {
    await this.warmAllTenants();
  }

  async refreshTenant(tenantId: string): Promise<void> {
    this.pools.set(tenantId, await this.loadTenant(tenantId));
  }

  async getQuestions(tenantId: string, filter: QuestionPoolFilter = {}): Promise<PublicQuestion[]> {
    let pool = await this.getTenantPool(tenantId);
    let rows = this.filter(pool, filter);
    if (rows.length === 0 && filter.reloadIfEmpty) {
      await this.refreshTenant(tenantId);
      pool = await this.getTenantPool(tenantId);
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
    await Promise.all(rows.map((row) => this.refreshTenant(row.tenantId)));
  }

  private async getTenantPool(tenantId: string): Promise<PublicQuestion[]> {
    const cached = this.pools.get(tenantId);
    if (cached) return cached;
    const existing = this.inFlight.get(tenantId);
    if (existing) return existing;
    const promise = this.loadTenant(tenantId)
      .then((rows) => {
        this.pools.set(tenantId, rows);
        return rows;
      })
      .finally(() => {
        this.inFlight.delete(tenantId);
      });
    this.inFlight.set(tenantId, promise);
    return promise;
  }

  private async loadTenant(tenantId: string): Promise<PublicQuestion[]> {
    return this.questions.find({
      where: { tenantId },
      select: [
        'id',
        'tenantId',
        'category',
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
      order: { order: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
  }

  private filter(pool: PublicQuestion[], filter: QuestionPoolFilter): PublicQuestion[] {
    return pool.filter((q) => {
      if (filter.usage && !this.matchesUsage(q.usage, filter.usage)) return false;
      if (filter.category !== undefined && q.category !== filter.category) return false;
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
  imports: [TypeOrmModule.forFeature([Question])],
  providers: [QuestionPoolCacheService],
  exports: [QuestionPoolCacheService],
})
export class QuestionPoolCacheModule {}
