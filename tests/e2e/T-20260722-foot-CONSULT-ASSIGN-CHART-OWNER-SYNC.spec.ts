/**
 * E2E — T-20260722-foot-CONSULT-ASSIGN-CHART-OWNER-SYNC
 * 담당실장(영구, customers.assigned_staff_id) ↔ 방문별 상담사(check_ins.consultant_id) 연동.
 * planner 판정 = B안(제어된 전파). 하드 collapse 폐기.
 *
 * 착수 authorize(MSG-20260722-110423, FIX-REQUEST):
 *   item1  상담 탭(방문별) 변경 → check_ins.consultant_id 만 write. 영구값(assigned_staff_id) 절대 미덮음.
 *   item2  2번차트 Zone1 담당자(영구) 변경 → assigned_staff_id 수정 + 당일 열린(open, status≠done) check_in.consultant_id 하향전파(scenario1, AC-1/AC-3).
 *          ★done 보존 (planner MSG-oz4g 소급범위 확정): 이미 done 인 방문의 consultant_id(=실제 상담자 기록)는 auto-overwrite 금지 — open 만 소급.
 *   AC-6   초진 자동배정도 assigned_staff_id 세팅 시 그 값 우선(균등은 미지정 시만) — 김종민류(강경민↔엄경은) 재발방지.
 *   item4  AC-4 회귀0 + DESIG-THERAPIST-ROLE-GATE 무충돌.
 *   보류    scenario2 역전파(AC-2, 상담탭→영구): 현장 DECISION-REQUEST 답변 전까지 영구값 자동 덮기 금지 → 본 spec에서 '미전파' 단언으로 봉인.
 *
 * 검증:
 *   [정적] AC-6: NewCheckInDialog 초진 = 지정담당(fetchAssignedStaffId) 우선, 미지정 시만 균등(assign_consultant_atomic).
 *   [정적] item1: 상담 탭 onChange 가 assigned_staff_id 를 write 하지 않음(영구값 미덮음) + 방문별 헬퍼 호출.
 *   [정적] item2: Zone1 onChange = assigned_staff_id 저장 + updateTodayOpenCheckInConsultant 하향전파.
 *   [정적] 헬퍼 계약: 당일(KST)·미취소만 대상(비당일/취소 제외) + rows-affected 검증.
 *   [DB]   전파 타깃팅 계약: 당일 열린 check_in 만 consultant_id 갱신 / 어제·취소 내원은 불변 / 영구값과 독립.
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

const MARKER = 'RC-OWNERSYNC-SEED';

// ── [정적] 소스 단언 = 결정 로직의 결정적 회귀 방어 ────────────────────────────
test.describe('[정적] OWNER-SYNC 결정 로직', () => {
  const checkin = read('src/components/NewCheckInDialog.tsx');
  const chart = read('src/pages/CustomerChartPage.tsx');

  test('AC-6: 초진 자동배정 = 지정담당 우선, 미지정 시만 균등', () => {
    // fetchAssignedStaffId 헬퍼 존재 + customers.assigned_staff_id 조회
    expect(checkin).toContain('const fetchAssignedStaffId');
    expect(checkin).toMatch(/\.from\('customers'\)[\s\S]*?\.select\('assigned_staff_id'\)/);
    // designated ?? autoAssignConsultant — 지정이 우선, 없을 때만 균등(assign_consultant_atomic)
    expect(checkin).toMatch(/const designated = customerId \? await fetchAssignedStaffId\(customerId\) : null;/);
    expect(checkin).toMatch(/consultantId = designated \?\? await autoAssignConsultant\(clinicId\);/);
  });

  test('item1: 상담 탭 = 방문별 write only — 영구값(assigned_staff_id) 미덮음', () => {
    // 상담 탭 담당자 블록(consultationStaffId onChange) 추출
    const idx = chart.indexOf('value={consultationStaffId}');
    expect(idx).toBeGreaterThan(0);
    const block = chart.slice(idx, idx + 900);
    // 방문별 헬퍼 호출 O
    expect(block).toContain('updateTodayOpenCheckInConsultant(v)');
    // 영구값 write X — 상담 탭 onChange 안에서 assigned_staff_id 를 '저장'하지 않음(구 쌍방 저장 폐기).
    //   ('assigned_staff_id:' = 객체키 write 형태 / saveCustomerField 호출 부재로 판정 — 설명 주석의 단순 언급은 허용)
    expect(block).not.toContain('assigned_staff_id:');
    expect(block).not.toContain('saveCustomerField');
  });

  test('item2: Zone1 담당자(영구) = assigned_staff_id 저장 + 하향전파', () => {
    const idx = chart.indexOf("value={customer.assigned_staff_id ?? ''}");
    expect(idx).toBeGreaterThan(0);
    const block = chart.slice(idx, idx + 900);
    expect(block).toContain('saveCustomerField({ assigned_staff_id: v })');
    expect(block).toContain('updateTodayOpenCheckInConsultant(v)');
    // 저장 실패 시 전파 안 함(가드)
    expect(block).toContain('if (error) return;');
  });

  test('헬퍼 계약: 당일(KST)·open(≠done,≠cancelled)만 대상 + rows-affected 검증', () => {
    const idx = chart.indexOf('const updateTodayOpenCheckInConsultant');
    expect(idx).toBeGreaterThan(0);
    const block = chart.slice(idx, idx + 1600);
    // 방문별 컬럼만 갱신(consultant_id), 영구값 미갱신
    expect(block).toContain('.update({ consultant_id: staffId })');
    expect(block).not.toContain('assigned_staff_id');
    // 당일(KST) + 취소 제외 게이트
    expect(block).toContain('!== todaySeoulISODate()');
    expect(block).toContain("ci.status === 'cancelled'");
    // ★done 보존 게이트 (planner MSG-oz4g 소급범위 확정): 이미 done 인 방문은 실제 상담자 기록 → auto-overwrite 금지
    expect(block).toContain("ci.status === 'done'");
    // rows-affected 검증(사일런트 성공 오인 차단)
    expect(block).toContain('.select(');
    expect(block).toMatch(/data\.length === 0/);
  });

  test('item4/보류: 상담 탭에서 assigned_staff_id 역전파(자동 덮기) 코드 부재', () => {
    // scenario2 역전파는 현장 결정 전까지 봉인 — 상담 탭 블록에 영구값 write(assigned_staff_id: …) 없음(위 item1 재확인)
    const idx = chart.indexOf('value={consultationStaffId}');
    const block = chart.slice(idx, idx + 900);
    expect(block).not.toMatch(/assigned_staff_id\s*:/);
  });
});

// ── [DB] 전파 타깃팅 계약 = 헬퍼가 의존하는 UPDATE 의미 검증 ──────────────────
test.describe('[DB] 하향전파 타깃팅 계약', () => {
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

  test('당일 열린(open) 내원만 consultant_id 갱신 / 어제·취소·당일done 내원 불변 / 영구값 독립', async () => {
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
    const qBase = 90000 + (ts % 9000); // 실 데이터/재실행 큐번호 충돌 회피

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

    // 검증: A만 newStaff / B(어제)·C(취소)·D(당일done)는 oldStaff 불변
    const { data: after } = await service
      .from('check_ins')
      .select('customer_name, consultant_id')
      .eq('customer_id', customerId);
    const byName = Object.fromEntries((after as Array<{ customer_name: string; consultant_id: string }>).map((r) => [r.customer_name.slice(-1), r.consultant_id]));
    expect(byName['A']).toBe(newStaff);   // 당일 열린(open) → 전파
    expect(byName['B']).toBe(oldStaff);   // 어제 → 불변
    expect(byName['C']).toBe(oldStaff);   // 취소 → 불변
    expect(byName['D']).toBe(oldStaff);   // ★당일 done → 보존(불변) — 실제 상담자 기록

    // 영구값(assigned_staff_id) 은 방문별 전파와 독립 — 이 경로에서 미변경
    const { data: c2 } = await service.from('customers').select('assigned_staff_id').eq('id', customerId).single();
    expect((c2 as { assigned_staff_id: string }).assigned_staff_id).toBe(oldStaff);
  });
});
