/**
 * assignmentStrategy — 상담 자동배정 랭킹·전략 레이어 (T-20260726-foot-CRM-ASSIGN-V1)
 *
 * 기존 autoAssign 엔진(월균등 least-loaded, prod LIVE)을 비파괴 확장한다. 유입경로(lead_source)별
 * 정책이 설정돼 있을 때만 이 레이어가 상담사(consult) 선택을 담당하고, 미설정이면 null 을 반환해
 * 기존 월균등 경로로 자연 fallback(회귀0, opt-in).
 *
 * ── 실행1 랭킹 ──
 *   상담사 랭킹 = 월매출·주매출·객단가(payments 온디맨드 재계산) 가중합(기본 B=월1:주2:객1). 물리 순위 저장 0.
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
import {
  VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE,
  type AssignLeadSource,
  type AssignStrategy,
  type AssignmentRankingWeights,
  type AssignmentDailyTargetConfig,
} from './types';

// ── 축(axis, 한글) → 정책 lead_source(enum) 매핑 ─────────────────────────────────
// T-20260730-foot-ASSIGN-FULLSPEC-IMPL: 6경로 codify(fall-through 제거). 단, 배정 라우팅 primary substrate 는
//   axis 가 아니라 deriveAssignLeadSource(visit_route→governed enum) 다. 본 AXIS 맵은 axis 기반 보조 매핑(호환)만 유지.
const AXIS_TO_LEAD_SOURCE: Record<string, AssignLeadSource> = {
  TM: 'TM',
  인바운드: 'INBOUND',
  워크인: 'WALK_IN',
  네이버: 'NAVER',
  지인소개: 'REFERRAL',
  공홈: 'HOMEPAGE',
};

/** deriveConsultAxis 결과(한글 축) → 정책 enum. 재진/미상 = null(전략 미적용). (보조 매핑 — 라우팅 primary=deriveAssignLeadSource) */
export function mapAxisToLeadSource(axis: string | null | undefined): AssignLeadSource | null {
  if (!axis) return null;
  return AXIS_TO_LEAD_SOURCE[axis] ?? null;
}

/**
 * ★배정 라우팅 primary accounting substrate (T-20260730-foot-ASSIGN-FULLSPEC-IMPL / DA Q3).
 * 유입경로 원문(visit_route ?? lead_source) → governed AssignLeadSource. governed enum 파생-only(수기입력 금지).
 *   · 재진(returning): null 반환 = 유입경로 전략 미적용(기존 동작 보존). 상담 재진은 상위(maybeAutoAssign)에서 이미 skip.
 *   · 6경로 명시 매핑(VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE) — 네이버/지인소개/공홈 이 워크인에 묶이지 않고 독립 인식.
 *   · 매핑 미스(레거시 '온라인'/'기타'/공란 등)만 WALK_IN 안전 폴백 = 기존 '워크인' 수렴 보존(회귀0).
 * ★ 재진 365-recency 판정 로직 무접촉(CEO gate 경계, T-20260713) — 여기선 visit_type='returning' 만 확인.
 */
export function deriveAssignLeadSource(c: {
  visit_type?: string | null;
  lead_source?: string | null;
  visit_route?: string | null;
}): AssignLeadSource | null {
  if (c.visit_type === 'returning') return null;
  const raw = (c.visit_route ?? c.lead_source ?? '').trim();
  return VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE[raw] ?? 'WALK_IN';
}

// ── 실행1: 상담사 매출 지표 ───────────────────────────────────────────────────

export interface ConsultantRevenueMetric {
  revenueMonth: number;
  revenueWeek: number;
  /** 객단가 = 월매출 / 이달 담당 방문(check_in) 수. 방문 0이면 0. */
  avgTicket: number;
}

