/**
 * T-20260810-foot-CONSULTANT-REVENUE-AXIS-RECONCILE — 실장별 매출 SSOT (FIX-3 + FIX-2A)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 왜 이 파일인가 (FIX-3, SSOT 부재 → 재발 8차의 씨앗)
 * ─────────────────────────────────────────────────────────────────────────────
 *   customers.assigned_staff_id('2번차트 담당 실장') 기준 2-소스(payments 단건 +
 *   package_payments 패키지) net 귀속 집계가 서로 다른 3파일에 **독립 구현 3벌**로
 *   존재했다:
 *     ① lib/mtmSales.ts   fetchStaffDailyBreakdown  (통계>실장별 일별 매출)
 *     ③ components/sales/SalesDoctorTab.tsx           (매출집계>담당실장별)
 *     ④ lib/stats.ts      fetchConsultantPerfByAssignedStaff (배정>랭킹)
 *   숫자는 맞았으나 "맞는 이유가 규약이 아니라 우연"이었다(셋 중 하나만 고치면 발산).
 *   → 결제행 페치 + 귀속 + net 집계 **코어를 이 파일 1곳으로 수렴**한다. 표시 shape
 *     (일자 grain / gross·환불 분리 / net·결제고객)만 각 호출자가 담당한다.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FIX-2A — 상태 필터 통일 (총매출 KPI 정합)
 * ─────────────────────────────────────────────────────────────────────────────
 *   구 3벌은 payments.status ≠ 'deleted' 만 걸었다(cancelled 미제외 → 취소 결제를 매출로
 *   계상). 총매출 KPI RPC foot_stats_revenue 는 `status NOT IN ('cancelled','deleted')`
 *   를 건다(20260719140000_foot_stats_revenue_filter_sim_status.sql:73). 두 규칙이
 *   어긋나 실렌더에서 실장별 합계 ≠ 총매출(순)이 됐다.
 *   → 이 코어에서 **status NOT IN ('cancelled','deleted')** 로 통일(1곳 수정 = 4경로 정합).
 *   package_payments 는 status/deleted_at/voided_at 컬럼 부재(foot 실측) → 필터 없음.
 *
 *   ⚠ 순수 READ-ONLY. 신규 컬럼/테이블/enum 0. write/RPC/DDL 무접촉(db_change=false).
 *     귀속축(customers.assigned_staff_id)·기간축(accounting_date)·환불 net 규칙 전부 불변.
 */

import { supabase } from '@/lib/supabase';
import {
  getSimulationCustomerIds,
  excludeSimulationPaymentRows,
} from '@/lib/simulationFilter';

/** 담당실장 미지정(assigned_staff_id NULL 또는 워크인 customer_id NULL) 매출 버킷 sentinel. */
export const STAFF_UNASSIGNED = '__UNASSIGNED__';

