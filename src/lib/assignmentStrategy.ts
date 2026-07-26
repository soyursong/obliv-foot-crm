/**
 * assignmentStrategy — 상담 자동배정 랭킹·전략 레이어 (T-20260726-foot-CRM-ASSIGN-V1)
 *
 * 기존 autoAssign 엔진(월균등 least-loaded, prod LIVE)을 비파괴 확장한다. 유입경로(lead_source)별
 * 정책이 설정돼 있을 때만 이 레이어가 상담사(consult) 선택을 담당하고, 미설정이면 null 을 반환해
 * 기존 월균등 경로로 자연 fallback(회귀0, opt-in).
 *
 * ── 실행1 랭킹 ──
 *   상담사 랭킹 = 월매출·주매출·객단가(payments 온디맨드 재계산) 가중합(기본 1:1:1). 물리 순위 저장 0.
 *   월/주 윈도우는 KST 날짜상대 → 자정 자연 롤오버 = '매일 자정 재계산'(W2: 자정 잡 없음).
 * ── 실행2 전략 ──
 *   daily_target  : Daily Target(1등=꼴등 2배=2:1, 중간 선형보간) 미달 우선. 잔여건 다음 등수 순서.
 *   ranking_pointer: 랭킹 포인터 순환(라운드로빈 금지). cursor 지속·일일 lazy 리셋.
 * ── 실행3 대상필터 ──
 *   후보 = staff.role='consultant' AND active AND auto_assign_enabled=true AND staff_attendance.status='present'(오늘 KST).
 * ── 조건① ──
 *   일일 배정건수 = assignment_actions count(*) 파생(to_staff_id, action_type IN auto_assign|manual, 오늘 KST). 물리 카운터 0.
 * ── 조건② RED LINE ──
 *   본 레이어는 check_ins.consultant_id 만 write 대상으로 반환할 뿐, customers.assigned_consultant_id 는 절대 접촉하지 않는다.
 *
 * best-effort: 어떤 조회 실패도 throw 하지 않음(빈/null 반환) → 배정 동선을 막지 않고 기존 경로로 fallback.
 */
import { supabase } from './supabase';
import { todaySeoulISODate } from './format';
import type {
  AssignLeadSource,
  AssignStrategy,
  AssignmentRankingWeights,
  AssignmentDailyTargetConfig,
} from './types';

// ── 축(axis, 한글) → 정책 lead_source(enum) 매핑 ─────────────────────────────────
const AXIS_TO_LEAD_SOURCE: Record<string, AssignLeadSource> = {
  TM: 'TM',
  인바운드: 'INBOUND',
  워크인: 'WALK_IN',
};

/** deriveConsultAxis 결과(TM|인바운드|워크인|returning) → 정책 enum. 재진/미상 = null(전략 미적용). */
export function mapAxisToLeadSource(axis: string | null | undefined): AssignLeadSource | null {
  if (!axis) return null;
  return AXIS_TO_LEAD_SOURCE[axis] ?? null;
}

// ── 실행1: 상담사 매출 지표 ───────────────────────────────────────────────────

export interface ConsultantRevenueMetric {
  revenueMonth: number;
  revenueWeek: number;
  /** 객단가 = 월매출 / 이달 담당 방문(check_in) 수. 방문 0이면 0. */
  avgTicket: number;
}

/** 이달 시작(KST) / 이번 주(월요일 00:00 KST) ISO timestamptz 경계 산출. tz-safe(UTC 요일 계산). */
export function seoulWindowBounds(todayIso: string): { monthStart: string; weekStart: string } {
  const monthStart = `${todayIso.slice(0, 7)}-01T00:00:00+09:00`;
  const [y, m, d] = todayIso.split('-').map((n) => parseInt(n, 10));
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일..6=토
  const backToMon = (dow + 6) % 7; // 월요일까지 되돌릴 일수
  const monDate = new Date(Date.UTC(y, m - 1, d - backToMon));
  const ws = `${monDate.getUTCFullYear()}-${String(monDate.getUTCMonth() + 1).padStart(2, '0')}-${String(
    monDate.getUTCDate(),
  ).padStart(2, '0')}`;
  return { monthStart, weekStart: `${ws}T00:00:00+09:00` };
}

