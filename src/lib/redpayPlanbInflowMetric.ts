/**
 * redpayPlanbInflowMetric.ts — 미배정 결제함 유입률 운영지표 (read-only 집계)
 * ────────────────────────────────────────────────────────────────────────
 * T-20260729-foot-REDPAY-PLANB-UNASSIGNED-INFLOW-METRIC (parent: NOWAIT-PAYPAGE-BUILD)
 * 현장(최필경 총괄, 2026-07-29 MSG-ku9c): TTL 5분 축소로 '짧아서 놓친 몫' 추적.
 *
 * ★ 불변식 (설계 대원칙):
 *   · read-only 집계 — pending_payment.status 를 세기만 한다.
 *   · payments / 매출 split(§550 Model A) / cue 귀속과 ★절대 무접점★ (payments JOIN 금지).
 *   · db_change 없음 — 신규 컬럼/테이블/VIEW/RPC 불요. 앱 쿼리 집계만.
 *     (신규 VIEW/RPC 로 승격하거나 cross-CRM·매출뷰에 노출 시 → planner 통지 + DA CONSULT 승격)
 *
 * 정의:
 *   · 미배정 유입 = pending_payment.status ∈ {expired, failed}
 *       expired = TTL(선점잠금 6분) 경과 무매칭 / failed = 웹훅N·승인거절·tie-break 실패.
 *   · 유입률 = 미배정 유입 건수 / 전체 선점(pending_payment 생성) 건수.
 *
 * 착수 타이밍: 집계 로직 선개발(본 lib). 실측정은 parent NOWAIT-PAYPAGE-BUILD 라이브 후
 *   (pending_payment 데이터가 쌓여야 유효). parent deploy-ready 비블로킹.
 */

import { supabase } from './supabase';

/** 미배정 유입으로 간주하는 status 집합 (선점 만료/미매칭 → 사후 수동 연결 대상). */
export const UNASSIGNED_STATUSES = ['expired', 'failed'] as const;
export type UnassignedStatus = (typeof UNASSIGNED_STATUSES)[number];

/** pending_payment status enum (CHECK: open|matched|expired|failed|cancelled). */
export type PendingPaymentStatus = 'open' | 'matched' | 'expired' | 'failed' | 'cancelled';

export interface StatusCount {
  status: PendingPaymentStatus;
  count: number;
}

export interface UnassignedInflowMetric {
  /** 집계 기간 (ISO, created_at 기준). */
  from: string;
  to: string;
  /** 전체 선점 생성 건수 (기간 내 pending_payment 총 건수). */
  totalPreempts: number;
  /** 미배정 유입 건수 (status ∈ {expired, failed}). */
  unassignedCount: number;
  /** expired 세부. */
  expiredCount: number;
  /** failed 세부. */
  failedCount: number;
  /** 유입률 (0~1). totalPreempts=0 이면 0. */
  inflowRate: number;
  /** status 별 원자 카운트 (감사·검증용). */
  byStatus: StatusCount[];
}

/**
 * status 카운트 배열 → 유입률 지표 계산 (순수 함수, DB 무접점·테스트 대상).
 * 매출 파이프와 무관하게 pending_payment status count 만 사용.
 */
export function computeInflowRate(
  byStatus: StatusCount[],
  from: string,
  to: string,
): UnassignedInflowMetric {
  const get = (s: PendingPaymentStatus) =>
    byStatus.find((r) => r.status === s)?.count ?? 0;

  const expiredCount = get('expired');
  const failedCount = get('failed');
  const unassignedCount = expiredCount + failedCount;
  const totalPreempts = byStatus.reduce((sum, r) => sum + r.count, 0);
  const inflowRate = totalPreempts > 0 ? unassignedCount / totalPreempts : 0;

  return {
    from,
    to,
    totalPreempts,
    unassignedCount,
    expiredCount,
    failedCount,
    inflowRate,
    byStatus,
  };
}

/**
 * 기간 내 pending_payment 를 status 별로 read-only 집계.
 * ★ payments 무접점 — pending_payment 만 select(created_at, status). RLS(clinic scope) 적용.
 *
 * @param clinicId  대상 클리닉 (foot-local scope)
 * @param from      집계 시작 (ISO, created_at >= from)
 * @param to        집계 종료 (ISO, created_at < to)
 */
export async function fetchUnassignedInflowMetric(
  clinicId: string,
  from: string,
  to: string,
): Promise<UnassignedInflowMetric> {
  const { data, error } = await supabase
    .from('pending_payment')
    .select('status')
    .eq('clinic_id', clinicId)
    .gte('created_at', from)
    .lt('created_at', to);

  if (error) throw error;

  const counts = new Map<PendingPaymentStatus, number>();
  for (const row of (data ?? []) as { status: PendingPaymentStatus }[]) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }
  const byStatus: StatusCount[] = Array.from(counts.entries()).map(
    ([status, count]) => ({ status, count }),
  );

  return computeInflowRate(byStatus, from, to);
}

/** 리포트 표시용 퍼센트 문자열 (소수 1자리). */
export function formatInflowRate(metric: UnassignedInflowMetric): string {
  return `${(metric.inflowRate * 100).toFixed(1)}%`;
}
