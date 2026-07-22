import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  VersionColumn,
} from 'typeorm';

// 约定:所有金额字段以「分」(integer)存储,避免浮点误差;前端展示再除 100。
// 所有业务表带 tenant_id(行级多租户,D4),复合索引 (tenant_id, user_id)。

// Timestamp column type is driver-specific: Postgres uses timestamptz, MySQL/SQLite use datetime.
// CreateDateColumn/UpdateDateColumn 由 TypeORM 自动按驱动选型,无需处理。
const DB_TYPE = process.env.DB_TYPE ?? (process.env.NODE_ENV === 'production' ? 'mysql' : 'better-sqlite3');
const TS_TYPE: 'timestamptz' | 'datetime' =
  DB_TYPE === 'postgres'
    ? 'timestamptz'
    : 'datetime';
const LARGE_JSON_TYPE: 'longtext' | 'text' =
  process.env.NODE_ENV !== 'test' && (DB_TYPE === 'mysql' || DB_TYPE === 'mariadb') ? 'longtext' : 'text';
const LARGE_JSON_TRANSFORMER = {
  to: (value: unknown): string | null => value == null ? null : JSON.stringify(value),
  from: (value: unknown): unknown => {
    if (value == null || typeof value !== 'string') return value;
    return JSON.parse(value);
  },
};

export type LessonAccess = 'free' | 'paid' | 'vip' | 'password';
export type LessonType = 'video' | 'text';
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'cancelled';
export type PayChannel = 'wallet' | 'wechat';
export type WalletTxnType = 'recharge' | 'consume';
export type RechargeCodeStatus = 'unused' | 'used';
export type ProgressStatus = 'not_started' | 'in_progress' | 'done';
export type QuestionType = 'single' | 'multiple';
// 题目用途:仅学习刷题 / 仅考试 / 两者都进。Excel 导入时整批指定。
export type QuestionUsage = 'study' | 'exam' | 'both';
export type WrongQuestionSource = 'study' | 'exam';
export type RegistrationSource = 'key' | 'register' | 'wechat';
export type QuestionImportStatus = 'completed' | 'failed';
export type UserActivityAction =
  | 'login_password'
  | 'login_access_key'
  | 'login_wechat'
  | 'study_answer'
  | 'study_progress'
  | 'lesson_start'
  | 'lesson_complete'
  | 'wrong_question_master'
  | 'wallet_recharge_code'
  | 'exam_start'
  | 'exam_submit'
  | 'exam_delete';

@Entity('exam_paper_rule')
@Index(['tenantId'], { unique: true })
export class ExamPaperRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column({ type: 'integer', default: 100 })
  totalCount!: number;

  @Column({ type: 'simple-json', nullable: true })
  categoryCounts!: Record<string, number> | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

export interface QuestionOption {
  key: string; // A / B / C / D
  text: string;
}

export interface ExamQuestionSnapshot {
  id: string;
  category: string;
  type: 'single' | 'multiple';
  stem: string;
  options: QuestionOption[];
  stemImageUrls: string[];
  imageUrls: string[];
  answer: string;
  analysis: string;
}

// 题目科目分类(机务执照模块 M1-M9 + 无人机)。导入时按科目归档。
export const QUESTION_CATEGORIES = [
  'M1 航空概论',
  'M2 航空器维修',
  'M3 飞机结构和系统',
  'M4 直升机结构和系统',
  'M5 航空涡轮发动机',
  'M6 航空活塞发动机',
  'M9 航空英语',
  '无人机',
] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

@Entity('question_category')
@Index(['tenantId', 'name'], { unique: true })
export class QuestionCategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  name!: string;

  @Column({ type: 'integer', default: 0 })
  order!: number;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('question_import_batch')
@Index(['tenantId', 'createdAt'])
export class QuestionImportBatch {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 64 })
  tenantId!: string;

  @Column({ length: 64 })
  importedBy!: string;

  @Column({ default: '' })
  fileName!: string;

  @Column({ length: 64, default: '' })
  fileHash!: string;

  @Column({ type: 'varchar', default: 'both' })
  usage!: QuestionUsage;

  @Column({ default: '' })
  category!: string;

  @Column({ type: 'varchar', nullable: true })
  courseId!: string | null;

  @Column({ type: 'integer', default: 0 })
  totalRows!: number;

  @Column({ type: 'integer', default: 0 })
  imported!: number;

  @Column({ type: 'integer', default: 0 })
  failed!: number;

  @Column({ type: 'simple-json', nullable: true })
  failures!: Array<{ row: number; reason: string }> | null;

  @Column({ type: 'varchar', default: 'completed' })
  status!: QuestionImportStatus;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('admin_operation_log')
