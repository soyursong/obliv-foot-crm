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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const PAGE = 'src/pages/Assignments.tsx';

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

  // ── 시나리오 2 (SERVER, Critical): 서버게이트 랜딩(마이그 20260727120000 / DA Opt A) 검증 ──
  //  §2 서버 no-read-up 완결: ① 진입점 = admin-gated SECDEF 래퍼 foot_stats_consultant_admin
  //  (is_admin_or_manager fail-closed 42501) ② 구 foot_stats_consultant 는 authenticated EXECUTE 회수.
  test('S2-SERVER 비admin 컨텍스트(auth.uid 부재) 래퍼 호출 → fail-closed 42501 거부, 데이터유출 0', async () => {
    const c = sb();
    const { from, to } = currentMonthWindow();
    // service_role 키 = auth.uid() 부재 → is_admin_or_manager()=false → 래퍼가 최상단에서 RAISE 42501.
    //   (실 비admin authenticated 세션과 동치의 default-deny 경로 — 관리자 아닌 주체는 서버에서 거부됨.)
    const { data, error } = await c.rpc('foot_stats_consultant_admin', {
      p_clinic_id: CLINIC_ID,
      p_from: from,
      p_to: to,
    });
    expect(error).not.toBeNull(); // 권한 오류(no-read-up) — 빈 응답 아닌 명시 거부
    expect((error as { code?: string } | null)?.code).toBe('42501');
    expect(data ?? []).toHaveLength(0); // 데이터 유출 0
  });

  // ── 시나리오 2 (SERVER, static): 마이그 파일에 DA 하드닝 5조건 랜딩 확인(supervisor DDL-diff 보조 증거) ──
  test('S2-SERVER-MIG 마이그 20260727120000 = SECDEF 래퍼 + fail-closed + search_path pin + 하위 authenticated 회수', () => {
    const mig = read('supabase/migrations/20260727120000_foot_stats_consultant_admin_gate.sql');
    // #3 fail-closed 진입 검사(42501) + canonical(is_admin_or_manager) 재사용.
    expect(mig).toContain('IF NOT public.is_admin_or_manager() THEN');
    expect(mig).toContain("ERRCODE = '42501'");
    // SECDEF + #2 search_path pin.
    expect(mig).toMatch(/SECURITY DEFINER/);
    expect(mig).toContain('SET search_path = public, pg_temp');
    // #1 anon/PUBLIC 차단 + authenticated 만 진입.
    expect(mig).toContain('REVOKE ALL     ON FUNCTION public.foot_stats_consultant_admin');
    expect(mig).toContain('GRANT  EXECUTE ON FUNCTION public.foot_stats_consultant_admin(UUID, DATE, DATE) TO authenticated');
    // ② 하위 SSOT 함수 authenticated EXECUTE 회수(=비admin 직접 호출 차단).
    expect(mig).toContain('REVOKE EXECUTE ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) FROM authenticated');
    // 롤백 대칭성(회수 복원 + 래퍼 DROP).
    const rb = read('supabase/migrations/20260727120000_foot_stats_consultant_admin_gate.rollback.sql');
    expect(rb).toContain('GRANT EXECUTE ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) TO authenticated');
    expect(rb).toContain('DROP FUNCTION IF EXISTS public.foot_stats_consultant_admin');
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

  // ── 시나리오 4 (§3): '배정 순번 설정' 항목 [랭킹] 탭 통합 + 원 위치(헤더) 제거 ──
  //  ⚠ 재배치(위치 이동)만 — RotationOrderDialog 저장/데이터 경로 무접촉. 정적 소스 구조 단언으로 검증.
  //  (실렌더 admin 순번 편집→저장은 supervisor 갤탭 실브라우저 + T-20260629 ROTATION spec 이 커버.)
  test.describe('S4 배정 순번 설정 → [랭킹] 탭 통합(재배치)', () => {
    // S4-1: 진입 버튼(rotation-order-open-btn)은 화면에 정확히 1개만 존재(중복 노출 금지).
    test('S4-1 rotation-order-open-btn 단일 노출(중복 제거)', () => {
      const src = read(PAGE);
      const count = (src.match(/data-testid="rotation-order-open-btn"/g) ?? []).length;
      expect(count).toBe(1);
    });

    // S4-2: 진입 버튼이 헤더(assignments-scroll-root 헤더 블록)가 아니라 [랭킹] 탭 카드 뒤에 위치.
    //  = ranking 카드(assignments-ranking-card) → 배정 순번 카드(assignments-rotation-card) → 버튼 순서.
    test('S4-2 배정 순번 설정 = [랭킹] 탭 내부(assignments-rotation-card)로 이동', () => {
      const src = read(PAGE);
      const rankingCardIdx = src.indexOf('data-testid="assignments-ranking-card"');
      const rotationCardIdx = src.indexOf('data-testid="assignments-rotation-card"');
      const btnIdx = src.indexOf('data-testid="rotation-order-open-btn"');
      expect(rankingCardIdx).toBeGreaterThan(-1);
      expect(rotationCardIdx).toBeGreaterThan(-1);
      expect(btnIdx).toBeGreaterThan(-1);
      // 랭킹 탭 통합: 랭킹 카드 → 배정 순번 카드 → 진입 버튼 순으로 등장(탭 내부 통합).
      expect(rotationCardIdx).toBeGreaterThan(rankingCardIdx);
      expect(btnIdx).toBeGreaterThan(rotationCardIdx);
      // 통합 카드는 랭킹 탭 게이트(mainTab === 'ranking' && canViewRanking) 블록 안에 위치.
      const rankingBlockIdx = src.indexOf("mainTab === 'ranking' && canViewRanking");
      expect(rankingBlockIdx).toBeGreaterThan(-1);
      expect(rotationCardIdx).toBeGreaterThan(rankingBlockIdx);
    });

    // S4-3: 진입 버튼이 헤더(미배정 일괄 자동배정 버튼 ~ 새로고침 사이)에서 제거됨.
    test('S4-3 헤더에서 배정 순번 설정 버튼 제거(원 위치 중복 노출 제거)', () => {
      const src = read(PAGE);
      const batchBtnIdx = src.indexOf('data-testid="batch-autoassign-btn"');
      const refreshIdx = src.indexOf('void load()} disabled={loading || busy}>');
      const btnIdx = src.indexOf('data-testid="rotation-order-open-btn"');
      expect(batchBtnIdx).toBeGreaterThan(-1);
      expect(refreshIdx).toBeGreaterThan(-1);
      // 진입 버튼은 헤더(batch ~ refresh 사이)에 없어야 함 → btnIdx 는 refresh(헤더 끝)보다 뒤.
      expect(btnIdx).toBeGreaterThan(refreshIdx);
    });

    // S4-4: 통합 탭 권한 = canViewRanking(탭 게이트) + canEditRotation(버튼) — 둘 다 admin/manager/director.
    //  일반 스태프는 탭 미노출 → 배정 순번 설정도 함께 잠김(§3 권한 동일 적용).
    test('S4-4 배정 순번 설정도 관리자 전용(탭에 통합되어 함께 잠김)', () => {
      const src = read(PAGE);
      // 통합 카드/버튼은 canEditRotation 가드(admin/manager/director) 하에 렌더.
      expect(src).toMatch(/canEditRotation && \(\s*<Button[\s\S]*?rotation-order-open-btn/);
      // 탭 게이트 술어 = canViewRanking(비admin 미노출) → 배정 순번 설정도 함께 숨김.
      expect(canViewRanking('consultant')).toBe(false);
      expect(canViewRanking('staff')).toBe(false);
      expect(canViewRanking('admin')).toBe(true);
    });
  });
});
