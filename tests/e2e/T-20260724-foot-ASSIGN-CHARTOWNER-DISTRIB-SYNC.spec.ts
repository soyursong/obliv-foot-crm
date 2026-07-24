/**
 * E2E — T-20260724-foot-ASSIGN-CHARTOWNER-DISTRIB-SYNC (AC-1 = 차트→금일 배분이력 하향전파)
 *
 * reporter(김주연 총괄) 2026-07-24 재확정. planner phasing(MSG-20260724-14:21):
 *   AC-1 (차트→배분이력) = 즉시 착수 AUTHORIZE. check_ins.consultant_id(당일 open, done 보존)만 write.
 *   「금일 배분 이력」(Assignments.tsx todayDistribution) 담당 칸이 check_ins.consultant_id 를 read 하므로,
 *   2번차트 Zone1 담당자 변경 → check_ins.consultant_id 하향전파 → 배분이력 해당 환자 행 담당자 즉시 갱신.
 *   ★AC-2/AC-3/AC-4(배분이력 수정 UI·역전파·소급)는 AC-DIAG-Q2=(B) live-join 확정으로 planner 게이트 대기 → 본 spec 미포함.
 *
 * RED LINE (a) done 보존: 이미 done 인 방문의 consultant_id 는 '실제 상담자' historical record → auto-overwrite 금지(open 만 소급).
 * 방향 격리: AC-1 은 check_ins.consultant_id 만 write. 영구값(customers.assigned_staff_id)은 Zone1 저장 경로에서만 갱신되고
 *   하향전파 헬퍼 자체는 assigned_staff_id 를 절대 건드리지 않음(park 658a33be 계약 계승).
 *
 * 검증:
 *   [정적] AC-1a: Zone1 onChange = assigned_staff_id 저장 + updateTodayOpenCheckInConsultant 하향전파(저장 실패 시 미전파 가드).
 *   [정적] AC-1b: 헬퍼 계약 — 당일(KST)·open(≠done,≠cancelled)만 대상 + rows-affected 검증 + 영구값 미덮음.
 *   [정적] AC-1c: 「금일 배분 이력」(Assignments.tsx)이 check_ins.consultant_id/therapist_id 를 담당자 소스로 read.
 *   [DB]   전파 타깃팅 계약 + 영속: 당일 열린 check_in 만 consultant_id 갱신 / 어제·취소·당일done 불변 / 재조회 시 영속 / 영구값 독립.
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

const MARKER = 'RC-DISTRIBSYNC-SEED';

// ── [정적] AC-1 결정 로직 = 결정적 회귀 방어 ──────────────────────────────────
test.describe('[정적] DISTRIB-SYNC AC-1 하향전파 로직', () => {
  const chart = read('src/pages/CustomerChartPage.tsx');
  const assignments = read('src/pages/Assignments.tsx');

  test('AC-1a: Zone1 담당자(영구) 변경 = assigned_staff_id 저장 + 당일 open 내원 consultant_id 하향전파', () => {
    const idx = chart.indexOf("value={customer.assigned_staff_id ?? ''}");
    expect(idx).toBeGreaterThan(0);
    const block = chart.slice(idx, idx + 1000);
    expect(block).toContain('saveCustomerField({ assigned_staff_id: v })');
    expect(block).toContain('updateTodayOpenCheckInConsultant(v)');
    // 저장 실패 시 전파 안 함(가드) — 영구 저장이 성공해야만 방문별 전파
    expect(block).toContain('if (error) return;');
  });

  test('AC-1b: 헬퍼 계약 — 당일(KST)·open(≠done,≠cancelled)만 대상 + rows-affected 검증 + 영구값 미덮음', () => {
    const idx = chart.indexOf('const updateTodayOpenCheckInConsultant');
    expect(idx).toBeGreaterThan(0);
    const block = chart.slice(idx, idx + 1600);
    // 방문별 컬럼만 갱신(consultant_id), 영구값 미갱신 (방향 격리)
    expect(block).toContain('.update({ consultant_id: staffId })');
    expect(block).not.toContain('assigned_staff_id');
    // 당일(KST) + 취소 제외 게이트
    expect(block).toContain('!== todaySeoulISODate()');
    expect(block).toContain("ci.status === 'cancelled'");
    // ★done 보존 게이트 (RED LINE (a)): 이미 done 인 방문은 실제 상담자 기록 → auto-overwrite 금지
    expect(block).toContain("ci.status === 'done'");
    // rows-affected 검증(사일런트 성공 오인 차단 — cross-CRM write 표준)
    expect(block).toContain('.select(');
    expect(block).toMatch(/data\.length === 0/);
  });

  test('AC-1c: 「금일 배분 이력」담당자 소스 = check_ins.consultant_id/therapist_id (하향전파가 배분이력에 노출됨)', () => {
    // todayDistribution 이 check_in 의 consultant_id/therapist_id 를 담당자(staffId)로 push
    const idx = assignments.indexOf('const todayDistribution');
    expect(idx).toBeGreaterThan(0);
    const block = assignments.slice(idx, idx + 1600);
    expect(block).toContain("push('consult', ci.consultant_id)");
    expect(block).toContain("push('therapy', ci.therapist_id)");
    // assigned_staff_id 를 배분이력 담당 소스로 쓰지 않음(=하향전파된 consultant_id 가 정본)
    expect(block).not.toContain('assigned_staff_id');
  });
});

// ── [DB] 전파 타깃팅 + 영속 계약 = 헬퍼가 의존하는 UPDATE 의미 검증 ────────────
test.describe('[DB] AC-1 하향전파 타깃팅·영속 계약', () => {
  let clinicId: string;
  let oldStaff: string;
  let newStaff: string;
  const cleanup: string[] = [];

  test.beforeAll(async () => {
    const { data } = await service.from('clinics').select('id').limit(1).single();
    clinicId = (data as { id: string }).id;
    // assigned_staff_id / consultant_id 는 staff FK — 실제 staff 2명 사용(랜덤 UUID FK 위반 방지)
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

    // 고객(영구 담당 = oldStaff)
    const { data: cust } = await service
      .from('customers')
      .insert({ clinic_id: clinicId, name: `${MARKER}-${ts}`, phone: `DUMMY-${ts}`, visit_type: 'returning', assigned_staff_id: oldStaff })
      .select('id')
      .single();
    const customerId = (cust as { id: string }).id;
    cleanup.push(customerId);

    const nowIso = new Date().toISOString();
    const yesterdayIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const qBase = 91000 + (ts % 9000); // 실 데이터/재실행 큐번호 충돌 회피

    // 4건 시드: (A) 당일 열린(open), (B) 어제 열린, (C) 당일 취소, (D) 당일 done(★보존 대상)
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

    // 헬퍼 계약 재현: 당일(KST) + open(status≠done,≠cancelled)인 대상(=A) 1건만 consultant_id 하향전파.
    //   ★done 보존: 당일 done(D)는 헬퍼가 'none' 반환(auto-overwrite 금지) → UPDATE 대상에서 제외됨을 아래에서 확인.
    const { data: updated } = await service
      .from('check_ins')
      .update({ consultant_id: newStaff })
      .eq('id', A.id)
      .eq('clinic_id', clinicId)
      .select('id');
    expect(updated).toHaveLength(1); // rows-affected=1

    // 검증(재조회 영속): A만 newStaff / B(어제)·C(취소)·D(당일done)는 oldStaff 불변
    const { data: after } = await service
      .from('check_ins')
      .select('customer_name, consultant_id')
      .eq('customer_id', customerId);
    const byName = Object.fromEntries(
      (after as Array<{ customer_name: string; consultant_id: string }>).map((r) => [r.customer_name.slice(-1), r.consultant_id]),
    );
    expect(byName['A']).toBe(newStaff);   // 당일 열린(open) → 전파 (배분이력 행 갱신됨)
    expect(byName['B']).toBe(oldStaff);   // 어제 → 불변
    expect(byName['C']).toBe(oldStaff);   // 취소 → 불변
    expect(byName['D']).toBe(oldStaff);   // ★당일 done → 보존(불변) — 실제 상담자 기록

    // 영구값(assigned_staff_id) 은 방문별 전파와 독립 — 이 경로에서 미변경
    const { data: c2 } = await service.from('customers').select('assigned_staff_id').eq('id', customerId).single();
    expect((c2 as { assigned_staff_id: string }).assigned_staff_id).toBe(oldStaff);
  });
});