/**
 * 랭킹 매출 윈도우 경계(KST) ISO timestamptz 산출. tz-safe(UTC 요일 계산).
 *
 * T-20260730-foot-ASSIGN-FULLSPEC-IMPL G1 (spec-of-record §094v 가.):
 *   '주매출' 윈도우 = **전주(직전주 월~일)**. 기존 CRM-ASSIGN-V1 은 weekStart=이번주 월요일(금주)였으나
 *   김주연 총괄 확정 스펙은 '전주 매출 ×2' → 전주 구간으로 교정한다(랭킹 divergence #1 해소).
 *   전주는 월초(예: 1~7일)에 전월로 넘어갈 수 있으므로 fetchStart = min(monthStart, weekStart) 로
 *   payments 쿼리 하한을 확장해 전주 데이터 누락(전월분)이 없게 한다.
 *   디스플레이 랭킹 탭 '전주매출' 정의(Assignments.rankingRanges prevWeekMon~prevWeekSun)와 동일 구간(정합).
 *
 *   · monthStart : 이달 1일 00:00(+09) — 당월 매출·객단가 분모 하한(불변).
 *   · weekStart  : 직전주 월요일 00:00(+09) — 전주 매출 하한(포함).
 *   · weekEnd    : 이번주 월요일 00:00(+09) — 전주 매출 상한(미포함) = 직전주 일요일 24:00.
 *   · fetchStart : min(monthStart, weekStart) — payments 쿼리 하한(전주가 전월이면 확장).
 */
