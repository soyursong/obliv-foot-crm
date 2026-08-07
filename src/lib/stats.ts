import { supabase } from '@/lib/supabase';
import {
  getSimulationCustomerIds,
  excludeSimulationPaymentRows,
} from '@/lib/simulationFilter';

/**
 * F12 통계 대시보드 RPC 호출 헬퍼.
 * 4 RPC를 캡슐화하고 raw 테이블 쿼리는 호출자에서 사용하지 않는다.
 *
 * 마이그레이션: supabase/migrations/20260430100000_foot_stats_rpc.sql
 */

export interface RevenueRow {
  dt: string;             // yyyy-MM-dd
  package_amount: number; // 패키지 정상 결제
  single_amount: number;  // 단건 정상 결제
  refund_amount: number;  // 환불 합 (양수)
}

export interface CategoryRow {
  category: string;       // heated_laser | unheated_laser | iv | preconditioning | <services.category>
  sessions: number;
  amount: number;
}

export interface ConsultantRow {
  consultant_id: string;
  name: string;
  ticketing_count: number;
  package_count: number;
  // T-20260717-foot-CONSULTANT-ARPU-STATS (AC6): 상담(내원)고객당 ARPU.
  //   avg_amount = total_amount ÷ consulted_customer_count (distinct 상담고객, checked_in_at 축).
  //   분모=0(매출귀속만·기간상담 0) → RPC 가 NULL 반환 → 화면 '-' 표시.
  //   ※ 분자(total_amount)는 accounting_date 축(dual-axis grain, 의도된 설계 — 오독 금지).
  avg_amount: number | null;
  // T-20260622-foot-SALES-STATS-TAB-EXPORT-LEADREVENUE: 실장별 총 매출액(SUM(rev), net·accounting_date).
  // 옵셔널: 구버전 RPC(total_amount 미반환) 배포 타이밍 대비 fallback 유지.
  total_amount?: number;
  // T-20260717-foot-CONSULTANT-ARPU-STATS (AC6): distinct 상담(내원)고객 수(객단가 분모).
  //   노쇼·예약only 제외 · 결제여부 무관 · 동일고객 다회상담 = 1. 옵셔널(구버전 RPC 대비).
  consulted_customer_count?: number;
}

export interface NoshowReturningRow {
  dt: string;
  noshow_rate: number;     // 0~100
  returning_rate: number;  // 0~100
}

// ─── T-20260607-foot-THERAPIST-STATS: 치료사 기준 통계 ───
export interface TherapistSummaryRow {
  therapist_id: string;
  name: string;
  treatment_count: number;             // 치료시간 산출 가능 건수
  avg_treatment_minutes: number | null; // 평균 치료시간(분). 데이터 없으면 null
  experience_total: number;            // 체험 내원 건수
  experience_converted: number;        // 패키지 결제 전환 건수
  conversion_rate: number | null;      // 0~100. experience_total=0 이면 null
  // T-20260607-foot-CHECKIN-DESIGNATED-FLAG (옵션 B): check_ins.therapist_id == customers.designated_therapist_id
  designated_count: number;            // 지정 일치 check_in 수(분자)
  total_checkin_count: number;         // 전체 check_in 수(분모)
  designated_rate: number | null;      // 0~100. total_checkin_count=0 이면 null
}

// T-20260607-foot-THERAPIST-STATS-V2: 자유텍스트 service_name → 4종 분류(treatment_type)
// cnt=차감건수(분포), linked_count=시간산출 매칭건수, avg_minutes=시술별 평균소요시간(linked, null 가능)
export interface TherapistServiceRow {
  therapist_id: string;
  name: string;
  treatment_type: string;        // 비가열 / 가열 / 포돌로게 / Re:Born
  cnt: number;                   // 차감 건수
  linked_count: number;          // 시간 산출된 매칭 건수
  avg_minutes: number | null;    // 시술별 평균 소요시간(분). 매칭 없으면 null
}

// T-20260804-foot-SALESSTAT-DATEFILTER-PRESETS: '지난달'(직전 달 1일~말일) 프리셋 추가.
export type StatsRangePreset = 'today' | 'week' | 'month' | 'lastMonth' | 'custom';

/**
 * T-20260609-foot-THERAPIST-STATS-LOAD-FAIL (AC-3): 통계 로드 에러 가시성 보강.
 * supabase-js 의 PostgrestError 는 Error 인스턴스가 아니라 plain object 라서
 * `e instanceof Error` 분기에서 누락 → 현장은 generic '통계 불러오기 실패'만 보고
 * 원인(HTTP/PostgREST code·message·hint)을 못 봤다. 이 헬퍼로 raw 원인을 사람이
 * 읽을 수 있는 1줄로 환원하고, 콘솔에는 원본 객체를 통째로 남긴다.
 */
export function describeStatsError(e: unknown): string {
  // PostgrestError 형태: { message, code, details, hint }
  if (e && typeof e === 'object') {
    const pg = e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts: string[] = [];
    if (typeof pg.message === 'string' && pg.message) parts.push(pg.message);
    if (typeof pg.code === 'string' && pg.code) parts.push(`code=${pg.code}`);
    if (typeof pg.hint === 'string' && pg.hint) parts.push(`hint=${pg.hint}`);
    if (parts.length) return parts.join(' · ');
  }
  if (e instanceof Error && e.message) return e.message;
  return '통계 불러오기 실패';
}

/** 한국시간 기준 기간 계산. ISO yyyy-MM-dd 반환. */
export function resolveRange(
  preset: StatsRangePreset,
  customFrom?: string,
  customTo?: string,
): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  if (preset === 'custom' && customFrom && customTo) {
    return { from: customFrom, to: customTo };
  }

  const to = fmt(today);
  if (preset === 'today') {
    return { from: to, to };
  }
  if (preset === 'week') {
    // 이번 주(월요일 시작) ~ 오늘
    const day = today.getDay(); // 0=일,1=월,...
    const diffToMon = (day + 6) % 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMon);
    return { from: fmt(monday), to };
  }
  if (preset === 'lastMonth') {
    // 직전 달 1일 ~ 직전 달 말일. month−1(=이전달 1일), day 0(=당월 0일=이전달 말일).
    // JS Date가 연초 경계(1월→전년12월)와 말일(28/29/30/31·윤년)을 자동 계산.
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: fmt(first), to: fmt(last) };
  }
  // month
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: fmt(first), to };
}

