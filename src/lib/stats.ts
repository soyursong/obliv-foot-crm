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

export type StatsRangePreset = 'today' | 'week' | 'month' | 'custom';

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