@Index(['tenantId', 'createdAt'])
@Index(['tenantId', 'action'])
export class AdminOperationLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 64 })
  tenantId!: string;

  @Column({ length: 64 })
  adminId!: string;

  @Column({ length: 64 })
  action!: string;

  @Column({ length: 64 })
  targetType!: string;

  @Column({ type: 'varchar', nullable: true })
  targetId!: string | null;

  @Column({ type: 'simple-json', nullable: true })
  detail!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('tenant')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ default: 'active' })
  status!: string;
}

@Entity('user')
@Index(['tenantId', 'phone'], { unique: true })
@Index('UQ_user_tenant_nickname', ['tenantId', 'nickname'], { unique: true })
@Index('UQ_user_tenant_wechat_openid', ['tenantId', 'wechatOpenid'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  phone!: string;

  @Column({ default: '' })
  nickname!: string;

  @Column({ type: 'varchar', nullable: true })
  openid!: string | null;

  // 旧 openid 同时存过 key:* 来源标记，先保留；新微信身份只读写本字段。
  @Column({ type: 'varchar', length: 128, nullable: true })
  wechatOpenid!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'register' })
  registrationSource!: RegistrationSource;

  @Column({ default: '' })
  passwordHash!: string;

  // 角色:user(学员)/ admin(业务管理员)/ super(超级管理员)。管理接口走 RolesGuard 校验。
  @Column({ type: 'varchar', default: 'user' })
  role!: 'user' | 'admin' | 'super';

  // 单点登录:当前有效会话 id。每次登录刷新,JWT 带 sid,守卫比对不一致即踢。仅 role=user 校验。
  @Column({ type: 'varchar', nullable: true })
  sessionId!: string | null;

  @Column({ type: TS_TYPE, nullable: true })
  firstLoginAt!: Date | null;

  @Column({ type: TS_TYPE, nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('wechat_bind_session')
@Index('UQ_wechat_bind_session_token_hash', ['tokenHash'], { unique: true })
@Index('IDX_wechat_bind_session_expiry', ['expiresAt'])
export class WechatBindSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 64 })
  tenantId!: string;

  @Column({ length: 64 })
  tokenHash!: string;

  @Column({ length: 128 })
  wechatOpenid!: string;

  @Column({ type: TS_TYPE })
  expiresAt!: Date;

  @Column({ type: TS_TYPE, nullable: true })
  consumedAt!: Date | null;

  @Column({ type: 'integer', default: 0 })
  failedAttempts!: number;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('wallet')
@Index(['tenantId', 'userId'], { unique: true })
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  userId!: string;

  // 余额(分)。扣减走原子 UPDATE,见 wallet 模块 D2。
  @Column({ type: 'integer', default: 0 })
  balance!: number;

  @VersionColumn()
  version!: number;
}

@Entity('wallet_txn')
@Index(['tenantId', 'walletId'])
// 幂等键:同租户同类型同业务引用只入一笔。微信回调重发(同 transactionId 作 refId)靠它去重。
@Index(['tenantId', 'type', 'refId'], { unique: true })
export class WalletTxn {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  walletId!: string;

  @Column({ type: 'varchar' })
  type!: WalletTxnType;

  // 正数;recharge 入账,consume 出账。
  @Column({ type: 'integer' })
  amount!: number;

  // 关联业务:充值码 id / 订单 id / 微信流水号。
  @Column({ type: 'varchar', nullable: true })
  refId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('recharge_code')
@Index(['tenantId', 'code'], { unique: true })
export class RechargeCode {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  code!: string;

  @Column({ type: 'integer' })
  amount!: number;

  @Column({ type: 'varchar', default: 'unused' })
  status!: RechargeCodeStatus;

  @Column({ type: 'varchar', nullable: true })
  usedBy!: string | null;

  @Column({ type: TS_TYPE, nullable: true })
  usedAt!: Date | null;
}

@Entity('course')
@Index(['tenantId'])
export class Course {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  title!: string;

  @Column({ default: '' })
  summary!: string;

  @Column({ type: 'integer', default: 0 })
  price!: number;