export function seoulWindowBounds(todayIso: string): {
  monthStart: string;
  weekStart: string;
  weekEnd: string;
  fetchStart: string;
} {
  const monthStart = `${todayIso.slice(0, 7)}-01T00:00:00+09:00`;
  const [y, m, d] = todayIso.split('-').map((n) => parseInt(n, 10));
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일..6=토
  const backToMon = (dow + 6) % 7; // 이번주 월요일까지 되돌릴 일수
  const fmt = (dt: Date) =>
    `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
      dt.getUTCDate(),
    ).padStart(2, '0')}`;
  const thisMon = new Date(Date.UTC(y, m - 1, d - backToMon)); // 이번주 월요일
  const prevMon = new Date(Date.UTC(y, m - 1, d - backToMon - 7)); // 전주(직전주) 월요일
  const weekStart = `${fmt(prevMon)}T00:00:00+09:00`;
  const weekEnd = `${fmt(thisMon)}T00:00:00+09:00`; // 전주 상한(미포함) = 이번주 월요일 00:00
  const fetchStart = weekStart < monthStart ? weekStart : monthStart;
  return { monthStart, weekStart, weekEnd, fetchStart };
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
    const { monthStart, weekStart, weekEnd, fetchStart } = seoulWindowBounds(today);
    const { data, error } = await supabase
      .from('payments')
      .select('amount, created_at, check_ins!inner(consultant_id)')
      .eq('clinic_id', clinicId)
      .eq('status', 'active')
      .eq('payment_type', 'payment')
      // G1: 전주가 전월로 넘어갈 수 있어 하한을 min(monthStart, weekStart)=fetchStart 로 확장.
      //   당월/전주 귀속은 아래 루프에서 created_at 을 monthStart / [weekStart,weekEnd) 로 분기해 정확히 산정.
      .gte('created_at', fetchStart);
    if (error || !data) return out;

    // consultant_id → {월매출(당월만), 주매출(전주 [weekStart,weekEnd)만), avgTicket}
    // 객단가 분모 = 당월 payment 건수(방문 근사). 전주(전월분) 행은 월매출·건수에서 제외.
    const cntMap = new Map<string, number>();
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
      if (r.created_at >= monthStart) {
        cur.revenueMonth += amt; // 당월(1일~)만
        cntMap.set(staffId, (cntMap.get(staffId) ?? 0) + 1); // 객단가 분모 = 당월 건수
      }
      if (r.created_at >= weekStart && r.created_at < weekEnd) {
        cur.revenueWeek += amt; // 전주(직전주 월~일)만
      }
      out.set(staffId, cur);
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

/** 가중치(부재 시 기본 B = 월1:주2:객1). T-20260726-foot-CRM-ASSIGN-WEIGHT-B */
export async function fetchRankingWeights(clinicId: string): Promise<AssignmentRankingWeights> {
  const dflt: AssignmentRankingWeights = {
    clinic_id: clinicId,
    weight_revenue_month: 1,
    weight_revenue_week: 2, // 기본값 B: 주매출 2배(전주 실적 선순환). 랭킹1~2위 선배정 특권 → "이번 주 열심히=다음 주 기회↑"
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

/**
 * 랭킹 배정 비율(0~1) 맵 — 단일 산식 SSOT (중복 산식 금지, T-20260729-foot-ASSIGN-TARGETCOL AC-4).
 *
 *  매출 desc(동점 시 이름 ko 오름차순) 정렬 → interpolateDailyTargets 로 랭크별 목표 산출 →
 *  각 랭크 목표 ÷ Σ목표 = 스케일 불변 비율. 이 비율에 '초진 예약 수'를 곱하면 직원별 배정 목표.
 *
 *  · 랭킹 탭 '배정비율/예상 배정건수'(월 grain: monthInitResvCount × 비율)
 *  · 직원별 누적 표 '일일 배정 목표' 컬럼(일 grain: selectedDate 초진예약수 × 비율)
 *  두 소비처가 반드시 이 함수 하나만 호출해 산식 재발명을 차단한다(정렬·보간·정규화 동일).
 *
 *  cfg 부재(하루 목표건수 미설정) 또는 Σ목표=0 → null(비율 산출 불가 → 소비처는 '—' 처리).
 */
export function rankAssignmentRatios(
  rows: { consultant_id: string; total_amount?: number | null; name?: string | null }[],
  cfg: { top: number; bottom: number } | null,
): Map<string, number> | null {
  if (!cfg) return null;
  const sorted = [...rows].sort(
    (a, b) =>
      (b.total_amount ?? 0) - (a.total_amount ?? 0) ||
      (a.name ?? '').localeCompare(b.name ?? '', 'ko'),
  );
  const rankedIds = sorted.map((r) => r.consultant_id);
  const targets = interpolateDailyTargets(rankedIds, cfg.top, cfg.bottom);
  let sum = 0;
  for (const v of targets.values()) sum += v;
  if (sum <= 0) return null;
  const ratios = new Map<string, number>();
  for (const id of rankedIds) ratios.set(id, (targets.get(id) ?? 0) / sum);
  return ratios;
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
 *
 * T-20260807-foot-CONSULTASSIGN-NOCONFIRM-AUTOACCRUE-VOID 결정②(no-show void · 김주연 총괄 confirm 2026-08-07):
 *   [미상담 귀가](cancelled/soft-delete) 전환된 배정은 부하분산(다음 배정 대상 계산)에서 제외 → 그 실장이
 *   '점유 중' 으로 오판돼 차기 배정에서 누락되지 않도록 = "no-show 미계수" default(Q3). append-only audit
 *   (assignment_actions)는 보존하고, 앵커 check_in 이 cancelled 또는 deleted_at 이면 부하 count 에서만 제외
 *   (check_ins!inner 조인 후 JS 필터 — 임베드 WHERE 의존 회피).
 *   ⚠ 결정①(consult_notify_status 게이트)은 여기 미적용 = dev-foot 부하 공정성 판단(FOLLOWUP 보고):
 *     아직 [확정] 전이지만 대기 중인 활성 배정을 부하축에서 빼면 그 실장에게 차기 배정이 쏠려(pile-up)
 *     공정성이 깨진다. 따라서 부하축은 '취소/삭제(no-show void)'만 제외하고 미확정-활성 배정은 계속 계수.
 *     (결정① 확정 게이트는 KPI 표시 count[Assignments.tsx staffStats]에만 적용 — 인센티브 KPI 축.)
 */
export async function fetchTodayConsultAssignCounts(clinicId: string): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  try {
    const today = todaySeoulISODate();
    const dayStart = `${today}T00:00:00+09:00`;
    const dayEnd = `${today}T23:59:59.999+09:00`;
    const { data } = await supabase
      .from('assignment_actions')
      // 앵커 check_in 상태 조인(FK check_in_id → check_ins) — no-show void(취소/soft-delete) 부하축 제외용.
      .select('to_staff_id, action_type, role, created_at, check_ins!inner(status, deleted_at)')
      .eq('clinic_id', clinicId)
      .eq('role', 'consult')
      .in('action_type', ['auto_assign', 'manual'])
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd);
    for (const r of (data ?? []) as {
      to_staff_id: string | null;
      check_ins:
        | { status: string | null; deleted_at: string | null }
        | { status: string | null; deleted_at: string | null }[]
        | null;
    }[]) {
      const ci = Array.isArray(r.check_ins) ? r.check_ins[0] : r.check_ins;
      // 결정②: 미상담 귀가(cancelled) / soft-hide(deleted_at) 배정은 부하 count 제외(no-show void).
      if (!ci || ci.status === 'cancelled' || ci.deleted_at != null) continue;
      if (r.to_staff_id) m.set(r.to_staff_id, (m.get(r.to_staff_id) ?? 0) + 1);
    }
    return m;
  } catch {
    return m;
  }
}

// ── G4: 전일(이전 영업일) 휴무 판정 (T-20260730-foot-ASSIGN-FULLSPEC-IMPL §Q3) ─────
//   Q3(총괄 7/30 09:00 confirm): '어제 출근상태 ≠ 출근' → 전부 휴무(주말·연차·오프 구분 없이).
//   월요일 예외(총괄 7/30 09:15 보충, slack ts=1785370441.129699): 센터 일요일 고정휴무 →
//   월요일 '전일'은 일요일 스킵, 토요일 출근 여부 기준. 요일기반 이전 영업일 계산으로 일반화.

/** 고정 휴무 요일 집합(0=일). 종로 풋센터 = 일요일 고정휴무. 향후 타 고정휴무일 확장 시 여기에 추가. */
export const FIXED_HOLIDAY_DOWS = new Set<number>([0]);

/**
 * '전일(어제)' = 직전 영업일 ISO date(KST). 고정 휴무 요일(FIXED_HOLIDAY_DOWS)은 건너뛴다.
 *   · 화~토 → 하루 전(월~금).
 *   · 월요일 → 일요일(고정휴무) 스킵 → 토요일 (Q3 월요일 예외).
 *   · 일반화: 이전 영업일을 요일 기반으로 산출(향후 타 고정휴무일 확장 대비).
 * tz-safe: UTC 날짜 산술만 사용(로컬 tz·시각 영향 없음). seoulWindowBounds 와 동일 패턴.
 */
export function previousBusinessDayISO(
  todayIso: string,
  holidayDows: Set<number> = FIXED_HOLIDAY_DOWS,
): string {
  const [y, m, d] = todayIso.split('-').map((n) => parseInt(n, 10));
  const fmt = (dt: Date) =>
    `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
      dt.getUTCDate(),
    ).padStart(2, '0')}`;
  let cur = new Date(Date.UTC(y, m - 1, d));
  // 최대 14일 뒤로 탐색(무한루프 방지 — 모든 요일이 고정휴무일 순 없음).
  for (let i = 0; i < 14; i++) {
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate() - 1));
    if (!holidayDows.has(cur.getUTCDay())) return fmt(cur);
  }
  return fmt(cur);
}