/** 귀속된 결제행 1건 (단건 payments 또는 패키지 package_payments). */
export interface AttributedPayment {
  /** 귀속 staff.id (customers.assigned_staff_id) 또는 STAFF_UNASSIGNED. */
  staffId: string;
  /** 결제 고객 id (워크인=NULL). distinct 결제고객 산출용. */
  customerId: string | null;
  /** 결제 금액(양수 magnitude). net 부호는 isRefund 로 판정. */
  amount: number;
  /** 환불행 여부(payment_type='refund'). */
  isRefund: boolean;
  /** 소스 테이블. 'single'=payments, 'package'=package_payments. */
  source: 'single' | 'package';
  /** 회계일(accounting_date, YYYY-MM-DD). 일자 grain 집계용. */
  accountingDate: string | null;
  /**
   * T-20260811-foot-SALESAGG-PAYMETHOD-BREAKDOWN: 결제수단(payments/package_payments.method).
   *   'card'|'cash'|'transfer'|'membership' 또는 null/미지정. 결제수단별 분해 축 전용 —
   *   staffId 귀속·net 규칙엔 무관(ADDITIVE 노출). null/미지정은 소비처에서 '미분류/기타' 버킷으로.
   */
  method: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260821-foot-CLOSING-STAFFREV-PAGINATION-CAP-FIX — PostgREST 기본 1000행 cap 우회.
//   payments/package_payments 를 cursor(.range) 페이지네이션으로 전(全) 행 수집한다. 장기간
//   (월/분기) 조회 시 이 SSOT(fetchAttributedPayments)를 소비하는 전 화면(담당실장별·결제수단별·
//   랭킹·MTM 일별)이 1000행에서 무단 절단되어 최근일 tail 이 탈락(과소집계)하던 회귀를 차단한다.
//   (실측: 화면②>담당실장별 강경민 08-21 이 화면①<화면② 발산 — 절단 tail 누락이 진원.)
//   mtmSales.fetchAllRows(T-20260818-STATS-PERIOD-QUERY-ERROR)와 동일 패턴 — 공유 SSOT 미도달분
//   선제 보강. ⚠ 산식·귀속축(attributed_staff_id)·상태필터·기간축·sim 제외 전부 불변. 절단된 tail
//   을 재조회할 뿐(db_change=false, read-path only).
// ─────────────────────────────────────────────────────────────────────────────
async function fetchAllRows<T>(
  page: (offset: number, limit: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 200; // 20만행 상한(런어웨이 방어) — 초과 시 수집분 반환.
  const out: T[] = [];
  let offset = 0;
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await page(offset, PAGE_SIZE);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return out;
}

/** staff.id → 이름/직군/재직 메타. 로스터 정책 판정용. */
export interface StaffMeta {
  id: string;
  name: string;
  role: string | null;
  active: boolean | null;
}

export interface AttributedPayments {
  rows: AttributedPayment[];
  staffMeta: Map<string, StaffMeta>;
}

interface RawPayRow {
  amount: number | null;
  payment_type: string | null;
  customer_id: string | null;
  accounting_date: string | null;
  /** T-20260811-foot-SALESAGG-PAYMETHOD-BREAKDOWN: 결제수단(card/cash/transfer/membership/null). */
  method: string | null;
  /**
   * T-20260724-foot-ASSIGN-UPSYNC-REVENUE-REATTRIB-GATE (Option A · Branch A):
   *   결제시점 담당 실장 스냅샷. INSERT 시 BEFORE INSERT 트리거(trg_*_attributed_staff_stamp)가
   *   그 시점 customers.assigned_staff_id 를 각인 → 이후 재배정이 과거 매출귀속을 소급 이동시키지 않음.
   *   NULL(레거시행·워크인·미배정) → 아래 COALESCE belt 로 live-join fallback.
   */
  attributed_staff_id: string | null;
}

/**
 * SSOT — 기간 내 2-소스(단건 payments + 패키지 package_payments) 결제행을 페치하고
 * customers.assigned_staff_id('2번차트 담당 실장')로 귀속한 flat 행 배열을 반환한다.
 *
 * · 상태필터: payments.status NOT IN ('cancelled','deleted') (FIX-2A, foot_stats_revenue 동일 규칙).
 *   package_payments = status 컬럼 부재 → 필터 없음.
 * · sim(테스트) 고객 결제 제외(excludeSimulationPaymentRows). 워크인(customer_id NULL) 보존.
 * · 미배정(assigned_staff NULL) 또는 워크인 → staffId=STAFF_UNASSIGNED 버킷.
 * · 기간축 = accounting_date(회계 SSOT). 귀속축·기간축·환불 규칙 전부 기존과 동일(무변경).
 */
export async function fetchAttributedPayments(
  clinicId: string,
  from: string,
  to: string,
): Promise<AttributedPayments> {
  // T-20260821-foot-CLOSING-STAFFREV-PAGINATION-CAP-FIX: 2-소스 모두 fetchAllRows(cursor .range)로
  //   전(全) 행 수집 — PostgREST 기본 1000행 cap 절단 차단. 두 소스는 여전히 병렬(Promise.all).
  //   package_payments 도 동형 latent cap(현재 <1000 미발화)을 선제 전환. 산식/필터/소스 전부 불변.
  const [payData, pkgData] = await Promise.all([
    fetchAllRows<RawPayRow>((off, lim) =>
      supabase
        .from('payments')
        // T-20260811-foot-SALESAGG-PAYMETHOD-BREAKDOWN: method 추가(ADDITIVE, 결제수단별 분해축용).
        // T-20260724-foot-ASSIGN-UPSYNC-REVENUE-REATTRIB-GATE: attributed_staff_id 추가(결제시점 담당 스냅샷).
        .select('amount, payment_type, customer_id, accounting_date, method, attributed_staff_id')
        .eq('clinic_id', clinicId)
        // FIX-2A: 취소·삭제 결제 제외(foot_stats_revenue 와 동일 규칙). 구 .not(status,eq,deleted) 교체.
        .not('status', 'in', '(cancelled,deleted)')
        .gte('accounting_date', from)
        .lte('accounting_date', to)
        .range(off, off + lim - 1)),
    fetchAllRows<RawPayRow>((off, lim) =>
      supabase
        .from('package_payments')
        // T-20260811-foot-SALESAGG-PAYMETHOD-BREAKDOWN: method 추가(ADDITIVE, 결제수단별 분해축용).
        // T-20260724-foot-ASSIGN-UPSYNC-REVENUE-REATTRIB-GATE: attributed_staff_id 추가(결제시점 담당 스냅샷).
        .select('amount, payment_type, customer_id, accounting_date, method, attributed_staff_id')
        .eq('clinic_id', clinicId)
        .gte('accounting_date', from)
        .lte('accounting_date', to)
        .range(off, off + lim - 1)),
  ]);

  // sim 고객 결제 제외(매출 표시 방어필터). 워크인(customer_id NULL) 보존.
  const simIds = await getSimulationCustomerIds(clinicId);
  const single = excludeSimulationPaymentRows(payData, simIds);
  const pkg = excludeSimulationPaymentRows(pkgData, simIds);

  // customer_id → assigned_staff_id ('2번차트 담당자'). 500건씩 청크 조회(URL 길이 안전).
  const custIds = [
    ...new Set(
      [...single, ...pkg].map((r) => r.customer_id).filter(Boolean) as string[],
    ),
  ];
  const custStaff = new Map<string, string>();
  for (let i = 0; i < custIds.length; i += 500) {
    const chunk = custIds.slice(i, i + 500);
    const { data: custs, error: custErr } = await supabase
      .from('customers')
      .select('id, assigned_staff_id')
      .in('id', chunk);
    if (custErr) throw custErr;
    for (const c of (custs ?? []) as { id: string; assigned_staff_id: string | null }[]) {
      if (c.assigned_staff_id) custStaff.set(c.id, c.assigned_staff_id);
    }
  }

  // staff.id → 메타(이름/직군/재직). 로스터 정책 판정 소스.
  const { data: staffRows, error: staffErr } = await supabase
    .from('staff')
    .select('id, name, role, active')
    .eq('clinic_id', clinicId);
  if (staffErr) throw staffErr;
  const staffMeta = new Map<string, StaffMeta>();
  for (const s of (staffRows ?? []) as {
    id: string;
    name: string | null;
    role: string | null;
    active: boolean | null;
  }[]) {
    staffMeta.set(s.id, { id: s.id, name: s.name ?? '', role: s.role, active: s.active });
  }

  const rows: AttributedPayment[] = [];
  const push = (r: RawPayRow, source: 'single' | 'package') => {
    // T-20260724-foot-ASSIGN-UPSYNC-REVENUE-REATTRIB-GATE (Branch A · Option A):
    //   귀속 우선순위 = ① attributed_staff_id 스냅샷(결제시점 담당·재배정 소급이동 방지)
    //                  → ② live-join fallback(레거시행·워크인·미배정 안전 belt)
    //                  → ③ STAFF_UNASSIGNED.
    //   ★belt only — 설계된 재귀속 경로 아님. write-path 트리거가 항상 stamp + baseline-freeze 백필로
    //   legacy NULL≈0. code-gate 는 이 파일 밖 독립 live-join(매출→staff 귀속) 0 을 검증한다.
    const staffId =
      r.attributed_staff_id ||
      (r.customer_id && custStaff.get(r.customer_id)) ||
      STAFF_UNASSIGNED;
    rows.push({
      staffId,
      customerId: r.customer_id,
      amount: r.amount ?? 0,
      isRefund: r.payment_type === 'refund',
      source,
      accountingDate: r.accounting_date,
      // T-20260811-foot-SALESAGG-PAYMETHOD-BREAKDOWN: 결제수단 노출(집계·귀속 무관, 분해축 전용).
      method: r.method ?? null,
    });
  };
  for (const r of single) push(r, 'single');
  for (const r of pkg) push(r, 'package');

  return { rows, staffMeta };
}

/** staff 버킷별 net 성분 (표시 shape 파생용 원자값). */
export interface StaffNetBucket {
  staffId: string;
  /** 단건(payments) 비환불 SUM (gross). */
  singleGross: number;
  /** 단건(payments) 환불 SUM (양수 magnitude). */
  singleRefund: number;
  /** 패키지(package_payments) net (환불=음수상계). */
  pkgNet: number;
  /** distinct 결제고객 id (단건∪패키지, 환불행 포함 — 구 ④ 산식 동일). */
  customers: Set<string>;
}

/** net = 단건net + 패키지net = (singleGross − singleRefund) + pkgNet. */
export function bucketNet(b: StaffNetBucket): number {
  return b.singleGross - b.singleRefund + b.pkgNet;
}

/**
 * 귀속행 → staff 버킷별 net 성분 맵. 표시 shape(누적/환불/총, net/결제고객)의 단일 원자 소스.
 * ⚠ 로스터 필터를 하지 않는다 — STAFF_UNASSIGNED 포함 전 버킷 반환. 로스터/미지정 정책은
 *   호출자가 selectRoster()로 적용(정책=인자, 산식=불변 / FIX-3).
 */
export function aggregateStaffNet(rows: AttributedPayment[]): Map<string, StaffNetBucket> {
  const map = new Map<string, StaffNetBucket>();
  const ensure = (staffId: string): StaffNetBucket => {
    let b = map.get(staffId);
    if (!b) {
      b = { staffId, singleGross: 0, singleRefund: 0, pkgNet: 0, customers: new Set() };
      map.set(staffId, b);
    }
    return b;
  };
  for (const r of rows) {
    const b = ensure(r.staffId);
    if (r.source === 'single') {
      if (r.isRefund) b.singleRefund += r.amount;
      else b.singleGross += r.amount;
    } else {
      b.pkgNet += r.isRefund ? -r.amount : r.amount;
    }
    // distinct 결제고객: customerId 있는 모든 귀속행(환불 포함) — 구 ④ custSet 규약 동일.
    if (r.customerId) b.customers.add(r.customerId);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260811-foot-SALESAGG-PAYMETHOD-BREAKDOWN — 결제수단별 분해 축
//   실장별/치료사별과 '동일 모집단(fetchAttributedPayments rows)'을 method 로만 재버킷팅한다.
//   ⇒ Σ(결제수단별 net) === Σ(전 rows net) === 담당실장별 '총 매출'(SalesDoctorTab) 이 구조적으로 보장.
//   신규 매출 산식 창작 0 — 분해 축(결제수단)만 다르다. null/미지정 method = '미분류/기타' 버킷(누락 0).
// ─────────────────────────────────────────────────────────────────────────────

/** 결제수단 정본 키 4종 + 미분류. DB method(card/cash/transfer/membership) → 이 키로 정규화. */
export type PayMethodKey = 'card' | 'cash' | 'transfer' | 'membership' | 'unknown';

/** DB method 값 → 정본 키. 알 수 없거나 null → 'unknown'(미분류/기타 버킷). */
export function normalizePayMethod(method: string | null | undefined): PayMethodKey {
  switch (method) {
    case 'card':
    case 'cash':
    case 'transfer':
    case 'membership':
      return method;
    default:
      return 'unknown';
  }
}

/** 결제수단 정본 키 → 한국어 표기(현장). */
export const PAY_METHOD_LABEL: Record<PayMethodKey, string> = {
  card: '카드',
  cash: '현금',
  transfer: '이체',
  membership: '선수금차감',
  unknown: '미분류/기타',
};

/** 표시 순서(고정) — 카드·현금·이체·선수금차감·미분류/기타. */
export const PAY_METHOD_ORDER: PayMethodKey[] = [
  'card',
  'cash',
  'transfer',
  'membership',
  'unknown',
];

/** 결제수단 버킷 1개의 net 성분(표시 shape 파생용). */
export interface PayMethodBucket {
  methodKey: PayMethodKey;
  /** 비환불 결제 SUM(gross). 단건+패키지 모두 포함. */
  gross: number;
  /** 환불 SUM(양수 magnitude). 단건+패키지 모두 포함. */
  refund: number;
  /** 결제 건수(환불행 제외). */
  count: number;
}

/** net = gross − refund. 담당실장별 '총 매출'과 동일 net 정의(환불 1회 차감). */
export function payMethodNet(b: PayMethodBucket): number {
  return b.gross - b.refund;
}

/**
 * 귀속행(AttributedPayment[]) → 결제수단 버킷별 net 성분 맵.
 * ⚠ staffId·로스터 무관 — 전 rows 를 method(정규화 키)로만 그룹핑한다.
 *   ∴ Σ(payMethodNet) === Σ(전 rows net) === 담당실장별 총매출(구조적 tie-out, D2).
 */
export function aggregateByPaymentMethod(
  rows: AttributedPayment[],
): Map<PayMethodKey, PayMethodBucket> {
  const map = new Map<PayMethodKey, PayMethodBucket>();
  const ensure = (key: PayMethodKey): PayMethodBucket => {
    let b = map.get(key);
    if (!b) {
      b = { methodKey: key, gross: 0, refund: 0, count: 0 };
      map.set(key, b);
    }
    return b;
  };
  for (const r of rows) {
    const b = ensure(normalizePayMethod(r.method));
    if (r.isRefund) {
      b.refund += r.amount;
    } else {
      b.gross += r.amount;
      b.count += 1;
    }
  }
  return map;
}

/**
 * 로스터/미지정 정책 (FIX-3, 정책=인자):
 *   · 'all'               ①③⑤ — 전 staff + 미지정 버킷 보존(비상담직·퇴사자 행 유지).
 *   · 'consultant-all'    ②   — role='consultant'(퇴사 포함) 만. 미지정·비상담직·워크인 제외.
 *   · 'consultant-active' ④   — role='consultant' AND active≠false(재직). 미지정·비상담직 제외.
 */
export type RosterPolicy = 'all' | 'consultant-all' | 'consultant-active';

/** 해당 staff 버킷이 로스터 정책에 포함되는지 판정. */
export function inRoster(
  staffId: string,
  meta: StaffMeta | undefined,
  policy: RosterPolicy,
): boolean {
  if (policy === 'all') return true;
  if (staffId === STAFF_UNASSIGNED) return false; // 미지정/워크인 제외
  if (!meta || meta.role !== 'consultant') return false; // 비상담직 제외
  if (policy === 'consultant-active' && meta.active === false) return false; // 퇴사 제외
  return true;
}