  @Column({ type: 'integer', default: 0 })
  originalPrice!: number;

  @Column({ type: 'integer', default: 0 })
  chapterCount!: number;

  @Column({ type: 'integer', default: 0 })
  lessonCount!: number;
}

@Entity('chapter')
@Index(['tenantId', 'courseId'])
export class Chapter {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  courseId!: string;

  @Column()
  title!: string;

  @Column({ type: 'integer', default: 0 })
  order!: number;
}

@Entity('lesson')
@Index(['tenantId', 'courseId'])
export class Lesson {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  chapterId!: string;

  @Column()
  courseId!: string;

  @Column()
  title!: string;

  @Column({ type: 'varchar', default: 'video' })
  type!: LessonType;

  @Column({ type: 'varchar', default: 'paid' })
  access!: LessonAccess;

  @Column({ type: 'integer', default: 0 })
  order!: number;

  // 时长(秒)
  @Column({ type: 'integer', default: 0 })
  duration!: number;
}

@Entity('order')
@Index(['tenantId', 'userId'])
@Index(['transactionId'], { unique: true })
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  userId!: string;

  @Column()
  courseId!: string;

  @Column({ type: 'integer' })
  amount!: number;

  @Column({ type: 'varchar', default: 'pending' })
  status!: OrderStatus;

  @Column({ type: 'varchar', default: 'wallet' })
  payChannel!: PayChannel;

  // 微信支付流水号:幂等键,同号重复回调只入账一次(D5)。
  @Column({ type: 'varchar', nullable: true })
  transactionId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: TS_TYPE, nullable: true })
  paidAt!: Date | null;
}

// 充值预单:微信在线充值的对账锚点。prepay 落 pending,回调按 outTradeNo 比对金额后置 paid。
@Entity('recharge_order')
@Index(['tenantId', 'userId'])
@Index(['outTradeNo'], { unique: true })
@Index(['transactionId'], { unique: true })
export class RechargeOrder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  userId!: string;

  @Column()
  outTradeNo!: string;

  @Column({ type: 'integer' })
  amount!: number;

  @Column({ type: 'varchar', default: 'pending' })
  status!: 'pending' | 'paid' | 'cancelled';

  @Column({ type: 'varchar', nullable: true })
  transactionId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: TS_TYPE, nullable: true })
  paidAt!: Date | null;
}

@Entity('entitlement')
@Index(['tenantId', 'userId', 'courseId'], { unique: true })
export class Entitlement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  userId!: string;

  @Column()
  courseId!: string;

  @Column({ type: 'varchar', nullable: true })
  orderId!: string | null;

  @CreateDateColumn()
  startsAt!: Date;

  @Column({ type: TS_TYPE, nullable: true })
  expiresAt!: Date | null;
}

@Entity('progress')
@Index(['tenantId', 'userId', 'lessonId'], { unique: true })
export class Progress {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  userId!: string;

  @Column()
  lessonId!: string;

  @Column({ type: 'varchar', default: 'in_progress' })
  status!: ProgressStatus;

  // 播放进度(秒)
  @Column({ type: 'integer', default: 0 })
  position!: number;

  @UpdateDateColumn()
  updatedAt!: Date;
}

// 题库:学习刷题 / 考试组卷共用。usage 区分用途,courseId 可空(独立题库)。
@Entity('question')
@Index(['tenantId', 'usage'])
@Index(['tenantId', 'usage', 'order'])
@Index('IDX_question_tenant_order', ['tenantId', 'order'])
@Index(['tenantId', 'courseId'])
@Index('IDX_question_tenant_course_order', ['tenantId', 'courseId', 'order'])
@Index(['tenantId', 'category'])
@Index('IDX_question_tenant_category_order', ['tenantId', 'category', 'order'])
export class Question {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  // 科目分类(QUESTION_CATEGORIES 之一)。空串表示未分类。
  @Column({ default: '' })
  category!: string;

  // 可挂课程,也可建独立题库(null)。
  @Column({ type: 'varchar', nullable: true })
  courseId!: string | null;

  @Column({ type: 'varchar', default: 'single' })
  type!: QuestionType;

  @Column({ type: 'text' })
  stem!: string; // 题干

  @Column({ type: 'simple-json', nullable: true })
  stemImageUrls!: string[] | null;

  // 选项数组 [{key,text}]。simple-json 在 postgres/sqlite 双驱动均可用。
  @Column({ type: 'simple-json' })
  options!: QuestionOption[];