/**
 * 이전 영업일 기준 '휴무' 상담사 id 집합(G4).
 *   staff_attendance(date=이전영업일)에서 status='present' 인 staff 만 '출근'.
 *   Q3: 그 외(연차·오프·주말·레코드 부재 포함) 전원 = 휴무 → 후보 중 이전영업일 present 아닌 전원.
 * graceful: 조회 실패 → 빈 set(= 아무도 휴무 아님 → turnOrder=baseOrder, 배정 동선 무영향).
 */
export async function fetchPrevDayOffConsultants(
  clinicId: string,
  candidateIds: string[],
): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  try {
    const prevIso = previousBusinessDayISO(todaySeoulISODate());
    const { data, error } = await supabase
      .from('staff_attendance')
      .select('staff_id, status')
      .eq('clinic_id', clinicId)
      .eq('date', prevIso)
      .eq('status', 'present');
    if (error) return new Set();
    const presentPrev = new Set(
      (data ?? []).map((r) => (r as { staff_id: string }).staff_id),
    );
    return new Set(candidateIds.filter((id) => !presentPrev.has(id)));
  } catch {
    return new Set();
  }
}

// ── G2: TM(도파민) 턴 배정 (T-20260730-foot-ASSIGN-FULLSPEC-IMPL §094v 나. + Q1/Q2) ──

