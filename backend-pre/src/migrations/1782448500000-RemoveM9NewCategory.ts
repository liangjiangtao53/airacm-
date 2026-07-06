import { MigrationInterface, QueryRunner } from 'typeorm';

const OBSOLETE_CATEGORY = 'M9 new';

export class RemoveM9NewCategory1782448500000 implements MigrationInterface {
  name = 'RemoveM9NewCategory1782448500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.removeExamRuleCategoryCount(queryRunner);
    await this.removeEmptyQuestionCategory(queryRunner);
  }

  async down(): Promise<void> {
    // Intentionally empty: this migration removes an obsolete category label.
  }

  private async removeExamRuleCategoryCount(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('exam_paper_rule'))) return;
    if (!(await queryRunner.hasColumn('exam_paper_rule', 'categoryCounts'))) return;

    const idColumn = queryRunner.connection.driver.escape('id');
    const countsColumn = queryRunner.connection.driver.escape('categoryCounts');
    const rows = await queryRunner.query(
      `SELECT ${idColumn} AS id, ${countsColumn} AS categoryCounts FROM exam_paper_rule WHERE ${countsColumn} IS NOT NULL`,
    );
    if (!Array.isArray(rows)) return;

    for (const row of rows as Array<{ id: string; categoryCounts: unknown }>) {
      const parsed = this.parseCategoryCounts(row.categoryCounts);
      if (!parsed || !(OBSOLETE_CATEGORY in parsed)) continue;
      delete parsed[OBSOLETE_CATEGORY];
      await queryRunner.query(`UPDATE exam_paper_rule SET ${countsColumn} = ? WHERE ${idColumn} = ?`, [JSON.stringify(parsed), row.id]);
    }
  }

  private async removeEmptyQuestionCategory(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question_category'))) return;
    if (!(await queryRunner.hasTable('question'))) return;

    const tenantColumn = queryRunner.connection.driver.escape('tenantId');
    const nameColumn = queryRunner.connection.driver.escape('name');
    const categoryColumn = queryRunner.connection.driver.escape('category');
    await queryRunner.query(
      `DELETE FROM question_category
       WHERE ${nameColumn} = ?
       AND NOT EXISTS (
         SELECT 1 FROM question
         WHERE question.${tenantColumn} = question_category.${tenantColumn}
         AND question.${categoryColumn} = question_category.${nameColumn}
       )`,
      [OBSOLETE_CATEGORY],
    );
  }

  private parseCategoryCounts(raw: unknown): Record<string, number> | null {
    if (!raw) return null;
    if (typeof raw === 'object') return raw as Record<string, number>;
    if (typeof raw !== 'string') return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : null;
    } catch {
      return null;
    }
  }
}