  // 正确答案:单选 'A',多选按字母序拼接 'AC'。
  @Column()
  answer!: string;

  @Column({ type: 'text' })
  analysis!: string; // 解析/答案说明

  // 题目配图 URL。Excel/WPS 单元格图片导入后写入,学习/考试/错题复盘共用。
  @Column({ type: 'simple-json', nullable: true })
  imageUrls!: string[] | null;

  @Column({ type: 'varchar', default: 'study' })
  usage!: QuestionUsage;

  @Column({ type: 'integer', default: 0 })
  order!: number;

  @Column({ type: 'varchar', nullable: true })
  importBatchId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}

// 考试作答记录:一次组卷 + 作答 + 判分。questionIds 锁定本次卷子,answers 存提交答案。
@Entity('exam_attempt')
@Index(['tenantId', 'userId'])
@Index('UQ_exam_attempt_active_user', ['tenantId', 'userId', 'activeKey'], { unique: true })
export class ExamAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  userId!: string;

  @Column({ type: 'varchar', nullable: true })
  courseId!: string | null;

  @Column({ type: 'varchar', default: '' })
  category!: string;

  // 本次卷子的题目 id 顺序(组卷时锁定)。
  @Column({ type: 'simple-json' })
  questionIds!: string[];

  // Keep grading and review stable when administrators replace question-bank data.
  @Column({ type: LARGE_JSON_TYPE, nullable: true, transformer: LARGE_JSON_TRANSFORMER })
  questionSnapshots!: ExamQuestionSnapshot[] | null;

  // 提交答案 {questionId: 'A'|'AC'}。未交卷前为空。
  @Column({ type: 'simple-json' })
  answers!: Record<string, string>;

  @Column({ type: 'integer' })
  total!: number;

  @Column({ type: 'integer', default: 0 })
  correct!: number;

  // 百分制 0-100。
  @Column({ type: 'integer', default: 0 })
  score!: number;

  @Column({ type: 'varchar', default: 'in_progress' })
  status!: 'in_progress' | 'submitted';

  @Column({ type: 'integer', default: 0 })
  draftVersion!: number;

  @Column({ type: 'varchar', length: 64, default: '' })
  draftHash!: string;

  @Column({ type: 'integer', default: 0 })
  currentQuestionIndex!: number;

  @Column({ type: 'varchar', length: 16, nullable: true })
  activeKey!: 'active' | null;

  @Column({ type: TS_TYPE, nullable: true })
  abandonedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: TS_TYPE, nullable: true })
  submittedAt!: Date | null;

  @Column({ type: TS_TYPE, nullable: true })
  deletedAt!: Date | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}

// 用户题目练习记录:专题学习和模拟考试都会写入,用于新题/原题/错题混合出题。
@Entity('question_practice')
@Index(['tenantId', 'userId', 'questionId'], { unique: true })
@Index(['tenantId', 'userId', 'lastSeenAt'])
export class QuestionPractice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 64 })
  tenantId!: string;

  @Column({ length: 64 })
  userId!: string;

  @Column({ length: 64 })
  questionId!: string;

  @Column({ type: 'integer', default: 0 })
  seenCount!: number;

  @Column({ type: 'integer', default: 0 })
  correctCount!: number;

  @Column({ type: 'integer', default: 0 })
  wrongCount!: number;

  @Column({ type: TS_TYPE, nullable: true })
  lastSeenAt!: Date | null;

  @Column({ type: TS_TYPE, nullable: true })
  lastCorrectAt!: Date | null;

  @Column({ type: TS_TYPE, nullable: true })
  lastWrongAt!: Date | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}

// 顺序学习进度:只由专题学习查看答案推进,避免模拟考试记录污染学习游标。
@Entity('study_question_progress')
@Index(['tenantId', 'userId', 'category', 'courseId'], { unique: true })
export class StudyQuestionProgress {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 64 })
  tenantId!: string;

  @Column({ length: 64 })
  userId!: string;

  @Column({ length: 50 })
  category!: string;

  @Column({ length: 64, default: '' })
  courseId!: string;

  @Column({ length: 64 })
  questionId!: string;

  @Column({ type: TS_TYPE })
  lastStudiedAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('wrong_question')