/**
 * TM 턴 순서(순수): [이전영업일 휴무자] ++ [나머지], 각 구간 내 기본순번(baseOrder) 유지.
 *   Q3: '전일 휴무 실장부터 기본순번 순' 시작. 복수 휴무자도 기본순번 순(별도 우선순위 없음).
 * @param baseOrder 후보 id (기본순번 assign_sort_order asc 로 이미 정렬됨)
 * @param offSet    이전영업일 휴무 id 집합
 */
export function buildTmTurnOrder(baseOrder: string[], offSet: Set<string>): string[] {
  const off = baseOrder.filter((id) => offSet.has(id));
  const on = baseOrder.filter((id) => !offSet.has(id));
  return [...off, ...on];
}

/**
 * TM skip 집합(순수) — Q1 랭킹 투영: 동일 30분 슬롯 비TM 예약 수 N → 랭킹 상위 N명(K=1..N) skip.
 *   ⚠ '이미 그 예약을 보유한 실장' 기준이 아니라 '랭킹 순서로 그 비TM을 받게 될 상위 K명' 기준(Q1 semantic 확정).
 *   근거: 그 슬롯 비TM 고객은 랭킹(비TM) 배정으로 상위 실장에게 먼저 가므로 TM 순번에서 미리 제외.
 */
export function tmRankingSkipSet(rankedIds: string[], nNonTm: number): Set<string> {
  const k = Math.max(0, nNonTm);
  return new Set(rankedIds.slice(0, k));
}

/**
 * 턴 커서에서 skip 집합을 건너뛰며 다음 TM 배정 대상 선택(순수).
 *   cursor 부터 순환 walk → skip 아닌 첫 후보. 전원 skip(엣지: N≥후보수) → 배정 동선 막지 않게 cursor 위치 선택.
 * @returns { chosen, nextCursor } — nextCursor 는 선택 다음 위치(persist용).
 */
export function pickTmFromTurn(
  turnOrder: string[],
  skipSet: Set<string>,
  cursor: number,
): { chosen: string | null; nextCursor: number } {
  const n = turnOrder.length;
  if (n === 0) return { chosen: null, nextCursor: 0 };
  const start = ((cursor % n) + n) % n;
  for (let step = 0; step < n; step++) {
    const idx = (start + step) % n;
    if (!skipSet.has(turnOrder[idx])) {
      return { chosen: turnOrder[idx], nextCursor: idx + 1 };
    }
  }
  // 전원 skip → 배정 유지(cursor 위치 배정, no-op 방지).
  return { chosen: turnOrder[start], nextCursor: start + 1 };
}

/** 'HH:MM[:SS]' → 30분 슬롯 시작 'HH:MM'(floor, Q2). 파싱 실패 시 null. */
export function toHalfHourSlot(time: string | null | undefined): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const slotMin = mm < 30 ? 0 : 30;
  return `${String(hh).padStart(2, '0')}:${String(slotMin).padStart(2, '0')}`;
}

/**
 * 동일 30분 슬롯(Q2) 비TM 예약 수 N.
 *   대상 = reservations(clinic, 같은 날짜, status IN confirmed|checked_in = 예약 예정 명단) 중
 *          같은 30분 슬롯 & 비TM(=deriveAssignLeadSource 가 TM 도 null(재진) 도 아닌 값).
 *   비TM = 인바운드·워크인·네이버·지인소개·공홈. 재진(null)은 지정 배정 → 랭킹 슬롯 미소비이므로 제외.
 * graceful: 조회 실패/슬롯 미상 → 0(skip 없음, 순수 턴 배정).
 */
