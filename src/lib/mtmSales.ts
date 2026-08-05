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
import { todaySeoulISODate } from '@/lib/format';
import {
  fetchRevenue,
  fetchNoshowReturning,
  type RevenueRow,
} from '@/lib/stats';

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
  const { data: pays, error: payErr } = await supabase
    .from('payments')
    .select('amount, payment_type, tax_type, customer_id')
    .eq('clinic_id', clinicId)
    .not('status', 'eq', 'deleted')
    .gte('accounting_date', from)
    .lte('accounting_date', to);
  if (payErr) throw payErr;
  const payRows = excludeSimulationPaymentRows(
    (pays ?? []) as PayMetricRow[],
    simIds,
  );

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
  const { data: cm, error: cmErr } = await supabase
    .from('closing_manual_payments')
    .select('amount')
    .eq('clinic_id', clinicId)
    .gte('close_date', from)
    .lte('close_date', to)
    .is('voided_at', null);
  if (cmErr) throw cmErr;
  for (const m of (cm ?? []) as ManualMetricRow[]) {
    nonSalaryRevenue += m.amount ?? 0;
  }

  // 3) package_sessions — 당월 소진 회차 인식(선수금차감 SSOT, SalesStaffTab 차감기준)
  //    금액기준 = unit_price 스냅샷(SalesStaffTab DEDUCT_AMOUNT_BASIS='snapshot' 동일).
  const { data: sess, error: sessErr } = await supabase
    .from('package_sessions')
    .select('unit_price, packages!inner(clinic_id)')
    .eq('packages.clinic_id', clinicId)
    .eq('status', 'used')
    .gte('session_date', from)
    .lte('session_date', to);
  if (sessErr) throw sessErr;
  let sessionRedemption = 0;
  for (const s of (sess ?? []) as unknown as SessionMetricRow[]) {
    sessionRedemption += s.unit_price ?? 0;
  }

  // 4) check_ins — 내원환자 수(distinct 고객, 취소·삭제 제외, KST 바운드)
  const { data: ci, error: ciErr } = await supabase
    .from('check_ins')
    .select('customer_id')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .neq('status', 'cancelled')
    .gte('checked_in_at', `${from}T00:00:00+09:00`)
    .lte('checked_in_at', `${to}T23:59:59+09:00`);
  if (ciErr) throw ciErr;
  const visitSet = new Set<string>();
  for (const c of (ci ?? []) as CheckInMetricRow[]) {
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

export async function fetchMonthlyComparison(
  clinicId: string,
  refISO: string,
): Promise<MonthlyComparison> {
  const cur = monthBounds(refISO);
  const prev = prevMonthBounds(refISO);

  const [curRows, prevRows] = await Promise.all([
    fetchRevenue(clinicId, cur.from, cur.to),
    fetchRevenue(clinicId, prev.from, prev.to),
  ]);

  const curMap = netByDay(curRows);
  const prevMap = netByDay(prevRows);
  const prevHasData = prevRows.length > 0;

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
//   T-20260805-foot-DAILYTREND-STAFF-BREAKDOWN-CLARIFY (AC-A).
//   실장별 총매출 = SALESAGG-STAFF-4METRIC-REDEFINE(deployed) 정의를 **일자 grain**으로 재사용.
//   ★신규 산식 창작 금지 — SalesDoctorTab(담당실장별) 로직/귀속 기준을 그대로 소비:
//     · 총매출 = 패키지 결제 합산(payments tax_type='선수금' net)
//               + 급여 본인부담금 합산(payments tax_type='급여' net)   [총괄 명시 산식 ④]
//     · net = payment_type='refund' → 음수(환불 차감). accounting_date(판매/수납일) 축.
//     · 담당실장 귀속 = customers.assigned_staff_id (SalesDoctorTab AC-2 동일 grain).
//     · assigned_staff 없음 → '미지정' 버킷 명시(누락·오귀속 금지, 시나리오 2-2).
//     · sim(테스트) 고객 결제는 방어필터로 제외(매출집계 탭과 동일 집합).
//   read-only 집계. write/RPC/DDL 무접촉(db_change=false).
// ─────────────────────────────────────────────────────────────────────────────

/** 담당실장 미지정 매출 버킷 sentinel(SalesDoctorTab UNASSIGNED 와 동일 의미). */
export const STAFF_BREAKDOWN_UNASSIGNED = '__UNASSIGNED__';

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

interface StaffBreakdownPayRow {
  amount: number;
  payment_type: string | null;
  tax_type: string | null;
  accounting_date: string | null;
  customer_id: string | null;
}

export async function fetchStaffDailyBreakdown(
  clinicId: string,
  refISO: string,
): Promise<StaffDailyBreakdown> {
  const cur = monthBounds(refISO);
  const simIds = await getSimulationCustomerIds(clinicId);

  // payments — 패키지(선수금) + 급여(본인부담금)만, accounting_date 축, deleted 제외.
  const { data: pays, error: payErr } = await supabase
    .from('payments')
    .select('amount, payment_type, tax_type, accounting_date, customer_id')
    .eq('clinic_id', clinicId)
    .not('status', 'eq', 'deleted')
    .in('tax_type', ['선수금', '급여'])
    .gte('accounting_date', cur.from)
    .lte('accounting_date', cur.to);
  if (payErr) throw payErr;
  const rows = excludeSimulationPaymentRows(
    (pays ?? []) as StaffBreakdownPayRow[],
    simIds,
  );

  // customer_id → assigned_staff_id (SalesDoctorTab 동일 3-step join).
  const custIds = [
    ...new Set(rows.map((r) => r.customer_id).filter(Boolean) as string[]),
  ];
  const custStaffMap = new Map<string, string>();
  if (custIds.length > 0) {
    const { data: custs, error: custErr } = await supabase
      .from('customers')
      .select('id, assigned_staff_id')
      .in('id', custIds);
    if (custErr) throw custErr;
    for (const c of (custs ?? []) as {
      id: string;
      assigned_staff_id: string | null;
    }[]) {
      if (c.assigned_staff_id) custStaffMap.set(c.id, c.assigned_staff_id);
    }
  }

  // staff_id → name.
  const staffNameMap = new Map<string, string>();
  const { data: staffList, error: staffErr } = await supabase
    .from('staff')
    .select('id, name')
    .eq('clinic_id', clinicId);
  if (staffErr) throw staffErr;
  for (const s of (staffList ?? []) as { id: string; name: string }[]) {
    staffNameMap.set(s.id, s.name);
  }

  // 집계: day → (staffId → net), staffId → net 총합.
  const dayStaff = new Map<number, Map<string, number>>();
  const staffTotals = new Map<string, number>();
  for (const p of rows) {
    if (!p.accounting_date) continue;
    const day = Number(p.accounting_date.slice(8, 10));
    if (!day) continue;
    const staffId =
      (p.customer_id && custStaffMap.get(p.customer_id)) ||
      STAFF_BREAKDOWN_UNASSIGNED;
    const net = p.payment_type === 'refund' ? -p.amount : p.amount;
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
          : staffNameMap.get(id) ?? '미지정',
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