@Index(['tenantId', 'userId', 'questionId', 'source'], { unique: true })
@Index(['tenantId', 'userId', 'status'])
export class WrongQuestion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 64 })
  tenantId!: string;

  @Column({ length: 64 })
  userId!: string;

  @Column({ length: 64 })
  questionId!: string;

  @Column({ type: 'varchar', length: 16, default: 'exam' })
  source!: WrongQuestionSource;

  // 累计答错次数。
  @Column({ type: 'integer', default: 1 })
  wrongCount!: number;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status!: 'open' | 'mastered';

  @Column({ type: TS_TYPE })
  lastWrongAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

// 题目评论:学习端互动。
@Entity('comment')
@Index(['tenantId', 'questionId'])
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  questionId!: string;

  @Column()
  userId!: string;

  @Column({ type: 'text' })
  content!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

// 认证卡密:批量生成,凭 key 登录即可学习(无需手机号/密码),到期失效。
@Entity('access_key')
@Index(['tenantId', 'key'], { unique: true })
@Index(['tenantId', 'userId'])
export class AccessKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  key!: string;

  @Column({ type: TS_TYPE })
  expiresAt!: Date;

  @Column({ type: 'varchar', default: 'active' })
  status!: 'active' | 'revoked';

  // 补全资料后关联的正式 user.id;空=未补全(首次卡密登录强制补全手机号/昵称)。
  @Column({ type: 'varchar', nullable: true })
  userId!: string | null;

  // 人工发放后可先标记为已分配；真实登录后 firstLoginAt 也会视为已分配。
  @Column({ type: 'boolean', default: false })
  assigned!: boolean;

  @Column({ type: TS_TYPE, nullable: true })
  firstLoginAt!: Date | null;

  @Column({ type: TS_TYPE, nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('user_activity_log')
@Index(['tenantId', 'createdAt'])
@Index(['tenantId', 'action', 'createdAt'])
@Index(['tenantId', 'accessKeyId', 'createdAt'])
@Index(['tenantId', 'accessKeyHash', 'createdAt'])
@Index(['tenantId', 'userId', 'createdAt'])
export class UserActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 64 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  accessKeyId!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  accessKeyLast4!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  accessKeyMasked!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  accessKeyHash!: string | null;

  @Column({ type: 'varchar', length: 64 })
  action!: UserActivityAction;

  @Column({ type: 'varchar', length: 64 })
  targetType!: string;

  @Column({ type: 'varchar', nullable: true })
  targetId!: string | null;

  @Column({ type: 'simple-json', nullable: true })
  detail!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;
}

// 交流区帖子(学员发的主题/留言)。
@Entity('post')
@Index(['tenantId'])
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  // 归属论坛主题/版块。可空仅为兼容旧帖(seed 回填默认主题);新帖发布时必填。
  @Column({ type: 'varchar', nullable: true })
  topicId!: string | null;

  @Column()
  userId!: string;

  @Column({ type: 'text' })
  content!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: TS_TYPE, nullable: true })
  deletedAt!: Date | null;
}

// 论坛主题/版块。admin+super 维护,学员发帖时归属其一。
@Entity('forum_topic')
@Index(['tenantId'])
export class ForumTopic {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  name!: string;

  // 展示排序,小在前。
  @Column({ default: 0 })
  order!: number;

  @CreateDateColumn()
  createdAt!: Date;
}

// 交流区回复。
@Entity('post_reply')
@Index(['tenantId', 'postId'])
export class PostReply {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  postId!: string;

  @Column()
  userId!: string;

  @Column({ type: 'text' })
  content!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: TS_TYPE, nullable: true })
  deletedAt!: Date | null;
}

@Entity('post_reply_like')
@Index(['tenantId', 'replyId', 'userId'], { unique: true })
@Index(['tenantId', 'replyId'])
export class PostReplyLike {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  replyId!: string;

  @Column()
  userId!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

export const ALL_ENTITIES = [
  Tenant,
  User,
  WechatBindSession,
  Wallet,
  WalletTxn,
  RechargeCode,
  Course,
  Chapter,
  Lesson,
  Order,
  RechargeOrder,
  Entitlement,
  Progress,
  Question,
  QuestionImportBatch,
  AdminOperationLog,
  ExamPaperRule,
  QuestionCategoryEntity,
  Comment,
  ExamAttempt,
  QuestionPractice,
  StudyQuestionProgress,
  WrongQuestion,
  AccessKey,
  UserActivityLog,
  Post,
  PostReply,
  PostReplyLike,
  ForumTopic,
];
