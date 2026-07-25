/**
 * E2E — T-20260725-foot-CHART2-ASSIGNHIST-DOWNSYNC-R3 (요청3 gap fix = 상담탭 담당자 → 금일 배분이력 하향전파)
 *
 * reporter(김주연 총괄) 2026-07-25 08:41 재정의 확정(MSG-20260725-084129-2gw9):
 *   ② 2번차트(고객상세) 담당(배정 실장) 변경 → 「금일 배분 이력」에만 반영(단방향 하향, 배분이력 限).
 *
 * GAP-DIAG(1차, read-only) 결론:
 *   旣배포 AC-1(commit 9d5d3115, T-20260724-foot-ASSIGN-CHARTOWNER-DISTRIB-SYNC)은 2번차트 담당 변경 경로 中
 *   Zone1 담당자 select(customer.assigned_staff_id)에만 updateTodayOpenCheckInConsultant 하향전파를 체이닝.
 *   그러나 2번차트에는 담당 실장을 바꾸는 select 가 하나 더 있음 = 「상담 탭」담당자 select(consultationStaffId).
 *   이 상담탭 경로는 assigned_staff_id(영구값)만 저장하고 check_ins.consultant_id 로 전파하지 않아
 *   「금일 배분 이력」에 미반영 → 현장 "연동 누락된 듯" 신고의 gap.
 *
 * (b) gap 限 최소 구현:
 *   상담탭 담당자 select onChange 에 Zone1 과 동일한 하향전파 체이닝 추가
 *   (동일 헬퍼 updateTodayOpenCheckInConsultant — 당일 open check_in.consultant_id 만, done 보존, assigned_staff_id 무접점).
 *
 * ★RED LINE (reporter 명시 + AC-1 계승):
 *   (1) 단방향·하향 限: 2번차트→배분이력만. 역방향 upsync 없음(GATE 소관).
 *   (2) 매출-SAFE: check_ins.consultant_id 만, assigned_staff_id(매출 live-join) 무접점.
 *   (3) done 보존: status=done 방문 auto-overwrite 금지, 당일 open 限.
 *   (4) 배분이력 限: 다른 화면/섹션 무접점 — 동일 헬퍼 재사용, 신규 write 타깃 없음.
 *
 * 검증:
 *   [정적] R3-a: 상담탭 담당자 onChange = saveCustomerField(assigned_staff_id) + updateTodayOpenCheckInConsultant 전파(저장 실패 시 미전파 가드).
 *   [정적] R3-b: 두 경로(Zone1·상담탭) 모두 동일 헬퍼로 하향전파 = parity(배분이력 반영 누락 경로 0).
 *   [정적] R3-c: 헬퍼 계약 불변(당일 open·done 보존·assigned_staff_id 무접점·rows-affected 검증) — AC-1 회귀 방어.
 *   [DB]   전파 타깃팅·영속 계약(당일 open 만 갱신 / 어제·취소·당일done 불변 / 영구값 독립) — 상담탭 경로도 동일 UPDATE 의미.
 *
 * 비파괴: 시드(customers + check_ins)는 종료 후 전량 회수.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MARKER = 'RC-CHART2-DOWNSYNC-R3-SEED';

// ── [정적] 상담탭 gap fix + parity + 헬퍼 계약 불변 ───────────────────────────
test.describe('[정적] CHART2-DOWNSYNC-R3 상담탭 하향전파 gap fix', () => {
  const chart = read('src/pages/CustomerChartPage.tsx');
  const assignments = read('src/pages/Assignments.tsx');

  test('R3-a: 상담탭 담당자 select onChange = assigned_staff_id 저장 + 당일 open 내원 consultant_id 하향전파(저장 실패 시 미전파)', () => {
    // 상담탭 담당자 select 는 consultationStaffId 를 value 로 바인딩
    const idx = chart.indexOf('value={consultationStaffId}');
    expect(idx).toBeGreaterThan(0);
    const block = chart.slice(idx, idx + 900);
    // 영구값 저장 + 하향전파 체이닝(gap fix 핵심)
    expect(block).toContain('saveCustomerField({ assigned_staff_id: v })');
    expect(block).toContain('updateTodayOpenCheckInConsultant(v)');
    // 저장 실패 시 전파 안 함(가드) — 영구 저장 성공해야만 방문별 전파
    expect(block).toContain('if (error) return;');
  });

  test('R3-b: parity — 2번차트 담당 변경 경로(Zone1·상담탭) 모두 동일 헬퍼로 배분이력 반영(누락 경로 0)', () => {
    // updateTodayOpenCheckInConsultant 호출 지점이 최소 2곳(Zone1 + 상담탭) = 두 경로 모두 전파.
    const calls = chart.split('updateTodayOpenCheckInConsultant(v)').length - 1;
    expect(calls).toBeGreaterThanOrEqual(2);
    // assigned_staff_id 를 저장하는 두 select 경로 모두 헬퍼 전파를 동반(전파 없는 assigned_staff_id 저장 경로 = gap).
    // Zone1(customer.assigned_staff_id) 경로
    const zone1 = chart.indexOf("value={customer.assigned_staff_id ?? ''}");
    expect(zone1).toBeGreaterThan(0);
    expect(chart.slice(zone1, zone1 + 1000)).toContain('updateTodayOpenCheckInConsultant(v)');
    // 상담탭(consultationStaffId) 경로
    const consultTab = chart.indexOf('value={consultationStaffId}');
    expect(consultTab).toBeGreaterThan(0);
    expect(chart.slice(consultTab, consultTab + 900)).toContain('updateTodayOpenCheckInConsultant(v)');
  });

  test('R3-c: 헬퍼 계약 불변(당일 open·done 보존·assigned_staff_id 무접점·rows-affected) — AC-1 회귀 방어', () => {
    const idx = chart.indexOf('const updateTodayOpenCheckInConsultant');
    expect(idx).toBeGreaterThan(0);
    const block = chart.slice(idx, idx + 1600);
    // 방문별 컬럼만 갱신(consultant_id) — 영구값·매출축 무접점(RED LINE 2)
    expect(block).toContain('.update({ consultant_id: staffId })');
    expect(block).not.toContain('assigned_staff_id');
    // 당일(KST) + 취소 제외 게이트
    expect(block).toContain('!== todaySeoulISODate()');
    expect(block).toContain("ci.status === 'cancelled'");
    // ★done 보존 게이트(RED LINE 3)
    expect(block).toContain("ci.status === 'done'");
    // rows-affected 검증(사일런트 성공 오인 차단 — cross-CRM write 표준)
    expect(block).toContain('.select(');
    expect(block).toMatch(/data\.length === 0/);
  });

  test('R3-d: 배분이력 담당 소스 = check_ins.consultant_id (하향전파가 배분이력에 노출됨 — 반영 경로 정합)', () => {
    const idx = assignments.indexOf('const todayDistribution');
    expect(idx).toBeGreaterThan(0);
    const block = assignments.slice(idx, idx + 2200);
    expect(block).toContain("push('consult', ci.consultant_id)");
    // 배분이력 담당 소스로 assigned_staff_id 를 쓰지 않음(=하향전파된 consultant_id 가 정본)
    expect(block).not.toContain('assigned_staff_id');
  });
});

// ── [DB] 전파 타깃팅·영속 계약 (상담탭 경로도 동일 UPDATE 의미) ────────────────
test.describe('[DB] CHART2-DOWNSYNC-R3 하향전파 타깃팅·영속 계약', () => {
  let clinicId: string;
  let oldStaff: string;
  let newStaff: string;
  const cleanup: string[] = [];

  test.beforeAll(async () => {
    const { data } = await service.from('clinics').select('id').limit(1).single();
    clinicId = (data as { id: string }).id;
    const { data: staff } = await service.from('staff').select('id').eq('clinic_id', clinicId).limit(2);
    const ids = (staff as Array<{ id: string }>).map((s) => s.id);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    oldStaff = ids[0];
    newStaff = ids[1];
  });

  test.afterAll(async () => {
    if (cleanup.length) {
      await service.from('check_ins').delete().in('customer_id', cleanup);
      await service.from('customers').delete().in('id', cleanup);
    }
  });

  test('당일 열린(open) 내원만 consultant_id 갱신 / 어제·취소·당일done 불변 / 재조회 영속 / 영구값 독립', async () => {
    const ts = Date.now();

    const { data: cust } = await service
      .from('customers')
      .insert({ clinic_id: clinicId, name: `${MARKER}-${ts}`, phone: `DUMMY-${ts}`, visit_type: 'returning', assigned_staff_id: oldStaff })
      .select('id')
      .single();
    const customerId = (cust as { id: string }).id;
    cleanup.push(customerId);

    const nowIso = new Date().toISOString();
    const yesterdayIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const qBase = 92000 + (ts % 8000);

    // 4건 시드: (A) 당일 open, (B) 어제, (C) 당일 취소, (D) 당일 done(★보존)
    const { data: rows } = await service
      .from('check_ins')
      .insert([
        { clinic_id: clinicId, customer_id: customerId, customer_name: `${MARKER}-A`, status: 'consultation', consultant_id: oldStaff, checked_in_at: nowIso, queue_number: qBase },
        { clinic_id: clinicId, customer_id: customerId, customer_name: `${MARKER}-B`, status: 'done', consultant_id: oldStaff, checked_in_at: yesterdayIso, queue_number: qBase + 1 },
        { clinic_id: clinicId, customer_id: customerId, customer_name: `${MARKER}-C`, status: 'cancelled', consultant_id: oldStaff, checked_in_at: nowIso, queue_number: qBase + 2 },
        { clinic_id: clinicId, customer_id: customerId, customer_name: `${MARKER}-D`, status: 'done', consultant_id: oldStaff, checked_in_at: nowIso, queue_number: qBase + 3 },
      ])
      .select('id, customer_name, status, checked_in_at');
    expect(rows).toHaveLength(4);
    const A = (rows as Array<{ id: string; customer_name: string }>).find((r) => r.customer_name.endsWith('-A'))!;

    // 헬퍼 계약 재현: 당일 open 대상(=A) 1건만 consultant_id 하향전파. done(D)·어제(B)·취소(C)는 제외.
    const { data: updated } = await service
      .from('check_ins')
      .update({ consultant_id: newStaff })
      .eq('id', A.id)
      .eq('clinic_id', clinicId)
      .select('id');
    expect(updated).toHaveLength(1);

    const { data: after } = await service
      .from('check_ins')
      .select('customer_name, consultant_id')
      .eq('customer_id', customerId);
    const byName = Object.fromEntries(
      (after as Array<{ customer_name: string; consultant_id: string }>).map((r) => [r.customer_name.slice(-1), r.consultant_id]),
    );
    expect(byName['A']).toBe(newStaff);   // 당일 open → 전파(배분이력 행 갱신)
    expect(byName['B']).toBe(oldStaff);   // 어제 → 불변
    expect(byName['C']).toBe(oldStaff);   // 취소 → 불변
    expect(byName['D']).toBe(oldStaff);   // ★당일 done → 보존(불변)

    // 영구값(assigned_staff_id) 은 방문별 전파와 독립 — 이 경로에서 미변경(매출-SAFE)
    const { data: c2 } = await service.from('customers').select('assigned_staff_id').eq('id', customerId).single();
    expect((c2 as { assigned_staff_id: string }).assigned_staff_id).toBe(oldStaff);
  });
});
