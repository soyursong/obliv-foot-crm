/**
 * T-20260804-foot-MTM-SALES-DASH-RESTRUCTURE — 통계 > "MTM 매출" 대시보드 재정비 지원 헬퍼.
 *
 * 원칙(티켓 AC / dev 참고): **신규 매출 산식 창작 금지 · 기존 SSOT/기존 화면 로직 재사용**.
 *   read-only 집계만 수행하며 어떤 write/RPC/DDL도 추가하지 않는다(db_change=false).
 *
 * 재사용한 SSOT:
 *   - 누적매출/패키지 판매액/일별 net = foot_stats_revenue RPC (stats.ts fetchRevenue).
 *       net = package_amount + single_amount − refund_amount (기존 "총 매출(순)" 정의 불변).
 *   - 급여/비급여 = Revenue Insurance Split SSOT (SalesDoctorTab INS-SPLIT).
 *       payments.tax_type='급여' = 급여 본인부담금 / (과세·면세_비급여·NULL) = 비급여 /
 *       '선수금' = 패키지 선결제(3축 제외) + closing_manual_payments UNION(비급여, voided 제외).
 *   - 실시술 매출(선수금차감) = **선수금(패키지 선결제) 판매분은 제외**하고, 대신
 *       package_sessions(status='used', session_date 기준) 소진 회차의 unit_price 스냅샷을
 *       인식(SalesStaffTab 차감기준 SSOT). → 회차권 = "당월 실제 사용 회차" 기준 인식(AC-B, rxuo 확정).
 *   - 노쇼율/재방문율 = foot_stats_noshow_returning RPC (stats.ts fetchNoshowReturning).
 *
 * sim(테스트) 고객 결제/체크인은 표시매출 방어 필터(excludeSimulationPaymentRows)로 상시 제외
 *   — 기존 통계/매출집계 탭과 동일(T-20260709-foot-SALES-SIMULATION-FILTER-DEFENSE).
 */

import { supabase } from '@/lib/supabase';
import {
  getSimulationCustomerIds,
  excludeSimulationPaymentRows,
} from '@/lib/simulationFilter';
import { fetchAttributedPayments, STAFF_UNASSIGNED } from '@/lib/staffRevenue';
import { todaySeoulISODate, seoulISODate } from '@/lib/format';
import {
  fetchRevenue,
  fetchNoshowReturning,
  type RevenueRow,
} from '@/lib/stats';

// ─────────────────────────────────────────────────────────────────────────────
// T-20260818-foot-STATS-PERIOD-QUERY-ERROR: PostgREST 기본 1000행 cap 우회 헬퍼.
//   장기간(>~30d) 조회 시 payments/check_ins 등이 1000행에서 무단 절단되어 매출·내원 KPI 가
//   과소집계되던 회귀를 차단한다(live 실측: 92d payments count=1299 vs fetched=1000). cursor(.range)
//   페이지네이션으로 전(全) 행을 수집 — 기존 fetchWeeklyRevenueBreakdown/stats.ts 패턴과 동일.
//   db_change=false(읽기 방식만 교정, 산식·소스·필터 불변).
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

// ─────────────────────────────────────────────────────────────────────────────
// 월 경계 헬퍼 (KST 날짜 문자열 기준, 순수 계산 — TZ 안전: day-of-month 계산만 사용)
// ─────────────────────────────────────────────────────────────────────────────

export interface MonthBounds {
  from: string;         // yyyy-MM-01
  to: string;           // yyyy-MM-<말일>
  year: number;
  month: number;        // 1~12
  daysInMonth: number;  // 말일
  label: string;        // "yyyy-MM"
}

