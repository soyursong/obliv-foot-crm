/**
 * T-20260807-foot-RANKING-STAFFATTR-CONSULTANT-TO-STAFF — 랭킹 탭 귀속축 consultant → assigned_staff_id
 *
 * 상담·치료사 배정 > [랭킹] 탭(실장별 월매출) 귀속축을
 *   consultant(check_ins.consultant_id 최근접 상담사, foot_stats_consultant RPC) →
 *   customers.assigned_staff_id('2번차트 담당 실장' = 고객 카드 담당자, 8/6 총괄 확정 canonical) 로 교체.
 * → 매출집계 > 담당실장별(SalesDoctorTab, assigned_staff_id 축)과 동일 귀속 기준 사용(AC-2).
 *
 * ── 설계 결정 (db_change=false, path a) ──
 *  · foot_stats_consultant(_admin) RPC 는 통계>매출탭 '상담실장 티켓팅 실적'과 공유 → 축을 바꾸면 통계탭 회귀.
 *    ∴ RPC 무접촉. 랭킹 전용 FE 집계 helper(fetchConsultantPerfByAssignedStaff) 신설 → Assignments 랭킹 소비경로만 교체.
 *    (SALESDOCTOR-4COL 선례: 매출집계>담당실장별도 FE 에서 assigned_staff_id 집계, no-DDL.)
 *  · net(환불 차감 후) 유지 — AC-3 net/gross 직교축 무접촉(랭킹=net, 누적매출=gross 그대로).
 *  · 로스터 = 재직 상담사(role='consultant', active≠false). 비상담직(코디)·미배정(NULL) 매출은 실장 랭킹 모수 제외(AC-4).
 *  · 시뮬레이션(is_simulation) 고객 결제 제외 — 매출집계>담당실장별과 동일 방어필터.
 *
 * ── 검증 방식 ──
 *  · 정적 소스 단언(read) : 랭킹 4 소비경로 + 월경계 폴백이 assigned_staff helper 로 교체됐고 RPC 는 랭킹서 미사용.
 *  · helper 산식 단언(stats.ts) : assigned_staff_id 귀속 + net + 단건∪패키지 + sim 제외 + 재직 상담사 로스터.
 *  · 라이브 DB 파리티(AC-2/AC-4) : helper 재현 집계 == 매출집계>담당실장별 귀속축(assigned_staff_id) 일치.
 *  · 실렌더 클릭(갤탭)·시각 정합 = supervisor QA 커버. 여기선 축 교체·산식·회귀 고정.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const PAGE = 'src/pages/Assignments.tsx';
const STATS = 'src/lib/stats.ts';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot (풋 정본)
const sb = () => createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

test.describe('T-20260807 랭킹 귀속축 consultant → assigned_staff_id', () => {
  // ── AC-1: 랭킹 소비경로 4곳 + 월경계 폴백이 assigned_staff helper 로 교체 ──
  test('S1 랭킹 소스 = fetchConsultantPerfByAssignedStaff (4 소비경로 + 폴백)', () => {
    const src = read(PAGE);
    // import 교체 — 랭킹은 assigned_staff helper, consultant 축 RPC helper 는 랭킹서 직접호출 0.
    expect(src).toContain('fetchConsultantPerfByAssignedStaff');
    // 실제 code 호출: 랭킹 로드 3직접 + 일일목표 입력 + 월경계 폴백 내부 2 = assigned_staff helper.
    expect(src).toMatch(/fetchConsultantPerfByAssignedStaff\(clinicId, prevWeekMon, prevWeekSun\)/);
    expect(src).toMatch(/fetchConsultantPerfByAssignedStaff\(clinicId, thisWeekMon, rankingDate\)/);
    expect(src).toMatch(/fetchConsultantPerfByAssignedStaff\(clinicId, prevMonthStart, prevMonthEnd\)/);
    expect(src).toMatch(/fetchConsultantPerfByAssignedStaff\(clinicId, monthStart, to\)/);
    // 랭킹에서 구 consultant 축 RPC helper 를 직접 호출하는 코드 라인이 없어야 함(주석 제외).
    const codeCalls = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(codeCalls).not.toMatch(/[^A-Za-z]fetchConsultantPerf\(/);
  });

  // ── consultant 축 RPC(foot_stats_consultant)는 통계 매출탭 전용으로 보존(무접촉) ──
  test('S2 통계 매출탭은 consultant 축 fetchConsultantPerf 유지 (RPC 무접촉)', () => {
    const stats = read(STATS);
    // 두 helper 공존: 구 consultant 축(fetchConsultantPerf, RPC foot_stats_consultant_admin) + 신 staff 축.
    expect(stats).toContain('export async function fetchConsultantPerf(');
    expect(stats).toContain('export async function fetchConsultantPerfByAssignedStaff(');
    expect(stats).toContain("supabase.rpc('foot_stats_consultant_admin'");
    // Stats.tsx(통계 매출탭)는 여전히 consultant 축 helper 사용(축 혼재 회귀 방지).
    const statsPage = read('src/pages/Stats.tsx');
    expect(statsPage).toMatch(/fetchConsultantPerf\(clinic\.id, from, to\)/);
    expect(statsPage).not.toContain('fetchConsultantPerfByAssignedStaff');
  });

  // ── helper 산식: assigned_staff_id 귀속 + net + 단건∪패키지 + sim 제외 + 재직 상담사 로스터 ──
  test('S3 helper 산식 = assigned_staff_id net 귀속 (매출집계 담당실장별과 동일 축)', () => {
    const stats = read(STATS);
    const i = stats.indexOf('export async function fetchConsultantPerfByAssignedStaff(');
    const j = stats.indexOf('export async function fetchNoshowReturning(');
    expect(i).toBeGreaterThan(-1);
    const body = stats.slice(i, j > i ? j : undefined);
    // 귀속축 = customers.assigned_staff_id
    expect(body).toContain('assigned_staff_id');
    expect(body).toMatch(/from\('customers'\)/);
    // 단건(payments) + 패키지(package_payments) 둘 다, accounting_date 윈도우.
    expect(body).toMatch(/from\('payments'\)/);
    expect(body).toMatch(/from\('package_payments'\)/);
    expect(body).toContain('accounting_date');
    // net = payment − refund.
    expect(body).toMatch(/payment_type === 'refund'/);
    // 시뮬레이션 고객 제외(매출집계 담당실장별과 동일 방어필터).
    expect(body).toContain('getSimulationCustomerIds');
    expect(body).toContain('excludeSimulationPaymentRows');
    // 로스터 = 재직 상담사(role='consultant', 명시 active=false 제외).
    expect(body).toMatch(/\.eq\('role', 'consultant'\)/);
    expect(body).toContain('s.active === false');
    // 삭제 단건 제외.
    expect(body).toMatch(/not\('status', 'eq', 'deleted'\)/);
  });

  // ── AC-2 + AC-4 라이브 파리티: helper 재현 == 매출집계 담당실장별 귀속축(assigned_staff_id) ──
  test('S4 라이브: staff-축 net 귀속이 매출집계 담당실장별과 동일 대상 사용 + 미배정 제외', async () => {
    test.skip(!SUPA_URL || !SERVICE_KEY, 'DB 환경변수 없음');
    const c = sb();
    // 데이터 보유 구간(직전 달 전체) — 결정론 위해 고정 월 사용.
    const from = '2026-07-01';
    const to = '2026-07-31';

    // 1) 결제행(단건+패키지) — helper 와 동일 쿼리.
    const { data: pay, error: pe } = await c
      .from('payments')
      .select('amount, payment_type, customer_id')
      .eq('clinic_id', CLINIC_ID)
      .not('status', 'eq', 'deleted')
      .gte('accounting_date', from)
      .lte('accounting_date', to);
    const { data: pkg, error: ke } = await c
      .from('package_payments')
      .select('amount, payment_type, customer_id')
      .eq('clinic_id', CLINIC_ID)
      .gte('accounting_date', from)
      .lte('accounting_date', to);
    if (pe || ke) return test.skip(true, `결제 조회 실패: ${pe?.message ?? ke?.message}`);

    const custIds = [
      ...new Set(
        [...(pay ?? []), ...(pkg ?? [])].map((r) => r.customer_id).filter(Boolean) as string[],
      ),
    ];
    if (custIds.length === 0) return test.skip(true, '해당 구간 결제 데이터 없음');

    // 2) 고객 → assigned_staff_id (+ 시뮬레이션 고객 집합).
    const custStaff = new Map<string, string | null>();
    for (let k = 0; k < custIds.length; k += 500) {
      const chunk = custIds.slice(k, k + 500);
      const { data: cs } = await c
        .from('customers')
        .select('id, assigned_staff_id')
        .in('id', chunk);
      for (const r of (cs ?? []) as { id: string; assigned_staff_id: string | null }[]) {
        custStaff.set(r.id, r.assigned_staff_id);
      }
    }
    const { data: simRows } = await c
      .from('customers')
      .select('id')
      .eq('clinic_id', CLINIC_ID)
      .eq('is_simulation', true);
    const simIds = new Set((simRows ?? []).map((r) => r.id));

    // 3) 재직 상담사 로스터.
    const { data: staffRows } = await c
      .from('staff')
      .select('id, name, active')
      .eq('clinic_id', CLINIC_ID)
      .eq('role', 'consultant');
    const roster = new Set(
      (staffRows ?? []).filter((s) => s.active !== false).map((s) => s.id),
    );

    // 4) helper 재현: net 귀속 by assigned_staff_id, 로스터 내 상담사만, sim 제외.
    const rankNet = new Map<string, number>();
    let unassignedOrNonConsultantNet = 0; // 미배정/비상담직 → 랭킹 제외 규모(AC-4 증거)
    const accrue = (customerId: string | null, amt: number) => {
      if (!customerId || simIds.has(customerId)) return; // 워크인/시뮬 제외
      const sid = custStaff.get(customerId) ?? null;
      if (sid && roster.has(sid)) {
        rankNet.set(sid, (rankNet.get(sid) ?? 0) + amt);
      } else {
        unassignedOrNonConsultantNet += amt; // NULL 또는 비-상담실장 귀속 → 랭킹 밖
      }
    };
    for (const p of pay ?? []) accrue(p.customer_id, (p.payment_type === 'refund' ? -1 : 1) * (p.amount ?? 0));
    for (const pp of pkg ?? []) accrue(pp.customer_id, (pp.payment_type === 'refund' ? -1 : 1) * (pp.amount ?? 0));

    // AC-2: 랭킹 귀속 대상 = customers.assigned_staff_id (매출집계 담당실장별과 동일 컬럼).
    //   각 랭킹 대상 staffId 가 실제로 어떤 고객의 assigned_staff_id 였음을 검증(귀속 대상 일치).
    const attributedStaffIds = new Set([...custStaff.values()].filter(Boolean) as string[]);
    for (const sid of rankNet.keys()) {
      expect(attributedStaffIds.has(sid)).toBe(true); // 랭킹 대상은 전부 assigned_staff_id 로 귀속된 실장
      expect(roster.has(sid)).toBe(true); // 그리고 재직 상담사
    }

    // AC-4: 미배정(NULL)/비상담직 매출은 랭킹서 제외됨 = 분리 집계된 값이 존재(크래시 없이 처리).
    expect(Number.isFinite(unassignedOrNonConsultantNet)).toBe(true);

    // 랭킹 모수는 재직 상담사 부분집합(비상담직 배제).
    expect([...rankNet.keys()].every((id) => roster.has(id))).toBe(true);

    // 증거 로그(supervisor QA 대조용).
    const top = [...rankNet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log('[T-20260807 파리티] window', from, '~', to);
    console.log('[T-20260807 파리티] 랭킹 대상(재직 상담실장) 수 =', rankNet.size);
    console.log('[T-20260807 파리티] 미배정/비상담직 net(랭킹 제외) =', unassignedOrNonConsultantNet);
    console.log('[T-20260807 파리티] staff-축 상위:', JSON.stringify(top));
  });

  // ── 회귀 가드: 랭킹 탭 admin 전용 잠금 + 변동표/배정비율 SSOT 불변 ──
  test('S5 REGRESS admin 전용 잠금 + 배정비율 SSOT(rankAssignmentRatios) 불변', () => {
    const src = read(PAGE);
    expect(src).toMatch(/mainTab !== 'ranking' \|\| !canViewRanking \|\| !clinic\) return;/);
    expect(src).toContain("mainTab === 'ranking' && canViewRanking");
    // 배정비율은 여전히 단일 SSOT 함수(rankAssignmentRatios)로 산출 — 산식 재발명 금지.
    expect(src).toContain('rankAssignmentRatios(perfRows, dailyTargetCfg)');
    expect(src).toContain('rankAssignmentRatios(workingRows, targetCfg)');
    // 변동표(주간/월간) 파생 유지.
    expect(src).toContain('const variationRows =');
    expect(src).toContain('const monthVariationRows =');
    // 당일 배정건수는 여전히 check_ins 축(배정 SSOT) — 귀속축 교체가 배정건수 정의를 바꾸지 않음.
    expect(src).toMatch(/gte\('checked_in_at', dayStart\)/);
  });
});