export async function countSlotNonTmReservations(
  clinicId: string,
  reservationDate: string,
  reservationTime: string,
): Promise<number> {
  const slot = toHalfHourSlot(reservationTime);
  if (!slot) return 0;
  try {
    const { data, error } = await supabase
      .from('reservations')
      .select('reservation_time, visit_type, visit_route, status')
      .eq('clinic_id', clinicId)
      .eq('reservation_date', reservationDate)
      .in('status', ['confirmed', 'checked_in']);
    if (error || !data) return 0;
    let n = 0;
    for (const r of data as {
      reservation_time: string;
      visit_type?: string | null;
      visit_route?: string | null;
    }[]) {
      if (toHalfHourSlot(r.reservation_time) !== slot) continue;
      const ls = deriveAssignLeadSource({ visit_type: r.visit_type, visit_route: r.visit_route });
      if (ls && ls !== 'TM') n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/** 후보 상담사 기본순번(assign_sort_order) 맵 — TM 턴 정렬용. graceful 빈 맵(컬럼 부재 42703 등). */
async function fetchConsultantSortOrder(clinicId: string): Promise<Map<string, number>> {
  try {
    const { data, error } = await supabase
      .from('staff')
      .select('id, assign_sort_order')
      .eq('clinic_id', clinicId)
      .eq('active', true)
      .eq('role', 'consultant');
    if (error) return new Map();
    const m = new Map<string, number>();
    for (const r of (data ?? []) as { id: string; assign_sort_order: number | null }[]) {
      if (r.assign_sort_order != null) m.set(r.id, r.assign_sort_order);
    }
    return m;
  } catch {
    return new Map();
  }
}

/**
 * TM(도파민) 고객 배정(G2, spec-of-record §094v 나. + Q1/Q2/Q3). daily_target/ranking_pointer 대체(TM 한정).
 *   ① 후보 = present∩enabled 상담사(fetchPresentEnabledConsultants, 실행3와 동일 pool).
 *   ② baseOrder = 기본순번(assign_sort_order asc, NULL 후순위, id tie-break).
 *   ③ 전일(이전영업일) 휴무자부터 → 기본순번 턴(buildTmTurnOrder ← fetchPrevDayOffConsultants, G4+Q3).
 *   ④ 동일 30분 슬롯 비TM 예약 N → 랭킹 상위 N명 skip(tmRankingSkipSet, Q1 랭킹 투영).
 *   ⑤ 지속 커서(assignment_pointer_state lead_source='TM', 일일 lazy 리셋)에서 skip 건너뛰며 턴 배정.
 * ★ 조건② RED LINE 계승: check_ins.consultant_id 만 write 대상, customers 무접촉.
 * best-effort: 실패/후보0 → null → 호출측 월균등 least-loaded fallback(회귀0).
 */
export async function pickTmConsultant(opts: {
  clinicId: string;
  reservation?: { date: string; time: string } | null;
  poolFilter?: Set<string> | null;
}): Promise<{ staffId: string; leadSource: AssignLeadSource } | null> {
  try {
    let candidates = await fetchPresentEnabledConsultants(opts.clinicId);
    if (opts.poolFilter) candidates = candidates.filter((id) => opts.poolFilter!.has(id));
    if (candidates.length === 0) return null;

    const [orderMap, offSet, metrics, weights] = await Promise.all([
      fetchConsultantSortOrder(opts.clinicId),
      fetchPrevDayOffConsultants(opts.clinicId, candidates),
      fetchConsultantRevenueMetrics(opts.clinicId),
      fetchRankingWeights(opts.clinicId),
    ]);

    const NO_ORDER = Number.MAX_SAFE_INTEGER; // 순번 미지정 = 후순위(pickLeastLoaded 와 동일 규약)
    const baseOrder = [...candidates].sort(
      (a, b) =>
        (orderMap.get(a) ?? NO_ORDER) - (orderMap.get(b) ?? NO_ORDER) ||
        (a < b ? -1 : a > b ? 1 : 0),
    );
    const turnOrder = buildTmTurnOrder(baseOrder, offSet);
    const ranked = computeRanking(candidates, metrics, weights);

    const nNonTm = opts.reservation
      ? await countSlotNonTmReservations(
          opts.clinicId,
          opts.reservation.date,
          opts.reservation.time,
        )
      : 0;
    const skipSet = tmRankingSkipSet(ranked, nNonTm);

    // 턴 커서 read(일일 lazy 리셋) — pickByRankingPointer 와 동일 assignment_pointer_state 재사용(lead_source='TM').
    const today = todaySeoulISODate();
    let cursor = 0;
    try {
      const { data } = await supabase
        .from('assignment_pointer_state')
        .select('cursor_rank, reset_date')
        .eq('clinic_id', opts.clinicId)
        .eq('lead_source', 'TM')
        .maybeSingle();
      const row = data as { cursor_rank: number; reset_date: string | null } | null;
      cursor = row && row.reset_date === today ? row.cursor_rank : 0;
    } catch {
      cursor = 0;
    }

    const { chosen, nextCursor } = pickTmFromTurn(turnOrder, skipSet, cursor);
    if (!chosen) return null;

    // advance + persist(best-effort: 실패해도 배정은 진행).
    try {
      await supabase.from('assignment_pointer_state').upsert(
        {
          clinic_id: opts.clinicId,
          lead_source: 'TM',
          cursor_rank: nextCursor,
          reset_date: today,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'clinic_id,lead_source' },
      );
    } catch {
      /* best-effort */
    }
    return { staffId: chosen, leadSource: 'TM' };
  } catch {
    return null;
  }
}

// ── 오케스트레이터: 유입경로 정책 → 상담사 선택 ───────────────────────────────

/**
 * 상담사 자동배정 후보 선택(전략 기반). 정책이 설정된 유입경로에만 동작, 아니면 null → 기존 월균등 fallback.
 *
 * @param clinicId  클리닉
 * @param leadSource governed 유입경로 enum(deriveAssignLeadSource 결과). null=재진/미상 → 전략 미적용.
 * @param poolFilter (선택) 추가로 후보를 제한할 id 집합(예: 지정 fallback 컨텍스트). 미전달 시 present∩enabled 전체.
 * @returns 선택된 staffId | null(전략 미적용/후보없음 → 호출측 fallback)
 */
export async function pickConsultantByStrategy(opts: {
  clinicId: string;
  leadSource: AssignLeadSource | null;
  poolFilter?: Set<string> | null;
  /** T-20260730 G2: TM 배정 시 동일 30분 슬롯 비TM 예약 lookup 을 위한 현재 예약 슬롯(reservation_id → date/time). */
  reservation?: { date: string; time: string } | null;
}): Promise<{ staffId: string; strategy: AssignStrategy; leadSource: AssignLeadSource } | null> {
  const leadSource = opts.leadSource;
  if (!leadSource) return null; // 재진/미상 = 전략 미적용

  // T-20260730-foot-ASSIGN-FULLSPEC-IMPL G2 (§094v 나.): TM(도파민) 고객은 유입경로 정책
  //   (daily_target/ranking_pointer)이 아니라 '전일휴무 기본순번 턴 + 동일슬롯 비TM 랭킹투영 skip'
  //   전용 로직으로 배정한다(AC-2: 기존 TM daily_target/ranking_pointer 경로 대체). 정책 row 유무 무관.
  //   후보0/실패 → null → 호출측 월균등 least-loaded 로 fallback(회귀0).
  if (leadSource === 'TM') {
    const tm = await pickTmConsultant({
      clinicId: opts.clinicId,
      reservation: opts.reservation ?? null,
      poolFilter: opts.poolFilter ?? null,
    });
    // strategy 필드는 소비처(autoAssign)가 .staffId 만 사용 → 명목 라벨('ranking_pointer', TM 턴은 커서 순환 계열).
    return tm ? { staffId: tm.staffId, strategy: 'ranking_pointer', leadSource: 'TM' } : null;
  }

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
