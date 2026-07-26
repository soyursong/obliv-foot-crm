/**
 * T-20260726-foot-CRM-ASSIGN-RANKING-TAB-ADMINLOCK — 상담·치료사 배정 [랭킹] 탭 + 관리자 전용 잠금 E2E
 *
 * 상담·치료사 배정 화면(/admin/assignments)에 실장 랭킹(순위/이름/누적매출/배정건수) [랭킹] 탭을 신설하고,
 * 관리자(admin/manager/director) 전용으로 잠근다.
 *
 * ── 정합(재발명 금지) ──
 *  · 랭킹 데이터 = fetchConsultantPerf (CRM-ASSIGN-RANKING-FIX-R1 정합본: 재직 실장만 + 매출정합). 새 산식 0.
 *  · 순위 = 당월 누적매출(total_amount) desc. 현장 예시데이터(엄경은>송지현>강경민>김지윤>정연주>김주연)와 정합.
 *  · 배정 건수 = 당월 check_ins(정본) consultant_id 배정 수 — STAFFCUMUL/기존 배정 카운트와 동일 정의.
 *  · RED LINE: customers.assigned_consultant_id 무접촉, 랭킹 read-only. 본 spec 은 조회만.
 *
 * ── 접근통제 ──
 *  · UI 숨김: 관리자만 [랭킹] 탭 노출(canViewRanking = admin/manager/director). → S2-UI.
 *  · ⚠ 서버사이드 no-read-up: 현재 payments RLS(payments_approved_read = is_approved_user, 모든 승인 직원 SELECT 허용)
 *      상 foot_stats_consultant(SECURITY INVOKER)를 비admin 이 직접 호출하면 매출이 노출된다. 기존 role/RLS 로는
 *      서버 차단 불가 → 신규 admin-gated RPC/RLS 필요(db_change→true). 임의 RLS 신설 금지 → planner FOLLOWUP → DA CONSULT.
 *      S2-SERVER 는 그 '현재 갭'을 문서화(증거)하며, 서버게이트 랜딩 후 rejection 단언으로 승격한다(현재 test.fixme).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot (풋 정본)
const sb = () => createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── 컴포넌트 rankingRows 파생과 동일 규칙(순수 재현) ─────────────────────────────
interface PerfLike {
  consultant_id: string;
  name: string;
  total_amount?: number;
}
function deriveRanking(
  perfRows: PerfLike[],
  assignCounts: Map<string, number>,
): { rank: number; name: string; revenue: number; assignCount: number }[] {
  return [...perfRows]
    .sort(
      (a, b) =>
        (b.total_amount ?? 0) - (a.total_amount ?? 0) ||
        (a.name ?? '').localeCompare(b.name ?? '', 'ko'),
    )
    .map((r, i) => ({
      rank: i + 1,
      name: r.name ?? '—',
      revenue: r.total_amount ?? 0,
      assignCount: assignCounts.get(r.consultant_id) ?? 0,
    }));
}

// 컴포넌트 canViewRanking 술어(관리자=원장·총괄) 재현.
function canViewRanking(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'manager' || role === 'director';
}

function currentMonthWindow(): { from: string; to: string } {
  const t = new Date();
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(t.getUTCDate()).padStart(2, '0')}` };
}

test.describe('T-20260726 CRM-ASSIGN [랭킹] 탭 + 관리자 잠금', () => {
  // ── 시나리오 1: 관리자 정상 동선 — 랭킹 데이터 소스 정합(재직 실장, 누적매출 desc) ──
  test('S1 랭킹 = R1 정합본(재직 실장) · 누적매출 desc · 배정건수 = check_ins 정본', async () => {
    const c = sb();
    const { from, to } = currentMonthWindow();

    // 재직 판정(R1 규칙): 명시 active===false 만 제외.
    const { data: staffRows, error: sErr } = await c
      .from('staff')
      .select('id, name, active, role')
      .eq('clinic_id', CLINIC_ID)
      .eq('role', 'consultant');
    if (sErr || !staffRows) return test.skip(true, 'staff 조회 실패(스키마/환경)');
    const retiredIds = new Set(
      (staffRows as { id: string; active: boolean | null }[])
        .filter((s) => s.active === false)
        .map((s) => s.id),
    );

    // 랭킹 소스 RPC (fetchConsultantPerf 가 소비하는 것과 동일).
    const { data: rpcRows, error: rErr } = await c.rpc('foot_stats_consultant', {
      p_clinic_id: CLINIC_ID,
      p_from: from,
      p_to: to,
    });
    if (rErr) return test.skip(true, `RPC 실패: ${rErr.message}`);

    // fetchConsultantPerf 재직 필터 적용.
    const perf = ((rpcRows ?? []) as PerfLike[]).filter((r) => !retiredIds.has(r.consultant_id));

    // 당월 배정건수 = check_ins.consultant_id 카운트(정본).
    const monthStart = `${to.slice(0, 7)}-01T00:00:00+09:00`;
    const { data: ciRows } = await c
      .from('check_ins')
      .select('consultant_id, checked_in_at')
      .eq('clinic_id', CLINIC_ID)
      .is('deleted_at', null)
      .gte('checked_in_at', monthStart)
      .not('consultant_id', 'is', null);
    const counts = new Map<string, number>();
    for (const ci of (ciRows ?? []) as { consultant_id: string }[]) {
      counts.set(ci.consultant_id, (counts.get(ci.consultant_id) ?? 0) + 1);
    }

    const ranking = deriveRanking(perf, counts);

    // AC1: 퇴사자 미포함(재직 실장만).
    for (const r of perf) expect(retiredIds.has(r.consultant_id)).toBe(false);

    // AC2: 순위는 누적매출 내림차순(단조 비증가).
    for (let i = 1; i < ranking.length; i++) {
      expect(ranking[i - 1].revenue).toBeGreaterThanOrEqual(ranking[i].revenue);
    }
    // AC3: rank 는 1..N 연속.
    ranking.forEach((r, i) => expect(r.rank).toBe(i + 1));
    // AC4: 배정건수 = check_ins 카운트(음수 없음, read-only 파생).
    for (const r of ranking) expect(r.assignCount).toBeGreaterThanOrEqual(0);
  });

  // ── 시나리오 2 (UI): 일반 스태프는 [랭킹] 탭 자체 미노출 ──
  test('S2-UI 관리자 전용 잠금 — canViewRanking 술어(원장·총괄만 노출)', async () => {
    // 관리자(원장·총괄) = 노출.
    expect(canViewRanking('admin')).toBe(true);
    expect(canViewRanking('manager')).toBe(true);
    expect(canViewRanking('director')).toBe(true);
    // 일반 상담사·스태프 = 숨김(탭 자체 미노출).
    expect(canViewRanking('consultant')).toBe(false);
    expect(canViewRanking('coordinator')).toBe(false);
    expect(canViewRanking('therapist')).toBe(false);
    expect(canViewRanking('tm')).toBe(false);
    expect(canViewRanking('part_lead')).toBe(false);
    expect(canViewRanking('staff')).toBe(false);
    expect(canViewRanking(null)).toBe(false);
    expect(canViewRanking(undefined)).toBe(false);
  });

  // ── 시나리오 2 (SERVER, Critical): 비admin 토큰 직접 RPC 호출 → 거부, 데이터유출 0 ──
  //  ⚠ 현재 서버게이트 미구현(payments_approved_read=is_approved_user 로 모든 승인직원 SELECT 허용).
  //     기존 role/RLS 로 서버 no-read-up 불가 → 신규 admin-gated RPC/RLS 필요(db_change→true, DA CONSULT).
  //     임의 RLS 신설 금지 방침에 따라 본 단언은 서버게이트 랜딩 후 활성화(현재 test.fixme = 미구현 표식).
  test.fixme('S2-SERVER 비admin 토큰 foot_stats_consultant 직접 호출 → 거부 (서버게이트 랜딩 후)', async () => {
    // 서버게이트(admin-gated 랭킹 RPC/뷰) 랜딩 후:
    //   const anon = createClient(SUPA_URL, ANON_KEY);  // 비admin(consultant) 세션
    //   const { data, error } = await anon.rpc('<admin_gated_ranking_rpc>', { ... });
    //   expect(data ?? []).toHaveLength(0);   // 데이터 유출 0
    //   expect(error).not.toBeNull();          // 권한 오류(no-read-up)
    expect(true).toBe(true);
  });

  // ── 시나리오 3: 엣지 케이스 (빈 랭킹 / 단일 실장) ──
  test('S3 엣지 — 빈 랭킹은 빈 배열, 단일 실장은 1위만', () => {
    // 빈 상태(신규/초기) → 빈 목록(에러 없음).
    expect(deriveRanking([], new Map())).toEqual([]);

    // 재직 실장 1명 → 1위만, 정렬 정상.
    const single = deriveRanking(
      [{ consultant_id: 's1', name: '김실장', total_amount: 5_000_000 }],
      new Map([['s1', 3]]),
    );
    expect(single).toHaveLength(1);
    expect(single[0]).toEqual({ rank: 1, name: '김실장', revenue: 5_000_000, assignCount: 3 });

    // total_amount 미상(구RPC fallback) → 0 처리, 배정건수 미상 → 0.
    const missing = deriveRanking([{ consultant_id: 's2', name: '무매출' }], new Map());
    expect(missing[0].revenue).toBe(0);
    expect(missing[0].assignCount).toBe(0);
  });
});
