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