/**
 * 상담사별 매출 지표(이달) 온디맨드 집계 — payments ⋈ check_ins.consultant_id.
 * status='active' & payment_type='payment' 만(취소·환불 제외). RLS(clinic-scoped)로 자연 격리.
 */
export async function fetchConsultantRevenueMetrics(
  clinicId: string,
): Promise<Map<string, ConsultantRevenueMetric>> {
  const out = new Map<string, ConsultantRevenueMetric>();
  try {
    const today = todaySeoulISODate();
    const { monthStart, weekStart } = seoulWindowBounds(today);
    const { data, error } = await supabase
      .from('payments')
      .select('amount, created_at, check_ins!inner(consultant_id)')
      .eq('clinic_id', clinicId)
      .eq('status', 'active')
      .eq('payment_type', 'payment')
      .gte('created_at', monthStart);
    if (error || !data) return out;

    // consultant_id → {월매출, 주매출, 이달 담당 check_in 집합(객단가 분모)}
    const visitSets = new Map<string, Set<string>>();
    for (const row of data as unknown[]) {
      const r = row as {
        amount: number | null;
        created_at: string;
        check_ins: { consultant_id: string | null } | { consultant_id: string | null }[] | null;
      };
      const ci = Array.isArray(r.check_ins) ? r.check_ins[0] : r.check_ins;
      const staffId = ci?.consultant_id ?? null;
      if (!staffId) continue;
      const amt = Number(r.amount ?? 0);
      const cur = out.get(staffId) ?? { revenueMonth: 0, revenueWeek: 0, avgTicket: 0 };
      cur.revenueMonth += amt;
      if (r.created_at >= weekStart) cur.revenueWeek += amt;
      out.set(staffId, cur);
      if (!visitSets.has(staffId)) visitSets.set(staffId, new Set());
      // check_in 단위 방문(객단가 분모) — check_ins embed 는 id 미포함이므로 created_at 근사 키 대신
      // consultant 별 payment 건수로 근사하지 않고, 별도 방문수는 아래 avgTicket 계산에서 payment 건수 사용.
    }
    // 객단가 = 월매출 / 이달 payment 건수(방문 근사). 건수 0 방지.
    const cntMap = new Map<string, number>();
    for (const row of data as unknown[]) {
      const r = row as { check_ins: { consultant_id: string | null } | { consultant_id: string | null }[] | null };
      const ci = Array.isArray(r.check_ins) ? r.check_ins[0] : r.check_ins;
      const staffId = ci?.consultant_id ?? null;
      if (!staffId) continue;
      cntMap.set(staffId, (cntMap.get(staffId) ?? 0) + 1);
    }
    for (const [staffId, met] of out) {
      const cnt = cntMap.get(staffId) ?? 0;
      met.avgTicket = cnt > 0 ? met.revenueMonth / cnt : 0;
    }
    return out;
  } catch {
    return out;
  }
}

// ── 실행1: 랭킹 산출(순수) ─────────────────────────────────────────────────────

/** 가중치(부재 시 1:1:1). */
export async function fetchRankingWeights(clinicId: string): Promise<AssignmentRankingWeights> {
  const dflt: AssignmentRankingWeights = {
    clinic_id: clinicId,
    weight_revenue_month: 1,
    weight_revenue_week: 1,
    weight_avg_ticket: 1,
  };
  try {
    const { data } = await supabase
      .from('assignment_ranking_weights')
      .select('clinic_id, weight_revenue_month, weight_revenue_week, weight_avg_ticket')
      .eq('clinic_id', clinicId)
      .maybeSingle();
    return (data as AssignmentRankingWeights) ?? dflt;
  } catch {
    return dflt;
  }
}