export async function fetchRevenue(
  clinicId: string,
  from: string,
  to: string,
): Promise<RevenueRow[]> {
  const { data, error } = await supabase.rpc('foot_stats_revenue', {
    p_clinic_id: clinicId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return (data ?? []) as RevenueRow[];
}

export async function fetchCategoryRevenue(
  clinicId: string,
  from: string,
  to: string,
): Promise<CategoryRow[]> {
  const { data, error } = await supabase.rpc('foot_stats_by_category', {
    p_clinic_id: clinicId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return (data ?? []) as CategoryRow[];
}

export async function fetchConsultantPerf(
  clinicId: string,
  from: string,
  to: string,
): Promise<ConsultantRow[]> {
  // T-20260726-foot-CRM-ASSIGN-RANKING-TAB-ADMINLOCK §2 (서버사이드 no-read-up):
  //   진입점을 admin-gated SECDEF 래퍼 `foot_stats_consultant_admin` 로 교체(DA Opt A).
  //   래퍼가 is_admin_or_manager() fail-closed(42501) 게이트 → 비admin(consultant/coordinator/
  //   therapist/tm/staff)은 서버에서 거부(빈 응답 아님). 구 `foot_stats_consultant` 는 authenticated
  //   EXECUTE 회수됨(직접 호출 불가) → 본 함수(fetchConsultantPerf)가 유일 소비 경로.
  //   ⚠ 소비자 모두 특권 게이트: Stats 매출탭(route admin/manager/director/tm — tm 은 매출탭 미접근)
  //      + Assignments 랭킹탭(canViewRanking=admin/manager/director). 정당 소비자는 전부 게이트 통과.
  const { data, error } = await supabase.rpc('foot_stats_consultant_admin', {
    p_clinic_id: clinicId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  const rows = (data ?? []) as ConsultantRow[];

  // T-20260726-foot-CRM-ASSIGN-RANKING-FIX-R1 (결함1): 재직 실장만 랭킹 대상.
  //   canonical RPC(foot_stats_consultant) staff join 은 clinic+role='consultant' 로만 좁혀
  //   active(재직) 술어가 없어 퇴사 상담실장(active=false)이 랭킹에 노출됨(field-soak, 김수린·이승은).
  //   무-DDL(db_change=false) 유지 위해 RPC 를 고치지 않고 read-side 에서 재직 필터를 교정한다.
  //   재직 판정 소스 = staff.active(기존 컬럼). 조회 실패(빈/에러) 시 fail-open(회귀0: 기존 표시 유지).
  //   ★ 매출 계산·귀속(assigned_consultant_id) 무접촉 — 표시 모수만 재직으로 제한(read-only).
  if (rows.length === 0) return rows;
  try {
    const { data: staffRows, error: sErr } = await supabase
      .from('staff')
      .select('id, active')
      .eq('clinic_id', clinicId)
      .eq('role', 'consultant');
    if (sErr || !staffRows) return rows; // fail-open: 재직 판정 불가 시 기존 결과 유지
    // 명시적 active=false(퇴사) 만 제외. active=true/null(미상)은 보존(재직 기준·과필터 방지).
    const retiredIds = new Set(
      (staffRows as { id: string; active: boolean | null }[])
        .filter((s) => s.active === false)
        .map((s) => s.id),
    );
    if (retiredIds.size === 0) return rows;
    return rows.filter((r) => !retiredIds.has(r.consultant_id));
  } catch {
    return rows; // fail-open
  }
}

// ─── T-20260807-foot-RANKING-STAFFATTR-CONSULTANT-TO-STAFF ──────────────────────
//   랭킹 탭(실장별 월매출) 귀속축을 consultant(check_ins.consultant_id 최근접 상담사) →
//   customers.assigned_staff_id('2번차트 담당 실장' = 고객 카드 담당자)로 교체.
//   canonical: '2번차트 담당자' = customers.assigned_staff_id
//   (T-20260806-foot-SALESDOCTOR-COLUMN-REBUILD-4COL, 2026-08-06 17:30 김주연 총괄 확정).
//
//   ★ 왜 RPC(foot_stats_consultant) 를 안 고치고 FE 신규 집계인가 (db_change=false, path a):
//     foot_stats_consultant(_admin) RPC 는 통계>매출탭 '상담실장 티켓팅 실적'(Stats.tsx ConsultantSection)
//     과 공유된다. 그 surface 는 티켓팅 카운트·상담고객수 등 '상담한 사람(consultant)' 개념이 본질이라
//     RPC body 의 귀속축을 staff 로 바꾸면 통계 매출탭이 회귀(축 혼재)한다. 따라서 RPC 는 무접촉하고,
//     랭킹 탭 전용 FE 집계 helper 를 신설해 Assignments 랭킹 소비경로에서만 이 helper 로 교체한다.
//     (SALESDOCTOR-4COL 선례 = 매출집계>담당실장별 탭도 동일하게 FE 에서 assigned_staff_id 집계, no-DDL.)
//
//   ★ 귀속 산식 = 매출집계>담당실장별(SalesDoctorTab)와 동일 축(AC-2):
//     customers.assigned_staff_id 로 결제행(단건 payments + 패키지 package_payments)을 net 귀속.
//     net = payment − refund (accounting_date 윈도우). 랭킹은 net(환불 차감 후) — AC-3 net/gross 무접촉.
//     (누적매출 탭은 gross 이지만 그것은 net/gross 직교축이라 본 티켓 무대상 — 귀속 대상[WHO]만 일치.)
//
//   ★ 로스터/모수 정책 (AC-4):
//     · 랭킹 = '재직 상담 실장' leaderboard(카드 부제 그대로) → roster = 재직 상담사(staff.role='consultant',
//       active≠false). 배정비율(rankAssignmentRatios)·일일 배정 목표가 상담실장 대상이라 로스터 유지.
//     · assigned_staff_id 가 상담실장이 아닌 스태프(코디네이터 '데스크' 등)이거나 NULL(미배정)인 매출은
//       실장 랭킹 모수에서 제외(랭킹은 상담실장 순위표 — 미배정/비상담직 매출은 순위 대상 아님).
//       prod 실측(2026-07): 미배정 net ≈ 563K / 292 결제고객 中 11명, 코디 귀속(데스크) 존재 → 랭킹서 제외.
//       ※ 귀속 '축'은 매출집계와 동일(assigned_staff_id) — 로스터만 상담실장으로 좁힘(축 발산 아님, AC-2 충족).
//     · 시뮬레이션(is_simulation=true) 고객 결제 제외 — 매출집계>담당실장별과 동일 방어필터(테스트 오염 차단).
//
//   ★ 반환형 = ConsultantRow(기존과 byte-호환) → 랭킹 machinery(정렬/변동표/배정비율) 무변경 재사용:
//     · consultant_id = assigned_staff_id(=staff.id, 상담실장) · name = staff.name
//     · total_amount  = 담당 고객 net 매출 합 · consulted_customer_count = 담당 결제고객 distinct 수
//     · avg_amount    = round(total_amount / 담당 결제고객수) 또는 null(0명) — 객단가 열도 동일 staff 축.
//     · ticketing_count/package_count = 0(랭킹 탭 미표시 컬럼 — 통계 매출탭 전용, 여기선 파생 안 함).
//   READ-ONLY. 신규 컬럼/테이블/enum 0. db_change=false (autonomy §S2.4 데이터정책 게이트 비유발).
export async function fetchConsultantPerfByAssignedStaff(
  clinicId: string,
  from: string,
  to: string,
): Promise<ConsultantRow[]> {
  // 1. 결제행: 단건(payments) + 패키지(package_payments). accounting_date 윈도우.
  //    단건은 status='deleted' 제외(삭제 결제 미집계) — 매출집계>담당실장별과 동일.
  const [{ data: payData, error: payErr }, { data: pkgData, error: pkgErr }] = await Promise.all([
    supabase
      .from('payments')
      .select('amount, payment_type, customer_id')
      .eq('clinic_id', clinicId)
      .not('status', 'eq', 'deleted')
      .gte('accounting_date', from)
      .lte('accounting_date', to),
    supabase
      .from('package_payments')
      .select('amount, payment_type, customer_id')
      .eq('clinic_id', clinicId)
      .gte('accounting_date', from)
      .lte('accounting_date', to),
  ]);
  if (payErr) throw payErr;
  if (pkgErr) throw pkgErr;

  // 2. 시뮬레이션 고객 결제 제외(매출집계>담당실장별과 동일 방어필터). 워크인(customer_id NULL) 보존.
  const simIds = await getSimulationCustomerIds(clinicId);
  const singlePayments = excludeSimulationPaymentRows(
    (payData ?? []) as { amount: number; payment_type: string | null; customer_id: string | null }[],
    simIds,
  );
  const pkgPayments = excludeSimulationPaymentRows(
    (pkgData ?? []) as { amount: number; payment_type: string | null; customer_id: string | null }[],
    simIds,
  );

  // 3. 결제고객 → assigned_staff_id('2번차트 담당자'). customer_id NULL/미배정은 귀속 불가 → 랭킹 제외.
  const custIds = [
    ...new Set(
      [
        ...singlePayments.map((r) => r.customer_id),
        ...pkgPayments.map((r) => r.customer_id),
      ].filter(Boolean) as string[],
    ),
  ];
  const custStaff = new Map<string, string>(); // customer_id → assigned_staff_id
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

  // 4. 로스터 = 재직 상담사(role='consultant', active≠false). 랭킹은 '재직 상담 실장' leaderboard.
  //    명시 active=false(퇴사)만 제외(active true/null=재직 유지, fetchConsultantPerf read-side 필터와 동일 규약).
  const { data: staffRows, error: staffErr } = await supabase
    .from('staff')
    .select('id, name, role, active')
    .eq('clinic_id', clinicId)
    .eq('role', 'consultant');
  if (staffErr) throw staffErr;
  const rosterName = new Map<string, string>();
  for (const s of (staffRows ?? []) as { id: string; name: string; active: boolean | null }[]) {
    if (s.active === false) continue; // 명시 퇴사 제외
    rosterName.set(s.id, s.name);
  }

  // 5. assigned_staff_id 로 net 귀속. 로스터(재직 상담실장)에 속한 staff 만 집계(비상담직/미배정 매출 제외).
  const net = new Map<string, number>(); // staffId → net 매출
  const custSet = new Map<string, Set<string>>(); // staffId → distinct 결제고객
  const accrue = (customerId: string | null, amount: number) => {
    if (!customerId) return; // 워크인(고객 미지정) → 귀속 불가, 랭킹 제외
    const staffId = custStaff.get(customerId);
    if (!staffId || !rosterName.has(staffId)) return; // 미배정 or 비상담실장 → 랭킹 제외
    net.set(staffId, (net.get(staffId) ?? 0) + amount);
    if (!custSet.has(staffId)) custSet.set(staffId, new Set());
    custSet.get(staffId)!.add(customerId);
  };
  for (const p of singlePayments) {
    accrue(p.customer_id, (p.payment_type === 'refund' ? -1 : 1) * (p.amount ?? 0));
  }
  for (const pp of pkgPayments) {
    accrue(pp.customer_id, (pp.payment_type === 'refund' ? -1 : 1) * (pp.amount ?? 0));
  }

  // 6. ConsultantRow[] 로 shape (기존 랭킹 machinery 재사용). 매출귀속된 상담실장만 반환.
  const rows: ConsultantRow[] = [];
  for (const [staffId, total] of net.entries()) {
    const custCount = custSet.get(staffId)?.size ?? 0;
    rows.push({
      consultant_id: staffId,
      name: rosterName.get(staffId) ?? '—',
      ticketing_count: 0,
      package_count: 0,
      avg_amount: custCount > 0 ? Math.round(total / custCount) : null,
      total_amount: total,
      consulted_customer_count: custCount,
    });
  }
  return rows;
}

export async function fetchNoshowReturning(
  clinicId: string,
  from: string,
  to: string,
): Promise<NoshowReturningRow[]> {
  const { data, error } = await supabase.rpc('foot_stats_noshow_returning', {
    p_clinic_id: clinicId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return (data ?? []) as NoshowReturningRow[];
}

export async function fetchTherapistSummary(
  clinicId: string,
  from: string,
  to: string,
): Promise<TherapistSummaryRow[]> {
  const { data, error } = await supabase.rpc('foot_stats_therapist_summary', {
    p_clinic_id: clinicId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return (data ?? []) as TherapistSummaryRow[];
}

export async function fetchTherapistServices(
  clinicId: string,
  from: string,
  to: string,
): Promise<TherapistServiceRow[]> {
  const { data, error } = await supabase.rpc('foot_stats_therapist_services', {
    p_clinic_id: clinicId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return (data ?? []) as TherapistServiceRow[];
}

// ─── T-20260708-foot-PKGSTATS-DIRECTINPUT-TREATTYPE-REFPRICE: 패키지 통계(B안) ───
// 실장별 할인율 + 시술유형별 평균 객단가. packages grain. 매출 SSOT 무접촉(내부 통계표시 전용).

export interface PkgDiscountConsultantRow {
  consultant_id: string;
  name: string;
  pkg_count: number;               // 귀속 패키지 수(기준정가 유무 무관)
  discount_pkg_count: number;      // 기준정가 있는 패키지 수(할인율 분모)
  avg_discount_rate: number | null; // 0~1 비율. null=기준정가 있는 패키지 없음 → FE '-'
}

export interface PkgTreatmentAvgRow {
  treatment_type: string;          // 비가열 / 가열 / 포돌로게 / 수액 / Re:Born (저장 canonical)
  pkg_count: number;
  avg_amount: number;              // 평균 객단가(total_amount 평균)
}

export async function fetchPkgDiscountByConsultant(
  clinicId: string,
  from: string,
  to: string,
): Promise<PkgDiscountConsultantRow[]> {
  const { data, error } = await supabase.rpc('foot_stats_pkg_discount_by_consultant', {
    p_clinic_id: clinicId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return (data ?? []) as PkgDiscountConsultantRow[];
}

export async function fetchPkgAvgByTreatment(
  clinicId: string,
  from: string,
  to: string,
): Promise<PkgTreatmentAvgRow[]> {
  const { data, error } = await supabase.rpc('foot_stats_pkg_avg_by_treatment', {
    p_clinic_id: clinicId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return (data ?? []) as PkgTreatmentAvgRow[];
}

// ─────────────────────────────────────────────────────────────────────────
// T-20260610-foot-STATS-TM-AGGREGATE-TAB: TM집계
//
// 롱래CRM(happy-flow-queue) AdminStats TM 탭 산식을 SSOT로 차용한다.
// (참조: T-20260417-crm-TM-STATS-ACCESS / T-20260418-crm-TM-STYLE / T-20260417-crm-EXCEL-TM-COLUMN)
// 자체 산식 신규 정의 없음. 3개 지표 각각 다른 날짜 기준:
//   (A) 예약등록건수 = 기간 내 예약 추가 수      → reservations.created_at(KST)
//   (B) 예약수       = 기간 내 잡혀있는 예약(취소 포함) → reservations.reservation_date
//   (C) 내원건수     = 기간 내 실제 내원 수         → check_ins.created_date(KST 트리거)
//   내원률 = 내원수 ÷ 예약수
//
// 풋↔롱래 스키마 마이너 매핑(추정 아님, 컬럼 직역):
//   - TM(상담사) = reservations.created_by (풋=user_profiles.id UUID FK / 롱래=email|name)
//   - 내원 제외값: 롱래 check_ins.status='no_show' → 풋엔 no_show 없음 ∴ 'cancelled' 제외
//   - 채널(referral_source): 풋은 reservations에만 존재 → 내원의 matched 예약에서 역참조
//   - check_ins.created_by 없음 → 내원 TM 귀속은 matched reservation.created_by 사용(롱래도 동일 fallback)
// ─────────────────────────────────────────────────────────────────────────

export interface TmResRow {
  id: string;
  reservation_date: string;
  reservation_time: string | null;
  created_at: string | null;
  created_by: string | null;          // user_profiles.id (TM)
  status: string;
  referral_source: string | null;
  // T-20260630-foot-FOOTSTATS-COUNSELOR-NULL-DISPLAY (AC-1, read-only):
  //   도파민 ingest 예약 마커. 상담사(created_by) NULL/미매칭 행의 provenance 라벨 파생에만 사용.
  //   ⚠ 표시 전용 — 어떤 컬럼도 write 하지 않는다(NULL 유지 = 이중계상 방지 fail-closed).
  source_system: string | null;
  // T-20260702-foot-TMSTATS-DOPAMINE-REGISTRANT-MISSING (read-only):
  //   예약등록자 표시 스냅샷 = 예약관리 페이지 '등록자'의 SSOT(reservations.registrar_name).
  //   도파민/TM 경로 예약은 created_by=NULL(firewall §416)이라 created_by→직원명 resolve 실패 →
  //   TM집계에서 실제 등록자('진운선')가 안 보였음. 이 컬럼으로 예약관리와 동일하게 등록자명 표시.
  //   ⚠ 표시 전용 — created_by/인센티브 산식으로 승격 금지(§416 이중계상 격리 유지).
  registrar_name: string | null;
  customers?: { name: string | null; phone: string | null } | null;
}

export interface TmCheckInRow {
  id: string;
  reservation_id: string | null;
  created_date: string | null;        // KST 트리거 date 컬럼
  checked_in_at: string | null;
  status: string | null;
  customers?: { name: string | null } | null;
}

export interface TmStaffInfo {
  name: string;
  role: string;
}

export interface TmAggregateData {
  registered: TmResRow[];   // by created_at (등록일)
  scheduled: TmResRow[];    // by reservation_date (예약일)
  visited: TmCheckInRow[];  // by created_date (내원일), reservation_id 기준 dedup
  staffMap: Record<string, TmStaffInfo>; // user_profiles.id → {name, role}
}

// 롱래 dedupVisitedCI 차용: 동일 reservation_id 다건(consultation/done 등) → 1건만.
// 우선순위 done > 기타. reservation_id 없는 워크인은 각 row 유지.
function dedupVisited(rows: TmCheckInRow[]): TmCheckInRow[] {
  const resMap = new Map<string, TmCheckInRow>();
  const walkIns: TmCheckInRow[] = [];
  for (const row of rows) {
    if (!row.reservation_id) {
      walkIns.push(row);
    } else {
      const existing = resMap.get(row.reservation_id);
      if (!existing || row.status === 'done') resMap.set(row.reservation_id, row);
    }
  }
  return [...Array.from(resMap.values()), ...walkIns];
}

/**
 * TM집계 raw 데이터 + 직원(id→name·role) 맵 페치.
 * 집계 산식은 컴포넌트(TmAggregateSection)에서 롱래와 동일하게 수행한다(클라이언트 집계).
 * PostgREST 서버 max-rows=1000 cap 우회를 위해 cursor pagination(.range) 사용(롱래 패턴).
 */
export async function fetchTmAggregate(
  clinicId: string,
  from: string,
  to: string,
): Promise<TmAggregateData> {
  const PAGE_SIZE = 1000;

  const fetchAll = async <T,>(queryFn: (offset: number) => unknown): Promise<T[]> => {
    const all: T[] = [];
    let offset = 0;
    for (let page = 0; page < 30; page++) {
      const { data, error } = (await queryFn(offset)) as { data: T[] | null; error: unknown };
      if (error) throw error;
      const rows = data ?? [];
      all.push(...rows);
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return all;
  };

  const resSelect = 'id, reservation_date, reservation_time, created_at, created_by, status, referral_source, source_system, registrar_name, customers(name, phone)';

  const [registered, scheduled, visitedRaw, staffRows] = await Promise.all([
    // A: 예약등록건수 (created_at KST 경계 명시)
    fetchAll<TmResRow>((offset) => supabase.from('reservations')
      .select(resSelect)
      .eq('clinic_id', clinicId)
      .gte('created_at', `${from}T00:00:00+09:00`)
      .lte('created_at', `${to}T23:59:59+09:00`)
      .range(offset, offset + PAGE_SIZE - 1)),
    // B: 예약수 (reservation_date, 취소 포함)
    fetchAll<TmResRow>((offset) => supabase.from('reservations')
      .select(resSelect)
      .eq('clinic_id', clinicId)
      .gte('reservation_date', from).lte('reservation_date', to)
      .range(offset, offset + PAGE_SIZE - 1)),
    // C: 내원건수 (created_date, 'cancelled' 제외 = 롱래 no_show 등가물)
    fetchAll<TmCheckInRow>((offset) => supabase.from('check_ins')
      .select('id, reservation_id, created_date, checked_in_at, status, customers(name)')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null) // R2B soft-hide 제외 (내원건수 KPI)
      .neq('status', 'cancelled')
      .gte('created_date', from).lte('created_date', to)
      .range(offset, offset + PAGE_SIZE - 1)),
    // 직원 id→name·role (이름 표시 + TM팀만 필터용). active 한정.
    (async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, name, role')
        .eq('active', true);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string | null; role: string | null }>;
    })(),
  ]);

  const staffMap: Record<string, TmStaffInfo> = {};
  for (const s of staffRows) {
    if (s.id) staffMap[s.id] = { name: s.name ?? '', role: s.role ?? '' };
  }

  return {
    registered,
    scheduled,
    visited: dedupVisited(visitedRaw),
    staffMap,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// T-20260630-foot-FOOTSTATS-COUNSELOR-NULL-DISPLAY (AC-1) — TM상담사(등록자) 표시 라벨
//
// 도파민-출처(source_system='dopamine') 풋 예약은 풋 상담 전이라 상담사(reservations.created_by)가
// NULL인 게 설계상 정상(결함 아님). 통계 TM집계에서 이 NULL/미매칭 행을 바닥 '미지정'으로 뭉치면
// "직원이 배정을 누락한 것"처럼 오인됨 → provenance 라벨로 분리해 graceful 표시한다.
//
// ⚠ 급소 가드 (DA-20260630-FOOTPUSH-COUNSELOR-ATTRIBUTION / verdict NO-SCHEMA-CHANGE_GO):
//   본 함수는 순수 표시 라벨 파생이다 — created_by/consultant_id/cue_card owner 등 어떤 값도 write 하지 않는다.
//   '미지정'을 도파민 TM staff_id/리드 owner로 자동 스탬프해 "고치는" 행위 금지
//   (풋 상담사 인센티브 분모 오염 + 동일 매출 이중계상 + changed_by 네임스페이스 위반).
//   NULL 유지가 곧 이중계상 방지(fail-closed).
// ─────────────────────────────────────────────────────────────────────────
export const TM_UNASSIGNED_LABEL = '미지정';
export const TM_WALKIN_LABEL = '워크인';
export const TM_DOPAMINE_LABEL = '도파민/TM 유입 (상담사 미배정)';

/**
 * 예약의 TM상담사(등록자) 표시 라벨을 파생한다 (순수·read-only).
 * @param createdBy    reservations.created_by (user_profiles.id) 또는 null
 * @param sourceSystem reservations.source_system ('dopamine' 마커 등) 또는 null
 * @param staffName    createdBy 가 풋 직원에 매칭될 때의 이름(staffMap[uid]?.name) — 미매칭이면 null/undefined
 * @param registrarName reservations.registrar_name (예약관리 '등록자'의 SSOT 스냅샷) 또는 null
 *
 * T-20260702-foot-TMSTATS-DOPAMINE-REGISTRANT-MISSING:
 *   도파민/TM 경로 예약은 created_by=NULL(firewall §416)이라 (1)번 직원명 resolve 실패.
 *   예약관리 페이지는 registrar_name 스냅샷으로 '진운선'을 표시하는데 TM집계는 이 축을 안 봐서
 *   등록자명이 안 보였다. (2)번으로 registrar_name 을 예약관리와 동일 SSOT로 표시한다.
 *   ⚠ 직접등록 예약은 (1)번(직원명)에서 이미 잡혀 동작 불변 — 회귀 0. registrar_name 은 표시 전용,
 *      created_by/집계 귀속/인센티브 산식으로 승격하지 않는다(§416 이중계상 격리 유지).
 */
export function tmCounselorLabel(
  createdBy: string | null | undefined,
  sourceSystem: string | null | undefined,
  staffName: string | null | undefined,
  registrarName?: string | null | undefined,
): string {
  if (createdBy && staffName) return staffName;            // (1) 풋 직원이 등록 → 직원명 (직접등록 불변)
  const rn = (registrarName ?? '').trim();
  if (rn) return rn;                                        // (2) 예약등록자 스냅샷(=예약관리 '등록자') → '진운선' 등
  if ((sourceSystem ?? '').trim() === 'dopamine') return TM_DOPAMINE_LABEL; // (3) 스냅샷도 없는 도파민 유입 → provenance
  return TM_UNASSIGNED_LABEL;                              // (4) 그 외 NULL/미매칭 → 미지정
}

// ─────────────────────────────────────────────────────────────────────────
// T-20260702-foot-TMSTATS-TEAMFILTER-ROLE — "TM팀만" 필터 SSOT
//
// "TM팀만" = 계정관리(user_profiles) role='tm' 계정만. 판정축을 TM집계 표시 라벨
// (tmCounselorLabel 결과)과 동일하게 맞춰 필터·결과·집계 3자를 일치시킨다.
//   · 기존: created_by 단일축(isTm(uid)) 판정 → 풋 TM팀 예약은 registrar_name 경로로 귀속돼
//     created_by=데스크(admin/coordinator)라 TM 전건 누락(오집계). 반대로 데스크 계정이 그대로
//     남아 "role≠TM 계정 포함"으로 보였다.
//   · 정정: staffMap 에서 role='tm' 계정명 집합을 만들고, 표시 라벨(직원명·registrar_name)이
//     그 집합에 들면 TM으로 판정. role 소스 = user_profiles.role (계약 v1.0 §2-3 enum 'tm';
//     user_roles flip 은 게이트 SEQUENCED, 현행 소스 유지).
// ⛔ 순수 함수 — read-only. 어떤 값도 write/승격하지 않는다.
// ─────────────────────────────────────────────────────────────────────────
export function tmRoleNames(staffMap: Record<string, TmStaffInfo>): Set<string> {
  const s = new Set<string>();
  for (const info of Object.values(staffMap ?? {})) {
    if (info && info.role === 'tm' && info.name) s.add(info.name);
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────
// T-20260722-foot-TMAGG-REGISTRAR-AXIS-REPOINT — §963⑩(a) 집계/필터축 정규화
//
// cross_crm_data_contract §963⑩(a) HARD INVARIANT (DA-decision 20260722, foot 동형 전파):
//   registrar_name = 수동편집 가능한 display SoT. 이를 TM집계 grouping key 또는 "TM팀만"
//   필터 inclusion 판정축으로 쓰면 "편집이 count 버킷을 이동시키는 비결정 집계" + created_by와
//   발산하는 제2 attribution 축 재구성 → §963⑥/⑧b/§968④ 위반.
//   ∴ grouping/필터축 = 정규 귀속 identity(reservations.created_by)로 repoint.
//      dopamine-origin(created_by=NULL, §416 firewall) = 단일 provenance 버킷('도파민 등록').
//      registrar_name = 화면 label 표시로만(tmCounselorLabel) — 집계/필터축 절대 미참여.
//
// ⚠ 구 tmRoleNames(위) = 표시라벨(registrar_name-aware) 집합 → 필터 inclusion 판정축 사용 금지.
//   label 표시 helper 로만 존치(§963⑩(a) 위반 재발 방지). tmRoleIds 는 registrar_name 미참여(구조적 차단 유지).
//
// ─────────────────────────────────────────────────────────────────────────
// [CEO-GATED CARVE-OUT] T-20260723-foot-TMAGG-DOPAMINE-REGISTRARNAME-DISPLAYBUCKET-VARIANT
//   (CEO 대표게이트 통과 2026-07-24 + DA CONVENE GO: Q1 firewall=ACCEPT-CONDITIONAL / Q2 variant=SAFE,
//    consult_ref DA-20260724-foot-TMAGG-PERNAME-FIREWALL-VARIANT-CONVENE)
//
//   dopamine 파티션(created_by=NULL AND source_system='dopamine')에 한해 tmAttributionKey 가
//   registrar_name 을 **display 버킷 분할**용으로만 인자로 받는다. 이것은 위 REPOINT HARD INVARIANT 의
//   전면 해제가 아니라 dopamine 파티션 한정 카브아웃이다:
//     · native(created_by≠NULL) 행은 REPOINT AC4 STAYS — created_by canonical grouping, registrar_name 미참여.
//     · dopamine + registrar_name 有 → { key: 'dop:{registrar_name}', label: registrar_name } display 버킷.
//     · dopamine + registrar_name NULL → 기존 '__dopamine__' 단일버킷 fallback.
//   ⚠ HARD incentive-inert (AC3): dop:* 버킷은 TM집계 COUNT display grouping 전용. created_by 는 NULL 유지 —
//     매출/인센티브/funnel/attribution 어느 measure 에도 입력 금지(§416 firewall 무접촉, counselor_incentive §1 무유입).
//   ⚠ name-keyed display best-effort (AC5): dop:{registrar_name} 는 canonical attribution 이 아니다.
//     동명이인 병합·coordinator↑ 편집에 의한 재분류는 알려진 display caveat(escalation 아님, leg-ii 잔여 리스크).
//   ⚠ 승격 금지 가드 (AC6): registrar_name 을 이 COUNT 표 밖(매출/인센티브/attribution/funnel)으로 확산 금지.
//     안정 per-name identity 가 필요해지면 registrar_name 승격이 아니라 §963⑩(a) 원 P1(emit-side opaque
//     provenance key)로만 확장한다.
// ─────────────────────────────────────────────────────────────────────────

/** dopamine-origin(created_by=NULL) TM집계 단일 버킷 라벨 (AC3). */
export const TM_DOPAMINE_BUCKET = '도파민 등록';

/**
 * TM집계 grouping key — 정규 귀속키(편집-inert).
 *   - created_by 매칭 직원        → { key: 'staff:<uid>', label: 직원명 }   (native, REPOINT AC4 STAYS)
 *   - created_by=NULL + dopamine + registrar_name 有 → { key: 'dop:<registrar_name>', label: registrar_name }
 *       ★ CEO-GATED CARVE-OUT (VARIANT AC1) — dopamine 파티션 한정 display best-effort 버킷 (위 주석블록 참조).
 *   - created_by=NULL + dopamine + registrar_name NULL → { key: '__dopamine__', label: '도파민 등록' }  (fallback)
 *   - created_by=NULL + 그 외      → { key: '__unassigned__', label: '미지정' }
 *   - created_by 있으나 미매칭(비활성 등) → { key: 'staff:<uid>', label: '미지정' }
 *
 * @param registrarName reservations.registrar_name — **dopamine 파티션 display 버킷 분할 전용**.
 *   native(created_by 有) grouping 에는 절대 영향 없음(첫 분기에서 이미 반환). COUNT display grouping 밖으로
 *   승격 금지(VARIANT AC3/AC6). name-keyed display best-effort — canonical attribution 아님(AC5).
 * @returns key=집계 병합 키(안정·비편집), label=화면 표시명
 */
export function tmAttributionKey(
  createdBy: string | null | undefined,
  sourceSystem: string | null | undefined,
  staffName: string | null | undefined,
  registrarName?: string | null | undefined,
): { key: string; label: string } {
  if (createdBy) {
    // native(로컬 스태프) — created_by canonical grouping. registrar_name 미참여(REPOINT AC4 STAYS, VARIANT AC2).
    return { key: `staff:${createdBy}`, label: (staffName ?? '').trim() || TM_UNASSIGNED_LABEL };
  }
  if ((sourceSystem ?? '').trim() === 'dopamine') {
    // [CEO-GATED CARVE-OUT] dopamine 파티션 한정 per-name display 버킷 (VARIANT AC1).
    //   created_by 는 여전히 NULL — 이 key 는 COUNT display grouping 전용, incentive/attribution 무유입(AC3).
    const rn = (registrarName ?? '').trim();
    if (rn) {
      return { key: `dop:${rn}`, label: rn };   // display best-effort (AC5). 동명이인 conflation 은 알려진 caveat.
    }
    return { key: '__dopamine__', label: TM_DOPAMINE_BUCKET };   // registrar_name NULL → 단일버킷 fallback (AC1)
  }
  return { key: '__unassigned__', label: TM_UNASSIGNED_LABEL };
}

/**
 * "TM팀만" 필터축 = 정규 귀속 identity(created_by) 기준 role='tm' user_profiles.id 집합 (AC2).
 * 구 tmRoleNames(표시라벨=registrar_name-aware 매칭축)은 §963⑩(a) 위반이라 필터 inclusion 에서 제거.
 * dopamine-origin(created_by=NULL)은 풋 계정이 없어 자동 제외(도파민 개별 귀속=도파민 자체 stats 소관).
 * ⛔ 순수 함수 read-only.
 */
export function tmRoleIds(staffMap: Record<string, TmStaffInfo>): Set<string> {
  const s = new Set<string>();
  for (const [id, info] of Object.entries(staffMap ?? {})) {
    if (id && info && info.role === 'tm') s.add(id);
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────
// T-20260723-foot-STAT-NAEWON-TAB: 내원 통계 (방문경로별 내원 건수) — 조회 전용(READ-ONLY)
//
// grain(티켓 CONFLICT-DETAIL 사전 확정): "내원 1건 = 방문 완료 예약 1건"(예약 grain).
//   ∴ 집계 소스 = reservations.visit_route (예약경로). customers.visit_route 는 always-sync 되는
//   동일 축이나 본 통계는 예약 grain이므로 reservations 를 본다.
// 방문 완료 정의(STEP1 #5, 매출 통계와 동일 제외조건): status='checked_in'(체크인=내원완료).
//   'cancelled'(취소)·'no_show'(노쇼) 제외.
// 날짜 축: reservation_date(예약일) — 예약관리 화면과 동일 축(AC "1일 건수 = 예약관리 방문완료 건수" 정합).
// ⚠ SELECT 전용 — 어떤 write 도 하지 않는다(db_change=false). 신규 RPC/VIEW 추가 없음
//   (STATS-RPC anon revoke sweep 정책 무접촉). 방문경로 값 하드코딩 없음 — 집계는 실제 데이터값 기준,
//   렌더 목록은 드롭다운 SSOT(VISIT_ROUTE_OPTIONS)에서 동적 생성(컴포넌트 측).
// 지점 스코프: .eq('clinic_id', clinicId) — 기존 통계와 동일.
// PostgREST max-rows=1000 cap 우회 = cursor pagination(.range), TM집계 패턴 재사용.
// ─────────────────────────────────────────────────────────────────────────
export interface VisitRouteResvRow {
  id: string;
  reservation_date: string;      // yyyy-MM-dd (예약일)
  visit_route: string | null;    // 방문경로(예약경로). NULL/빈값 = 미입력
  status: string;
  // T-20260807-foot-CONSULTASSIGN-TRIAL-EXCL-CHART2 (김주연 총괄): 체험단 전용 마커. true = 2번 유입경로 차트에서
  //   방문경로와 별개로 [체험단] 카테고리로 분류(Stream B). canonical inflow_channel(§36 방화벽)와 직교 독립 축.
  is_trial?: boolean | null;
}

export async function fetchVisitRouteStats(
  clinicId: string,
  from: string,
  to: string,
): Promise<VisitRouteResvRow[]> {
  const PAGE_SIZE = 1000;
  const all: VisitRouteResvRow[] = [];
  let offset = 0;
  // T-20260807-foot-CONSULTASSIGN-TRIAL-EXCL-CHART2: is_trial 컬럼 미반영 DB(마이그 적용 랙) 대비 graceful.
  //   컬럼 부재(42703/PGRST) 감지 시 is_trial 제외 select 로 폴백 → [체험단] 0건이되 차트 자체는 정상 렌더.
  let selectCols = 'id, reservation_date, visit_route, status, is_trial';
  for (let page = 0; page < 30; page++) {
    let { data, error } = await supabase
      .from('reservations')
      .select(selectCols)
      .eq('clinic_id', clinicId)
      .eq('status', 'checked_in')                 // 방문 완료(체크인)만. 취소·노쇼 자동 제외.
      .gte('reservation_date', from)              // 시작일 당일 포함
      .lte('reservation_date', to)                // 종료일 당일 포함
      .range(offset, offset + PAGE_SIZE - 1);
    if (error && selectCols.includes('is_trial') &&
        (error.code === '42703' || error.code === 'PGRST204' || /is_trial/.test(error.message ?? ''))) {
      selectCols = 'id, reservation_date, visit_route, status';
      const retry = await supabase
        .from('reservations')
        .select(selectCols)
        .eq('clinic_id', clinicId)
        .eq('status', 'checked_in')
        .gte('reservation_date', from)
        .lte('reservation_date', to)
        .range(offset, offset + PAGE_SIZE - 1);
      data = retry.data;
      error = retry.error;
    }
    if (error) throw error;
    const rows = (data ?? []) as unknown as VisitRouteResvRow[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

// ─────────────────────────────────────────────────────────────────────────
// T-20260725-foot-STATS-CATEGORY-REVENUE-WHITELIST — 통계 > "시술 종류별 매출" 화이트리스트
//
// 통계 페이지(Stats.tsx → CategorySection)의 "2. 시술 종류별 매출" 섹션을 6개 화이트리스트
// 버킷으로만 표기한다. FE-only 표시 필터 — foot_stats_by_category RPC 무변경(no-DDL/no-schema).
// 매출 산식·집계 로직 불변, 표시 대상(버킷)만 필터한다.
//
// ── 매핑 SSOT (2026-07-25 prod 실측: foot_stats_by_category 방출 category 코드) ──
//   RPC 는 두 브랜치를 UNION 한다:
//     · pkg_created(패키지 생성 품목)  → 영문 코드: unheated_laser / heated_laser / podologue /
//                                        reborn / trial / preconditioning (iv 는 RPC 에서 이미 제외)
//     · single_paid(단건 결제)         → services.category 한글값: 풋케어 / 기본 / 검사 / 진료 /
//                                        풋화장품 / 처방약 / 상병 / 수액 / 기타 / 처방
//   6개 화이트리스트 라벨 ↔ 방출 코드 매핑 (매출집계 탭 SalesTreatmentTab 6버킷과 라벨 일치):
//     1) 비가열레이저            ← unheated_laser
//     2) 가열레이저              ← heated_laser
//     3) 포돌로게(내성)          ← podologue
//     4) Reborn(각질)           ← reborn
//     5) 풋화장품                ← 풋화장품(single_paid services.category)
//     6) 진찰료(기본/서류/검사비) ← 기본 · 검사 · 진료(single_paid services.category)
//   진찰료 버킷 = 기본(진찰료·처치+제증명 서류는 category='기본' 로 적재됨) + 검사(검사비) + 진료.
//     ※ 서류(제증명)는 services.category_label='제증명' 이나 category='기본' 이라 '기본' 코드에 이미 포함됨
//       (2026-07-25 실측 pair: '기본|제증명' 13건). RPC 는 category 만 방출하므로 '기본' 매칭으로 충분.
//
// ── KNOWN CAVEAT (표시 필터의 구조적 한계, planner/supervisor 인지용) ──
//   단건(single_paid) 풋케어 시술(비가열/가열/포돌로게/reborn 의 단건 결제분)은 services.category='풋케어'
//   단일값으로 적재돼 heated/unheated 로 분해 불가 → 화이트리스트 6버킷 어디에도 매칭 안 됨 → 숨김.
//   ⇒ 이 섹션의 레이저/포돌로게/Reborn 버킷은 사실상 '패키지 생성(pkg_created)분' 위주로 집계된다.
//     단건 풋케어를 버킷에 편입하려면 services.name 키워드 분해가 필요하고, 그건 RPC 변경(범위 밖)이다.
//     (매출집계 탭 SalesTreatmentTab 은 services.name 을 봐서 단건도 분해함 — 두 화면 산식이 원래 다른 축.)
//   ⇒ 산식 불변 · 표시 필터만. 단건 풋케어 편입 필요 시 별도 티켓(RPC/name 분해)로 재평가.
// ─────────────────────────────────────────────────────────────────────────

export interface CategoryBucket {
  /** 합성 버킷 코드(FE 내부 key). RPC 방출 코드와 충돌 방지 위해 'wl_' 접두. */
  code: string;
  label: string;
  /** 이 버킷에 편입되는 RPC 방출 category 코드(영문/한글) */
  members: string[];
}

/** 화이트리스트 6버킷 — 표시 순서·라벨 고정(매출집계 탭 SSOT 와 라벨 일치). */
export const CATEGORY_WHITELIST: CategoryBucket[] = [
  { code: 'wl_unheated',  label: '비가열레이저',            members: ['unheated_laser'] },
  { code: 'wl_heated',    label: '가열레이저',              members: ['heated_laser'] },
  { code: 'wl_podologue', label: '포돌로게(내성)',          members: ['podologue'] },
  { code: 'wl_reborn',    label: 'Reborn(각질)',           members: ['reborn'] },
  { code: 'wl_cosmetic',  label: '풋화장품',                members: ['풋화장품'] },
  { code: 'wl_consult',   label: '진찰료(기본/서류/검사비)', members: ['기본', '검사', '진료'] },
];

const WL_LABEL = new Map(CATEGORY_WHITELIST.map((b) => [b.code, b.label]));
const WL_MEMBER_TO_CODE = new Map<string, string>();
for (const b of CATEGORY_WHITELIST) {
  for (const m of b.members) WL_MEMBER_TO_CODE.set(m, b.code);
}

/**
 * foot_stats_by_category 결과 rows → 6 화이트리스트 버킷으로 집계(고정 순서).
 * 화이트리스트 외 category(풋케어·수액·처방약·상병·기타·처방·trial·preconditioning 등)는 제외(숨김).
 * '기타' 합산 버킷 없음. 매출 산식 불변 — 방출된 sessions/amount 를 버킷 단위로 합산만 한다(표시 필터).
 * 데이터가 없는 버킷은 결과에서 제외한다(빈 0원 행 미표기).
 */
export function applyCategoryWhitelist(rows: CategoryRow[]): CategoryRow[] {
  const agg = new Map<string, { sessions: number; amount: number }>();
  for (const r of rows ?? []) {
    const code = WL_MEMBER_TO_CODE.get(r.category);
    if (!code) continue; // 화이트리스트 외 → 숨김
    const cur = agg.get(code) ?? { sessions: 0, amount: 0 };
    cur.sessions += r.sessions ?? 0;
    cur.amount += r.amount ?? 0;
    agg.set(code, cur);
  }
  return CATEGORY_WHITELIST
    .filter((b) => agg.has(b.code))
    .map((b) => ({
      category: b.code,
      sessions: agg.get(b.code)!.sessions,
      amount: agg.get(b.code)!.amount,
    }));
}

/** 카테고리 코드 → 한국어 표시 */
export function categoryLabel(code: string): string {
  const wl = WL_LABEL.get(code);
  if (wl) return wl; // 화이트리스트 버킷 코드(wl_*) → 고정 라벨
  switch (code) {
    case 'heated_laser':     return '레이저(가온)';
    case 'unheated_laser':   return '레이저(비가온)';
    case 'iv':               return 'IV';
    case 'preconditioning':  return '프리컨디셔닝';
    case 'laser':            return '레이저(단건)';
    case 'consultation':     return '상담';
    case 'other':            return '기타';
    default:                 return code;
  }
}
