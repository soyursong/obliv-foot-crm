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
  avg_amount: number;
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

  const resSelect = 'id, reservation_date, reservation_time, created_at, created_by, status, referral_source, customers(name, phone)';

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