/**
 * 랭킹 산출(순수) — 후보 staffId 를 매출 가중합 내림차순으로 정렬해 1~N등 배열 반환.
 * 각 지표를 후보 풀 내 min-max 정규화([0,1]) 후 가중합 → 1:1:1 이 의미를 갖게 함(스케일 상이 보정).
 * 동점 tie-break: 월매출 desc → staffId asc(결정론적).
 */
export function computeRanking(
  candidateIds: string[],
  metrics: Map<string, ConsultantRevenueMetric>,
  weights: AssignmentRankingWeights,
): string[] {
  if (candidateIds.length <= 1) return [...candidateIds];
  const get = (id: string) => metrics.get(id) ?? { revenueMonth: 0, revenueWeek: 0, avgTicket: 0 };
  const norm = (vals: number[]) => {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min;
    return (v: number) => (span === 0 ? 0 : (v - min) / span);
  };
  const nMonth = norm(candidateIds.map((id) => get(id).revenueMonth));
  const nWeek = norm(candidateIds.map((id) => get(id).revenueWeek));
  const nAvg = norm(candidateIds.map((id) => get(id).avgTicket));
  const scored = candidateIds.map((id) => {
    const m = get(id);
    return {
      id,
      score:
        weights.weight_revenue_month * nMonth(m.revenueMonth) +
        weights.weight_revenue_week * nWeek(m.revenueWeek) +
        weights.weight_avg_ticket * nAvg(m.avgTicket),
      month: m.revenueMonth,
    };
  });
  scored.sort((a, b) => b.score - a.score || b.month - a.month || (a.id < b.id ? -1 : 1));
  return scored.map((s) => s.id);
}

// ── 실행2: Daily Target 보간(순수) ─────────────────────────────────────────────

/**
 * 랭킹순 배열 → staffId별 Daily Target. 1등=top, 꼴등=bottom, 중간 선형보간(반올림).
 * 2:1(top=bottom*2)은 DB CHECK+호출측이 보장. N=1 이면 top.
 */
export function interpolateDailyTargets(
  rankedIds: string[],
  top: number,
  bottom: number,
): Map<string, number> {
  const m = new Map<string, number>();
  const n = rankedIds.length;
  if (n === 0) return m;
  if (n === 1) {
    m.set(rankedIds[0], top);
    return m;
  }
  for (let i = 0; i < n; i++) {
    const t = top - ((top - bottom) * i) / (n - 1);
    m.set(rankedIds[i], Math.max(1, Math.round(t)));
  }
  return m;
}

/** Daily Target 설정(부재 시 null → daily_target 전략은 랭킹순 fallback). */
export async function fetchDailyTargetConfig(
  clinicId: string,
): Promise<AssignmentDailyTargetConfig | null> {
  try {
    const { data } = await supabase
      .from('assignment_daily_target_config')
      .select('clinic_id, top_rank_target, bottom_rank_target')
      .eq('clinic_id', clinicId)
      .maybeSingle();
    return (data as AssignmentDailyTargetConfig) ?? null;
  } catch {
    return null;
  }
}

/**
 * daily_target 선택(순수) — 미달 우선. score=오늘건수−목표 최소(음수=미달=우선), tie-break 랭킹 상위.
 * 전원 목표 도달 시에도 최소 초과분을 랭킹순으로 선택 → '잔여건 다음 등수 순서 배정' 충족.
 */
export function selectByDailyTarget(
  rankedIds: string[],
  targets: Map<string, number>,
  todayCounts: Map<string, number>,
): string | null {
  if (rankedIds.length === 0) return null;
  let bestId: string | null = null;
  let bestDeficit = Number.POSITIVE_INFINITY;
  let bestRank = Number.POSITIVE_INFINITY;
  for (let rank = 0; rank < rankedIds.length; rank++) {
    const id = rankedIds[rank];
    const target = targets.get(id) ?? Number.MAX_SAFE_INTEGER; // 목표 미설정=사실상 무한 여유(미달 우선)
    const cnt = todayCounts.get(id) ?? 0;
    const deficit = cnt - target; // 작을수록(더 미달) 우선
    if (deficit < bestDeficit || (deficit === bestDeficit && rank < bestRank)) {
      bestId = id;
      bestDeficit = deficit;
      bestRank = rank;
    }
  }
  return bestId;
}