/** ref(yyyy-MM-dd)가 속한 달의 1일~말일 경계. */
export function monthBounds(refISO: string): MonthBounds {
  const [y, m] = refISO.split('-').map(Number);
  // new Date(y, m, 0) = m월(1-based)의 말일. day-of-month만 취해 TZ 무관.
  const daysInMonth = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(daysInMonth).padStart(2, '0')}`,
    year: y,
    month: m,
    daysInMonth,
    label: `${y}-${mm}`,
  };
}

/** ref가 속한 달의 "전월" 경계. */
export function prevMonthBounds(refISO: string): MonthBounds {
  const [y, m] = refISO.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return monthBounds(`${py}-${String(pm).padStart(2, '0')}-01`);
}

/**
 * 예상월매출(추정) — ★산식 미정의(티켓 AC-B 잔여 1건). 기존 화면에 동일 지표가 없어
 * 표준 러프 추정(당월 경과일 일평균 × 해당월 총일수)으로 임시 구현한다.
 * planner FOLLOWUP(P2)로 현장 확정 요청 대상. blocked 아님(임시 표시).
 *
 * @param monthToDateNet 당월 1일~오늘(KST)까지 누적 매출(순)
 * @param refISO         기준월(보통 rangeFrom)
 * @returns 기준월이 "현재 KST 월"일 때만 추정값, 과거/커스텀월이면 null(→ 화면 '-')
 */
export function projectMonthlyRevenue(
  monthToDateNet: number,
  refISO: string,
): number | null {
  const { year, month, daysInMonth } = monthBounds(refISO);
  const [ty, tm, td] = todaySeoulISODate().split('-').map(Number);
  if (ty !== year || tm !== month) return null; // 현재월이 아니면 추정 불가
  if (td <= 0) return null;
  return Math.round((monthToDateNet / td) * daysInMonth);
}

// ─────────────────────────────────────────────────────────────────────────────
// 01 매출 통계 카드 — 급여/비급여/실시술(선수금차감)/내원환자/결제건수
//   (누적매출·패키지 판매액은 이미 로드된 RevenueRow에서 파생 — 여기서 재조회 안 함)
// ─────────────────────────────────────────────────────────────────────────────

export interface MtmCardMetrics {
  /** 급여 매출 = payments(tax_type='급여') net [수납 권위] */
  salaryRevenue: number;
  /** 비급여 매출 = payments(과세/면세_비급여/NULL) net + closing_manual UNION [수납 권위] */
  nonSalaryRevenue: number;
  /** 선수금(패키지 선결제) 판매분 net — 실시술매출에서 이연(제외)되는 금액 (참고용) */
  prepaidSales: number;
  /** 당월 소진 회차 인식액 = package_sessions(used) unit_price 스냅샷 합 [차감 SSOT] */
  sessionRedemption: number;
  /** 실제 시술 매출(선수금차감) = 급여 + 비급여 + 소진회차 인식 (선수금 판매분 제외) */
  actualTreatmentRevenue: number;
  /** 결제건수 = payments 결제행(환불 제외) 건수 */
  paymentCount: number;
  /** 내원환자 수 = 기간 내 체크인(취소·삭제 제외) distinct 고객 수 */
  visitPatients: number;
}

interface PayMetricRow {
  amount: number;
  payment_type: string | null;
  tax_type: string | null;
  customer_id: string | null;
}
interface ManualMetricRow {
  amount: number | null;
}
interface SessionMetricRow {
  unit_price: number | null;
}
interface CheckInMetricRow {
  customer_id: string | null;
}

export async function fetchMtmCardMetrics(
  clinicId: string,
  from: string,
  to: string,
): Promise<MtmCardMetrics> {
  const simIds = await getSimulationCustomerIds(clinicId);

  // 1) payments — 급여/비급여/선수금/결제건수 (accounting_date 축, deleted 제외)
  //    장기간 조회 전행 수집(1000 cap 우회) — 과소집계 회귀 차단.
  const pays = await fetchAllRows<PayMetricRow>((off, lim) =>
    supabase
      .from('payments')
      .select('amount, payment_type, tax_type, customer_id')
      .eq('clinic_id', clinicId)
      .not('status', 'eq', 'deleted')
      .gte('accounting_date', from)
      .lte('accounting_date', to)
      .range(off, off + lim - 1),
  );
  const payRows = excludeSimulationPaymentRows(pays, simIds);

  let salaryRevenue = 0;
  let nonSalaryRevenue = 0;
  let prepaidSales = 0;
  let paymentCount = 0;
  for (const p of payRows) {
    const net = p.payment_type === 'refund' ? -p.amount : p.amount;
    if (p.payment_type !== 'refund') paymentCount += 1;
    if (p.tax_type === '급여') {
      salaryRevenue += net; // 급여 본인부담금
    } else if (p.tax_type === '선수금') {
      prepaidSales += net;  // 선수금(패키지 선결제) — 실시술매출에서 이연(제외)
    } else {
      nonSalaryRevenue += net; // 과세/면세_비급여/NULL = 비급여
    }
  }

  // 2) closing_manual_payments — 비급여 UNION (수기수납, voided 제외)
  const cm = await fetchAllRows<ManualMetricRow>((off, lim) =>
    supabase
      .from('closing_manual_payments')
      .select('amount')
      .eq('clinic_id', clinicId)
      .gte('close_date', from)
      .lte('close_date', to)
      .is('voided_at', null)
      .range(off, off + lim - 1),
  );
  for (const m of cm) {
    nonSalaryRevenue += m.amount ?? 0;
  }

  // 3) package_sessions — 당월 소진 회차 인식(선수금차감 SSOT, SalesStaffTab 차감기준)
  //    금액기준 = unit_price 스냅샷(SalesStaffTab DEDUCT_AMOUNT_BASIS='snapshot' 동일).
  const sess = await fetchAllRows<SessionMetricRow>((off, lim) =>
    supabase
      .from('package_sessions')
      .select('unit_price, packages!inner(clinic_id)')
      .eq('packages.clinic_id', clinicId)
      .eq('status', 'used')
      .gte('session_date', from)
      .lte('session_date', to)
      .range(off, off + lim - 1) as unknown as PromiseLike<{ data: SessionMetricRow[] | null; error: unknown }>,
  );
  let sessionRedemption = 0;
  for (const s of sess) {
    sessionRedemption += s.unit_price ?? 0;
  }

  // 4) check_ins — 내원환자 수(distinct 고객, 취소·삭제 제외, KST 바운드)
  //    장기간 전행 수집(1000 cap 우회) — distinct 내원환자 과소집계 회귀 차단.
  const ci = await fetchAllRows<CheckInMetricRow>((off, lim) =>
    supabase
      .from('check_ins')
      .select('customer_id')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .neq('status', 'cancelled')
      .gte('checked_in_at', `${from}T00:00:00+09:00`)
      .lte('checked_in_at', `${to}T23:59:59+09:00`)
      .range(off, off + lim - 1),
  );
  const visitSet = new Set<string>();
  for (const c of ci) {
    if (c.customer_id && !simIds.has(c.customer_id)) visitSet.add(c.customer_id);
  }

  const actualTreatmentRevenue =
    salaryRevenue + nonSalaryRevenue + sessionRedemption;

  return {
    salaryRevenue,
    nonSalaryRevenue,
    prepaidSales,
    sessionRedemption,
    actualTreatmentRevenue,
    paymentCount,
    visitPatients: visitSet.size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 02 전월 대비 매출 추이 — 일자별(1~말일) 당월 vs 전월 비교표
// ─────────────────────────────────────────────────────────────────────────────

export interface DailyComparePoint {
  day: number;              // 1~말일
  current: number | null;   // 당월 매출(순). 미래일(현재월) = null
  previous: number | null;  // 전월 매출(순). 전월 데이터 없음 = null(→ '-')
}

export interface MonthlyComparison {
  points: DailyComparePoint[];
  prevHasData: boolean;     // 전월 데이터 존재 여부 (false → 비교컬럼 '-')
  curLabel: string;         // "yyyy-MM"
  prevLabel: string;
  monthToDateNet: number;   // 당월 1일~오늘(현재월) 누적 net — 예상월매출 분자
  curMonthTotal: number;    // 당월 전체 net 합
  prevMonthTotal: number;   // 전월 전체 net 합
}

/** RevenueRow[] → 일(day) → net 합 맵. net = pkg + single − refund. */
function netByDay(rows: RevenueRow[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of rows) {
    const day = Number(r.dt.slice(8, 10));
    if (!day) continue;
    const net =
      (r.package_amount ?? 0) + (r.single_amount ?? 0) - (r.refund_amount ?? 0);
    m.set(day, (m.get(day) ?? 0) + net);
  }
  return m;
}

interface ManualDayRow {
  amount: number | null;
  close_date: string | null;
}

/**
 * T-20260821-foot-CLOSING-BYDATE-MANUALPAY-OVERLAY-FIX — 수기결제 per-day 오버레이 맵.
 *
 * RC(부모 DIAG): `closing_manual_payments`(수기결제)는 §01 카드(fetchMtmCardMetrics 비급여 UNION)
 *   + 결제내역 탭 grossTotal(Closing.tsx manualEntries)에는 포함되나, §02 일자별표가 소비하는
 *   foot_stats_revenue RPC(payments/package_payments 만 read)에는 **무접촉** → 일자별표만 수기결제만큼
 *   과소집계(08-20 실측 Δ=+10,000). 같은 '총 매출' 탭 §01↔§02 내부 불일치.
 *
 * 해결: FE 오버레이. §01 카드·결제내역 탭과 **동일 소스·필터**로 close_date grain 합을 만들어
 *   netByDay 결과에 additive 가산 → 3-surface(§01/§02/결제내역) parity.
 *   · grain          = close_date (일자별표 일 축과 정합)
 *   · voided 제외     = voided_at IS NULL (§01·결제내역 탭 동일, 이중차감/오합산 방지)
 *   · sim 필터 없음   = §01 카드(L192–205)·결제내역 탭(manualEntries) 모두 수기결제엔 미적용 → parity 위해 동일
 *   · additive-safe   = foot_stats_revenue RPC 는 수기결제 무접촉 → RPC 반환값에 없는 금액만 가산(중복합산 0).
 *
 * db_change=false — 신규 RPC/컬럼/테이블/enum 무접촉. 기존 테이블 read-only 집계만 추가.
 */
async function manualNetByDay(
  clinicId: string,
  from: string,
  to: string,
): Promise<Map<number, number>> {
  const rows = await fetchAllRows<ManualDayRow>((off, lim) =>
    supabase
      .from('closing_manual_payments')
      .select('amount, close_date')
      .eq('clinic_id', clinicId)
      .gte('close_date', from)
      .lte('close_date', to)
      .is('voided_at', null) // soft-void 무효행 제외(§01·결제내역 탭 동일)
      .range(off, off + lim - 1),
  );
  const m = new Map<number, number>();
  for (const r of rows) {
    if (!r.close_date) continue;
    const day = Number(r.close_date.slice(8, 10));
    if (!day) continue;
    // 수기결제는 항상 payment_type='payment'(환불 없음) → amount 그대로 가산(Closing.tsx manualCard/Cash/Transfer 동일).
    m.set(day, (m.get(day) ?? 0) + (r.amount ?? 0));
  }
  return m;
}

export async function fetchMonthlyComparison(
  clinicId: string,
  refISO: string,
): Promise<MonthlyComparison> {
  const cur = monthBounds(refISO);
  const prev = prevMonthBounds(refISO);

  const [curRows, prevRows, curManual, prevManual] = await Promise.all([
    fetchRevenue(clinicId, cur.from, cur.to),
    fetchRevenue(clinicId, prev.from, prev.to),
    // T-20260821 수기결제 오버레이: §01 카드·결제내역 탭 포함기준과 parity(close_date grain, voided 제외).
    manualNetByDay(clinicId, cur.from, cur.to),
    manualNetByDay(clinicId, prev.from, prev.to),
  ]);

  const curMap = netByDay(curRows);
  const prevMap = netByDay(prevRows);
  // 수기결제 per-day 오버레이 additive 가산 — RPC 무접촉 금액만 더함(중복합산 없음).
  for (const [day, amt] of curManual) curMap.set(day, (curMap.get(day) ?? 0) + amt);
  for (const [day, amt] of prevManual) prevMap.set(day, (prevMap.get(day) ?? 0) + amt);
  // 전월 데이터 존재 = RPC 매출행 OR 수기결제 존재(수기만 있는 달도 '데이터 있음'으로 정확히 판정).
  const prevHasData = prevRows.length > 0 || prevManual.size > 0;

  // 현재 KST 월이면 오늘 이후 날짜는 아직 매출 없음(미래) → current=null 처리.
  const [ty, tm, td] = todaySeoulISODate().split('-').map(Number);
  const isCurMonth = ty === cur.year && tm === cur.month;

  const points: DailyComparePoint[] = [];
  let monthToDateNet = 0;
  let curMonthTotal = 0;
  for (let d = 1; d <= cur.daysInMonth; d++) {
    const isFuture = isCurMonth && d > td;
    const curVal = curMap.get(d) ?? 0;
    if (!isFuture) {
      monthToDateNet += curVal;
    }
    curMonthTotal += curVal;
    points.push({
      day: d,
      current: isFuture ? null : curVal,
      // 전월 데이터 없음(신규 오픈 첫 달) → null(화면 '-'). 0 오도 금지(티켓 시나리오 2-2).
      previous: prevHasData ? prevMap.get(d) ?? 0 : null,
    });
  }

  let prevMonthTotal = 0;
  for (const v of prevMap.values()) prevMonthTotal += v;

  return {
    points,
    prevHasData,
    curLabel: cur.label,
    prevLabel: prev.label,
    monthToDateNet,
    curMonthTotal,
    prevMonthTotal,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 02b 일별 매출 추이 — 실장(담당실장)별 breakdown
//   T-20260807-foot-STAFFDAILY-REVENUE-2NDCHART-ATTR-MATCH (부모 T-20260805 DAILYTREND-CLARIFY).
//   실장별 총매출 = 매출집계>담당실장별(SalesDoctorTab)의 '총매출' 정의를 **일자 grain**으로 그대로 소비.
//   ★신규 산식 창작 금지 — 라이브 담당실장별 탭(SalesDoctorTab, T-20260806 gross-redefine)과 숫자 일치가 목표.
//     그 탭의 총매출 = 누적(gross) − 환불금 = 단건net + 패키지net (환불 1회 차감, 수학적 등가) →
//     일자 grain 에서는 동일하게 **단건 payments net + 패키지 package_payments net** 을 일자별로 집계한다.
//     · 소스① 단건 payments = 전체(tax_type 무관, status≠'deleted'). net = refund→음수, 그 외→양수.
//       ★부모 as-built 오류 정정: tax_type IN('선수금','급여') 로 좁혀 비급여/과세/면세/NULL 단건을
//         누락하고 있었다(→ SalesDoctorTab 대비 과소집계·숫자 불일치의 RC). tax_type 필터 제거.
//     · 소스② 패키지 package_payments **테이블**(status 컬럼 부재 → 필터 없음). net = refund→음수.
//       ★부모 as-built 오류 정정: payments.tax_type='선수금' 를 패키지 proxy 로 쓰던 것을,
//         SalesDoctorTab 과 동일하게 별도 package_payments 테이블 소스로 교체.
//     · 귀속축(WHO) = customers.assigned_staff_id ('2번차트 담당 실장', 8/6 총괄 canon) — 부모와 동일(불변).
//     · accounting_date(판매/수납일) 일자 축으로 day 버킷. assigned_staff 없음 → '미지정' 버킷(누락·오귀속 금지).
//     · sim(테스트) 고객 결제는 방어필터로 제외(매출집계 탭과 동일 집합).
//   read-only 집계. write/RPC/DDL/신규컬럼·테이블·enum 무접촉(db_change=false, §S2.4 데이터정책 게이트 비유발).
//   ※ SalesDoctorTab(T-20260806) + 랭킹 fetchConsultantPerfByAssignedStaff(766bc8a5) 둘 다 이 2-소스 net
//     귀속을 db_change=false / path a(no-DDL) 로 배포한 선례 — 본 정정은 그 canon 을 일자 grain 에 재적용.
// ─────────────────────────────────────────────────────────────────────────────

/** 담당실장 미지정 매출 버킷 sentinel(SSOT staffRevenue.STAFF_UNASSIGNED 와 동일 값·의미). */
export const STAFF_BREAKDOWN_UNASSIGNED = STAFF_UNASSIGNED;

export interface StaffDailyCol {
  id: string;     // staff UUID or STAFF_BREAKDOWN_UNASSIGNED
  name: string;   // 실명 or '미지정'
  total: number;  // 당월 실장 총합(net)
}

export interface StaffDailyRow {
  day: number;                      // 1~말일
  isFuture: boolean;                // 현재월 미래일 → 표시 '-'(0 오도 금지)
  byStaff: Record<string, number>;  // staffId → 당일 총매출(net)
  total: number;                    // 당일 전 실장 합
}

export interface StaffDailyBreakdown {
  staff: StaffDailyCol[];  // 매출 내림차순 정렬, '미지정' 항상 최후미
  rows: StaffDailyRow[];   // 1~말일
  grandTotal: number;      // 당월 전체 합(= Σ staff.total)
  monthLabel: string;      // "yyyy-MM"
}

export async function fetchStaffDailyBreakdown(
  clinicId: string,
  refISO: string,
): Promise<StaffDailyBreakdown> {
  const cur = monthBounds(refISO);

  // T-20260810-foot-CONSULTANT-REVENUE-AXIS-RECONCILE (FIX-3 산식 SSOT 통합 + FIX-2A 상태필터):
  //   구 인라인 2-소스 페치·귀속·집계를 lib/staffRevenue SSOT(fetchAttributedPayments)로 수렴.
  //   · 소스① 단건 payments + 소스② 패키지 package_payments net, 귀속축=assigned_staff_id, sim 제외 = SSOT 동일.
  //   · FIX-2A: 단건 status 필터가 SSOT 에서 status NOT IN ('cancelled','deleted') 로 통일(구 'deleted'만 제외).
  //   여기서는 SSOT 가 돌려준 flat 귀속행을 accounting_date 일자 grain 으로만 버킷팅한다(표시 shape).
  const { rows: attributed, staffMeta } = await fetchAttributedPayments(
    clinicId,
    cur.from,
    cur.to,
  );

  // 집계: day → (staffId → net), staffId → net 총합. net = 환불→음수, 그 외→양수(단건·패키지 동일).
  const dayStaff = new Map<number, Map<string, number>>();
  const staffTotals = new Map<string, number>();
  for (const r of attributed) {
    if (!r.accountingDate) continue;
    const day = Number(r.accountingDate.slice(8, 10));
    if (!day) continue;
    const staffId = r.staffId; // SSOT: 미배정/워크인 = STAFF_UNASSIGNED (= STAFF_BREAKDOWN_UNASSIGNED)
    const net = r.isRefund ? -r.amount : r.amount;
    if (!dayStaff.has(day)) dayStaff.set(day, new Map());
    const dm = dayStaff.get(day)!;
    dm.set(staffId, (dm.get(staffId) ?? 0) + net);
    staffTotals.set(staffId, (staffTotals.get(staffId) ?? 0) + net);
  }

  // 실장 컬럼: 당월 활동 있는 실장만, 매출 내림차순, '미지정' 항상 최후미.
  const staff: StaffDailyCol[] = [...staffTotals.entries()]
    .map(([id, total]) => ({
      id,
      name:
        id === STAFF_BREAKDOWN_UNASSIGNED
          ? '미지정'
          : staffMeta.get(id)?.name || '미지정',
      total,
    }))
    .sort((a, b) => {
      if (a.id === STAFF_BREAKDOWN_UNASSIGNED) return 1;
      if (b.id === STAFF_BREAKDOWN_UNASSIGNED) return -1;
      return b.total - a.total;
    });

  // 현재 KST 월이면 오늘 이후 날짜 = 미래(데이터 없음) → 셀 '-'(0 오도 금지).
  const [ty, tm, td] = todaySeoulISODate().split('-').map(Number);
  const isCurMonth = ty === cur.year && tm === cur.month;

  const rowsOut: StaffDailyRow[] = [];
  let grandTotal = 0;
  for (let d = 1; d <= cur.daysInMonth; d++) {
    const dm = dayStaff.get(d);
    const byStaff: Record<string, number> = {};
    let total = 0;
    for (const col of staff) {
      const v = dm?.get(col.id) ?? 0;
      byStaff[col.id] = v;
      total += v;
    }
    grandTotal += total;
    rowsOut.push({
      day: d,
      isFuture: isCurMonth && d > td,
      byStaff,
      total,
    });
  }

  return { staff, rows: rowsOut, grandTotal, monthLabel: cur.label };
}

// ─────────────────────────────────────────────────────────────────────────────
// 05 노쇼율/재방문율 — 전월 비교(평균) 데이터
// ─────────────────────────────────────────────────────────────────────────────

export interface NoshowPrevCompare {
  prevNoshow: number | null;     // 전월 평균 노쇼율(%). 데이터 없음 = null(→ '-')
  prevReturning: number | null;  // 전월 평균 재방문율(%)
  prevHasData: boolean;
  prevLabel: string;             // "yyyy-MM"
}

export async function fetchNoshowReturningPrev(
  clinicId: string,
  refISO: string,
): Promise<NoshowPrevCompare> {
  const prev = prevMonthBounds(refISO);
  const rows = await fetchNoshowReturning(clinicId, prev.from, prev.to);
  if (!rows.length) {
    return {
      prevNoshow: null,
      prevReturning: null,
      prevHasData: false,
      prevLabel: prev.label,
    };
  }
  const n = rows.reduce((a, r) => a + Number(r.noshow_rate ?? 0), 0) / rows.length;
  const ret =
    rows.reduce((a, r) => a + Number(r.returning_rate ?? 0), 0) / rows.length;
  return {
    prevNoshow: n,
    prevReturning: ret,
    prevHasData: true,
    prevLabel: prev.label,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260814-foot-SALESSTAT-WEEKLY-AOV-ADD — 주단위 매출 breakdown 표 (객단가 포함)
//   CEO 결정(b): 통계>매출통계에 여러 주를 나열하는 신규 '주별 매출 breakdown 표' 신설.
//
// ★산식 정합 게이트(AC-2): 신규 주단위 객단가는 **기존 월간 매출통계 객단가와 동일 분자·분모 정의**.
//   · 분자(주 매출)   = 누적매출(순) = package + single − refund (RevenueSection totals.total / fetchRevenue 와 동일 SSOT).
//   · 분모(주 내원환자) = 기간 내 체크인(취소·삭제·테스트 제외) distinct customer_id
//                        (fetchMtmCardMetrics visitPatients 정의 100% 미러 — 별도 분모 authoring 0).
//   · 객단가 = 주 매출 ÷ 주 내원환자수, 내원환자 0 → null(0-div 가드, 화면 '-').
//   · is_test(테스트고객) 제외 = getSimulationCustomerIds + 매출/체크인 양측 동일 필터(AC-3).
//
//   ★ db_change=false: 주단위 = 기존 read-path(fetchRevenue 일별 net + check_ins distinct)를
//     ISO주(월요일 시작, resolveRange 'week' 와 동일 경계)로 재그룹만 한다. 신규 RPC/컬럼/테이블 0.
//   READ-ONLY 집계. write/RPC/DDL/신규컬럼·테이블·enum 무접촉(§S2.4 데이터정책 게이트 비유발).
// ─────────────────────────────────────────────────────────────────────────────

export interface WeeklyRevenueRow {
  weekStart: string;      // yyyy-MM-dd — 해당 주 월요일(경계 raw)
  weekEnd: string;        // yyyy-MM-dd — 해당 주 일요일(경계 raw)
  rangeStart: string;     // yyyy-MM-dd — 조회기간으로 clip 된 주 시작일(표시용)
  rangeEnd: string;       // yyyy-MM-dd — 조회기간으로 clip 된 주 종료일(표시용)
  label: string;          // "8/11~8/17"(clip 된 표시 라벨)
  revenue: number;        // 주 매출(순) = pkg + single − refund
  visitPatients: number;  // 주 내원환자 수(distinct customer_id, 취소·삭제·테스트 제외)
  arpu: number | null;    // 객단가 = revenue ÷ visitPatients. 내원 0 → null('-')
}

/** yyyy-MM-dd → 그 주의 월요일(yyyy-MM-dd). UTC 순수 날짜연산(TZ 무관, resolveRange 'week' 와 동일 경계). */
function mondayOfISO(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();            // 0=일 … 6=토
  const diffToMon = (dow + 6) % 7;       // 월요일까지 뒤로 이동할 일수
  dt.setUTCDate(dt.getUTCDate() - diffToMon);
  return dt.toISOString().slice(0, 10);
}

/** yyyy-MM-dd + n일 → yyyy-MM-dd (UTC 순수 연산). */
function addDaysISO(dateISO: string, n: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** "M/D" 표시(선행 0 제거). */
function shortMD(dateISO: string): string {
  const [, m, d] = dateISO.split('-').map(Number);
  return `${m}/${d}`;
}

/** 주별 집계 입력용 체크인 행(내원환자 distinct 산정). */
export interface WeeklyCheckInRow {
  customer_id: string | null;
  checked_in_at: string | null;  // timestamptz(UTC) — KST 날짜로 환산해 주 귀속
}

/**
 * 순수 집계(테스트 가능): 일별 매출 + 체크인 행 → 주별(ISO주, 월요일 시작) 매출·내원환자수·객단가.
 *   · 매출(순) = pkg + single − refund (RevenueSection totals.total / 월간 객단가 분자 SSOT 동일).
 *   · 내원환자 = distinct customer_id(취소·삭제 체크인은 호출부에서 이미 제외 · 테스트고객 simIds 제외).
 *   · 객단가 = 주 매출 ÷ 주 내원환자수, 내원 0 → null(0-div 가드) — 월간 매출통계 객단가 정의 100% 미러(AC-2).
 * @param simIds 테스트(is_test/sim) 고객 id 집합 — 매출은 RPC 단, 체크인은 여기서 제외(AC-3).
 * @returns 주 시작일 오름차순 WeeklyRevenueRow[]. 매출·내원 0인 주도 포함(기간 완전성).
 */
export function aggregateWeeklyRevenue(
  from: string,
  to: string,
  revRows: RevenueRow[],
  checkIns: WeeklyCheckInRow[],
  simIds: Set<string>,
): WeeklyRevenueRow[] {
  // 1) 매출(순) 일별 → 주 버킷.
  const revByWeek = new Map<string, number>();
  for (const r of revRows) {
    const wk = mondayOfISO(r.dt);
    const net =
      (r.package_amount ?? 0) + (r.single_amount ?? 0) - (r.refund_amount ?? 0);
    revByWeek.set(wk, (revByWeek.get(wk) ?? 0) + net);
  }

  // 2) 내원환자(distinct customer_id) 주 버킷 — KST 날짜로 주 귀속, 테스트고객 제외.
  const visitByWeek = new Map<string, Set<string>>();
  for (const c of checkIns) {
    if (!c.customer_id || !c.checked_in_at) continue;
    if (simIds.has(c.customer_id)) continue;                 // 테스트고객 제외(AC-3)
    const wk = mondayOfISO(seoulISODate(c.checked_in_at));    // UTC → KST 날짜 → 주 귀속
    let set = visitByWeek.get(wk);
    if (!set) {
      set = new Set<string>();
      visitByWeek.set(wk, set);
    }
    set.add(c.customer_id);
  }

  // 3) 기간 내 모든 주(월요일 시작) 오름차순 생성 → 매출·내원 0인 주도 표에 포함(완전성).
  const firstMonday = mondayOfISO(from);
  const out: WeeklyRevenueRow[] = [];
  for (let wk = firstMonday; wk <= to; wk = addDaysISO(wk, 7)) {
    const weekEnd = addDaysISO(wk, 6);
    // 표시용 clip: 주 경계가 조회기간을 벗어나면 from/to 로 자른다.
    const rangeStart = wk < from ? from : wk;
    const rangeEnd = weekEnd > to ? to : weekEnd;
    const revenue = revByWeek.get(wk) ?? 0;
    const visitPatients = visitByWeek.get(wk)?.size ?? 0;
    out.push({
      weekStart: wk,
      weekEnd,
      rangeStart,
      rangeEnd,
      label: `${shortMD(rangeStart)}~${shortMD(rangeEnd)}`,
      revenue,
      visitPatients,
      // 객단가 = 주 매출 ÷ 주 내원환자수. 내원 0 → null(0-div 가드, AC-1).
      arpu: visitPatients > 0 ? revenue / visitPatients : null,
    });
  }
  return out;
}

/**
 * 조회기간 [from, to] 를 ISO주(월요일 시작)로 재그룹해 주별 매출·내원환자수·객단가를 산출.
 *   신규 RPC/컬럼 0 — fetchRevenue(일별 net) + check_ins distinct 를 재그룹만(db_change=false).
 */
export async function fetchWeeklyRevenueBreakdown(
  clinicId: string,
  from: string,
  to: string,
): Promise<WeeklyRevenueRow[]> {
  const simIds = await getSimulationCustomerIds(clinicId);

  // 매출(순) 일별 (fetchRevenue = foot_stats_revenue SSOT).
  const revRows = await fetchRevenue(clinicId, from, to);

  // 체크인 — fetchMtmCardMetrics visitPatients 필터 100% 미러(취소·삭제 제외, KST 바운드).
  //   PostgREST max-rows=1000 cap 우회 = cursor pagination(.range), 기존 stats 패턴 재사용.
  const PAGE_SIZE = 1000;
  const checkIns: WeeklyCheckInRow[] = [];
  let offset = 0;
  for (let page = 0; page < 60; page++) {
    const { data, error } = await supabase
      .from('check_ins')
      .select('customer_id, checked_in_at')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .neq('status', 'cancelled')
      .gte('checked_in_at', `${from}T00:00:00+09:00`)
      .lte('checked_in_at', `${to}T23:59:59+09:00`)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as WeeklyCheckInRow[];
    checkIns.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return aggregateWeeklyRevenue(from, to, revRows, checkIns, simIds);
}
