import { supabase } from '@/lib/supabase';

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

export type StatsRangePreset = 'today' | 'week' | 'month' | 'custom';

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
  const { data, error } = await supabase.rpc('foot_stats_consultant', {
    p_clinic_id: clinicId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return (data ?? []) as ConsultantRow[];
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
// ⚠ tmAttributionKey/tmRoleIds 는 registrar_name 을 인자로도 받지 않는다(구조적 차단).
//   구 tmRoleNames(위) = 표시라벨(registrar_name-aware) 집합 → 필터 inclusion 판정축 사용 금지.
//   label 표시 helper 로만 존치(§963⑩(a) 위반 재발 방지).
// ─────────────────────────────────────────────────────────────────────────

/** dopamine-origin(created_by=NULL) TM집계 단일 버킷 라벨 (AC3). */
export const TM_DOPAMINE_BUCKET = '도파민 등록';

/**
 * TM집계 grouping key — 정규 귀속키(편집-inert). registrar_name 미참여(인자에도 없음).
 *   - created_by 매칭 직원        → { key: 'staff:<uid>', label: 직원명 }
 *   - created_by=NULL + dopamine  → { key: '__dopamine__',  label: '도파민 등록' }  (per-name 분해 금지, AC3)
 *   - created_by=NULL + 그 외      → { key: '__unassigned__', label: '미지정' }
 *   - created_by 있으나 미매칭(비활성 등) → { key: 'staff:<uid>', label: '미지정' }
 * @returns key=집계 병합 키(안정·비편집), label=화면 표시명
 */
export function tmAttributionKey(
  createdBy: string | null | undefined,
  sourceSystem: string | null | undefined,
  staffName: string | null | undefined,
): { key: string; label: string } {
  if (createdBy) {
    return { key: `staff:${createdBy}`, label: (staffName ?? '').trim() || TM_UNASSIGNED_LABEL };
  }
  if ((sourceSystem ?? '').trim() === 'dopamine') {
    return { key: '__dopamine__', label: TM_DOPAMINE_BUCKET };
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
}

export async function fetchVisitRouteStats(
  clinicId: string,
  from: string,
  to: string,
): Promise<VisitRouteResvRow[]> {
  const PAGE_SIZE = 1000;
  const all: VisitRouteResvRow[] = [];
  let offset = 0;
  for (let page = 0; page < 30; page++) {
    const { data, error } = await supabase
      .from('reservations')
      .select('id, reservation_date, visit_route, status')
      .eq('clinic_id', clinicId)
      .eq('status', 'checked_in')                 // 방문 완료(체크인)만. 취소·노쇼 자동 제외.
      .gte('reservation_date', from)              // 시작일 당일 포함
      .lte('reservation_date', to)                // 종료일 당일 포함
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as VisitRouteResvRow[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

/** 카테고리 코드 → 한국어 표시 */
export function categoryLabel(code: string): string {
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