// ── 실행2: 랭킹 포인터(순환) ───────────────────────────────────────────────────

/**
 * 포인터 read + lazy 일일 리셋 + 커서 선택 + advance(persist). 라운드로빈 금지 = 지속 커서 순환.
 * reset_date≠today(KST) 면 cursor←0 리셋(무-잡). 선택 = rankedIds[cursor % N], 이후 cursor+1 upsert.
 * best-effort: 실패해도 rankedIds[0] fallback(배정 진행).
 */
export async function pickByRankingPointer(
  clinicId: string,
  leadSource: AssignLeadSource,
  rankedIds: string[],
): Promise<string | null> {
  const n = rankedIds.length;
  if (n === 0) return null;
  const today = todaySeoulISODate();
  let cursor = 0;
  try {
    const { data } = await supabase
      .from('assignment_pointer_state')
      .select('cursor_rank, reset_date')
      .eq('clinic_id', clinicId)
      .eq('lead_source', leadSource)
      .maybeSingle();
    const row = data as { cursor_rank: number; reset_date: string | null } | null;
    // lazy 일일 리셋: reset_date 가 오늘이 아니면 0부터.
    cursor = row && row.reset_date === today ? row.cursor_rank : 0;
  } catch {
    cursor = 0;
  }
  const idx = ((cursor % n) + n) % n;
  const chosen = rankedIds[idx];
  // advance + persist(best-effort)
  try {
    await supabase.from('assignment_pointer_state').upsert(
      {
        clinic_id: clinicId,
        lead_source: leadSource,
        cursor_rank: idx + 1,
        reset_date: today,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'clinic_id,lead_source' },
    );
  } catch {
    /* best-effort: 커서 저장 실패해도 배정은 진행 */
  }
  return chosen;
}

// ── 실행2: 정책 ────────────────────────────────────────────────────────────────

/** 유입경로별 전략 맵(부재 = 미설정 → 전략 미적용). */
export async function fetchLeadSourcePolicy(
  clinicId: string,
): Promise<Map<AssignLeadSource, AssignStrategy>> {
  const m = new Map<AssignLeadSource, AssignStrategy>();
  try {
    const { data } = await supabase
      .from('assignment_leadsource_policy')
      .select('lead_source, strategy')
      .eq('clinic_id', clinicId);
    for (const r of (data ?? []) as { lead_source: AssignLeadSource; strategy: AssignStrategy }[]) {
      m.set(r.lead_source, r.strategy);
    }
    return m;
  } catch {
    return m;
  }
}

// ── 실행3: 후보 풀(출근 present + auto_assign_enabled + role=consultant) ─────────

/**
 * 오늘(KST) 자동배정 대상 상담사 id 집합.
 *   staff.role='consultant' AND active AND auto_assign_enabled=true
 *   ∩ staff_attendance(date=today, status='present').
 * graceful: 조회 실패/컬럼 부재 → 빈 배열(전략 미적용 → 기존 경로 fallback).
 */
export async function fetchPresentEnabledConsultants(clinicId: string): Promise<string[]> {
  try {
    const today = todaySeoulISODate();
    const [{ data: staffRows, error: sErr }, { data: attRows, error: aErr }] = await Promise.all([
      supabase
        .from('staff')
        .select('id, auto_assign_enabled')
        .eq('clinic_id', clinicId)
        .eq('active', true)
        .eq('role', 'consultant'),
      supabase
        .from('staff_attendance')
        .select('staff_id, status')
        .eq('clinic_id', clinicId)
        .eq('date', today)
        .eq('status', 'present'),
    ]);
    if (sErr || aErr || !staffRows || !attRows) return [];
    const presentIds = new Set(
      (attRows as { staff_id: string }[]).map((r) => r.staff_id),
    );
    return (staffRows as { id: string; auto_assign_enabled: boolean | null }[])
      .filter((s) => s.auto_assign_enabled !== false && presentIds.has(s.id))
      .map((s) => s.id);
  } catch {
    return [];
  }
}

