// ============================================================
// T-20260814-foot-STAFF-DEACTIVATE-DELETE-SPLIT
//   직원 '비활성'(soft, active=false) 과 '삭제'(hard-delete) 분리의 삭제-측 안전 census.
//
// 배경: staff.id 를 참조하는 실무 귀속 축(예약·수납·차트·시술 처리자)이 여럿 존재한다.
//   그중 다수가 FK ON DELETE SET NULL / (일부) RESTRICT 로 선언되어 있어:
//     - SET NULL 축(reservations.preferred_therapist_id, customers.assigned_*,
//       check_ins.assigned_counselor_id 등)은 DB 가 hard-DELETE 를 막지 않고
//       "조용히" 실무 귀속을 NULL 로 만들어 이력을 훼손한다(= 이 티켓이 막아야 할 사고).
//     - RESTRICT 축(check_ins.consultant/therapist/technician_id, package_sessions.performed_by,
//       check_in_services.seller_staff_id 등)은 DB 가 23503 으로 삭제를 거부한다(2차 백스톱).
//   따라서 hard-DELETE 는 "참조 0건(테스트/미사용 계정)" 일 때만 허용하고,
//   1건이라도 있으면 삭제를 차단하고 '비활성' 처리를 안내한다.
//
// 설계 원칙:
//   - fail-closed: census 쿼리가 하나라도 error 면 throw → 호출부는 삭제 차단(불확실 위 파괴 금지).
//   - staff.id 는 전역 UNIQUE UUID → clinic 스코프 필터 불필요(참조 컬럼 매칭만으로 정확).
//   - 신규 컬럼/스키마 변경 0 (db_change=false) — active 플래그 재사용 + 읽기 전용 census.
//
// census 대상(모두 prod 실재 확인: FE 쿼리·마이그레이션 대조):
//   check_ins.{consultant_id,therapist_id,technician_id,assigned_counselor_id}  차트/상담/시술 처리자
//   check_in_services.seller_staff_id                                            수납/판매(화장품) 귀속
//   package_sessions.performed_by                                                패키지 시술(차감) 시술자
//   customers.{assigned_staff_id,designated_therapist_id,assigned_consultant_id} 담당 고객(2번차트/자동배정)
//   reservations.preferred_therapist_id                                          예약 지정 치료사
// ============================================================
import { supabase } from '@/lib/supabase';

/** staff.id 를 참조하는 실무 귀속 축(hard-delete 시 이력 훼손/차단 대상). */
export const STAFF_REF_PROBES: { table: string; cols: string[]; label: string }[] = [
  { table: 'check_ins', cols: ['consultant_id', 'therapist_id', 'technician_id', 'assigned_counselor_id'], label: '방문·차트 처리' },
  { table: 'check_in_services', cols: ['seller_staff_id'], label: '수납·판매' },
  { table: 'package_sessions', cols: ['performed_by'], label: '패키지 시술' },
  { table: 'customers', cols: ['assigned_staff_id', 'designated_therapist_id', 'assigned_consultant_id'], label: '담당 고객' },
  { table: 'reservations', cols: ['preferred_therapist_id'], label: '예약 지정' },
];

export interface StaffRefCensus {
  /** 전체 참조 건수 합계(>0 이면 hard-delete 차단). */
  total: number;
  /** 참조가 발견된 축 라벨 목록(현장 안내 문구용, 건수 순 정렬). */
  hitLabels: string[];
  /** 테이블별 건수(디버그/증적용). */
  byTable: Record<string, number>;
}

/** PostgREST `.or()` 필터 식 빌드 — 한 테이블의 여러 staff-ref 컬럼 중 하나라도 staffId 매칭. */
export function buildStaffRefOrExpr(cols: string[], staffId: string): string {
  return cols.map((c) => `${c}.eq.${staffId}`).join(',');
}

export type StaffDeleteVerdict =
  | { kind: 'allow' }
  | { kind: 'block'; reason: 'has_references'; total: number; hitLabels: string[] };

/**
 * census 결과 → hard-delete 허용/차단 판정(순수 함수).
 *   total>0 = 실무 이력 존재 → 차단(비활성 유도) / total=0 = 미사용/테스트 계정 → 허용.
 */
export function evaluateStaffDeletion(census: StaffRefCensus): StaffDeleteVerdict {
  if (census.total > 0) {
    return { kind: 'block', reason: 'has_references', total: census.total, hitLabels: census.hitLabels };
  }
  return { kind: 'allow' };
}

/**
 * DB FK 위반(23503) 판별 — census 가 놓친 RESTRICT 축이 삭제를 거부한 경우.
 *   supabase error 는 code(PostgREST) 또는 message 로 온다 → 둘 다 방어.
 */
export function isForeignKeyError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '23503') return true;
  return /foreign key|violates foreign/i.test(error.message ?? '');
}

/**
 * 직원(staffId)이 실무 귀속 축에서 참조되는 건수를 census.
 * @throws 어느 한 축이라도 쿼리 error → fail-closed(호출부에서 삭제 차단).
 */
export async function countStaffReferences(staffId: string): Promise<StaffRefCensus> {
  const byTable: Record<string, number> = {};
  const hits: { label: string; count: number }[] = [];
  let total = 0;

  for (const probe of STAFF_REF_PROBES) {
    const orExpr = buildStaffRefOrExpr(probe.cols, staffId);
    const { count, error } = await supabase
      .from(probe.table)
      .select('id', { count: 'exact', head: true })
      .or(orExpr);
    // fail-closed: 불확실 census 위 파괴 금지(rooms 슬롯 제거 census 선례와 동일 원칙).
    if (error) throw new Error(`참조 확인 실패(${probe.table}): ${error.message}`);
    const n = count ?? 0;
    byTable[probe.table] = n;
    total += n;
    if (n > 0) hits.push({ label: probe.label, count: n });
  }

  hits.sort((a, b) => b.count - a.count);
  return { total, hitLabels: hits.map((h) => h.label), byTable };
}
