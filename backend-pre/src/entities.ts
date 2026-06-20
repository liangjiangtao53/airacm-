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

export type LessonAccess = 'free' | 'paid' | 'vip' | 'password';
export type LessonType = 'video' | 'text';
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'cancelled';
export type PayChannel = 'wallet' | 'wechat';
export type WalletTxnType = 'recharge' | 'consume';
export type RechargeCodeStatus = 'unused' | 'used';
export type ProgressStatus = 'not_started' | 'in_progress' | 'done';

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

  @Column({ default: '' })
  passwordHash!: string;

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
@Index(['tenantId', 'type', 'refId'], { unique: true, where: '"refId" IS NOT NULL' })
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

  @Column({ type: 'datetime', nullable: true })
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
@Index(['transactionId'], { unique: true, where: '"transactionId" IS NOT NULL' })
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

  @Column({ type: 'datetime', nullable: true })
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

  @Column({ type: 'datetime', nullable: true })
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

export const ALL_ENTITIES = [
  Tenant,
  User,
  Wallet,
  WalletTxn,
  RechargeCode,
  Course,
  Chapter,
  Lesson,
  Order,
  Entitlement,
  Progress,
];