// ── 조건①: 오늘 배정건수(파생 SSOT) ───────────────────────────────────────────

/**
 * 오늘(KST) staffId별 배정건수 = assignment_actions count(*)
 *   WHERE to_staff_id AND action_type IN (auto_assign, manual) AND created_at::date = today.
 * 물리 카운터 없음(조건①). role='consult' 로 상담 배정만 집계.
 */
export async function fetchTodayConsultAssignCounts(clinicId: string): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  try {
    const today = todaySeoulISODate();
    const dayStart = `${today}T00:00:00+09:00`;
    const dayEnd = `${today}T23:59:59.999+09:00`;
    const { data } = await supabase
      .from('assignment_actions')
      .select('to_staff_id, action_type, role, created_at')
      .eq('clinic_id', clinicId)
      .eq('role', 'consult')
      .in('action_type', ['auto_assign', 'manual'])
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd);
    for (const r of (data ?? []) as { to_staff_id: string | null }[]) {
      if (r.to_staff_id) m.set(r.to_staff_id, (m.get(r.to_staff_id) ?? 0) + 1);
    }
    return m;
  } catch {
    return m;
  }
}

// ── 오케스트레이터: 유입경로 정책 → 상담사 선택 ───────────────────────────────

/**
 * 상담사 자동배정 후보 선택(전략 기반). 정책이 설정된 유입경로에만 동작, 아니면 null → 기존 월균등 fallback.
 *
 * @param clinicId  클리닉
 * @param axis      deriveConsultAxis 결과(TM|인바운드|워크인|returning)
 * @param poolFilter (선택) 추가로 후보를 제한할 id 집합(예: 지정 fallback 컨텍스트). 미전달 시 present∩enabled 전체.
 * @returns 선택된 staffId | null(전략 미적용/후보없음 → 호출측 fallback)
 */
export async function pickConsultantByStrategy(opts: {
  clinicId: string;
  axis: string | null;
  poolFilter?: Set<string> | null;
}): Promise<{ staffId: string; strategy: AssignStrategy; leadSource: AssignLeadSource } | null> {
  const leadSource = mapAxisToLeadSource(opts.axis);
  if (!leadSource) return null; // 재진/미상 = 전략 미적용

  const policyMap = await fetchLeadSourcePolicy(opts.clinicId);
  const strategy = policyMap.get(leadSource);
  if (!strategy) return null; // 이 유입경로 미설정 → 기존 경로 fallback(회귀0)

  let candidates = await fetchPresentEnabledConsultants(opts.clinicId);
  if (opts.poolFilter) candidates = candidates.filter((id) => opts.poolFilter!.has(id));
  if (candidates.length === 0) return null;

  const [metrics, weights] = await Promise.all([
    fetchConsultantRevenueMetrics(opts.clinicId),
    fetchRankingWeights(opts.clinicId),
  ]);
  const ranked = computeRanking(candidates, metrics, weights);

  let chosen: string | null = null;
  if (strategy === 'daily_target') {
    const [cfg, counts] = await Promise.all([
      fetchDailyTargetConfig(opts.clinicId),
      fetchTodayConsultAssignCounts(opts.clinicId),
    ]);
    const targets = cfg
      ? interpolateDailyTargets(ranked, cfg.top_rank_target, cfg.bottom_rank_target)
      : new Map<string, number>();
    chosen = selectByDailyTarget(ranked, targets, counts);
  } else {
    chosen = await pickByRankingPointer(opts.clinicId, leadSource, ranked);
  }
  if (!chosen) return null;
  return { staffId: chosen, strategy, leadSource };
}
