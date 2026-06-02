/**
 * T3 Critical Flow CF-1 — 신규 환자 풀 사이클
 * [T-foot-qa-002] + [T-20260427-foot-qa-007]
 *
 * 시나리오:
 *   1. 셀프체크인 anon → 신규 등록
 *   2. 칸반에서 카드 발견 + checklist 단계 진입 (DB 전환)
 *   3. 원장 진료 단계 + doctor_note 입력
 *   4. 상담 단계 → 결제 (단건)
 *   5. 시술 → 완료
 *   6. cleanup
 *
 * 상태 공유 패턴:
 *   - serial 모드: 이전 테스트 실패 시 후속 자동 skip
 *   - describe 스코프 변수: testCheckInId / testCustomerId
 *   - afterAll cleanup: FK 순서 준수 + phone fallback
 *
 * 참고 — checklist 전환:
 *   UI에서는 PreChecklist 다이얼로그 완료 시 registered → checklist 전환.
 *   Dashboard에 'checklist' droppable 컬럼은 없음 (checklist 카드는 registered 컬럼에 합산 표시).
 *   따라서 이 테스트에서는 DB 직접 전환으로 검증.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../../helpers';
import { openSheet } from '../../helpers/interaction';
import { CLINIC_ID, seedCheckIn } from '../../fixtures';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test.describe('CF-1 신규 환자 풀 사이클', () => {
  // serial: 이전 테스트 실패 시 후속 자동 skip
  test.describe.configure({ mode: 'serial' });

  const TS = Date.now();
  const TEST_NAME = `cf1-new-${TS}`;
  const TEST_PHONE = `010${String(TS).slice(-8)}`;
  let testCheckInId: string | null = null;
  let testCustomerId: string | null = null;

  test.afterAll(async () => {
    try {
      const sb = createClient(SUPA_URL, SERVICE_KEY);
      if (testCheckInId) {
        await sb.from('payments').delete().eq('check_in_id', testCheckInId);
        await sb.from('check_ins').delete().eq('id', testCheckInId);
      }
      if (testCustomerId) {
        await sb.from('customers').delete().eq('id', testCustomerId);
      }
      // phone 매칭으로도 cleanup (셀프체크인 customer)
      const { data: leftover } = await sb.from('customers').select('id').eq('phone', TEST_PHONE);
      if (leftover && leftover.length) {
        const ids = leftover.map((r) => r.id as string);
        await sb.from('check_ins').delete().in('customer_id', ids);
        await sb.from('customers').delete().in('id', ids);
      }
    } catch (e) {
      console.error('CF-1 cleanup error:', e);
    }
  });

  test('1. 신규 환자 등록 → registered/new check_in 생성', async () => {
    // 셀프체크인 anon UI 동선(NumPad 전화입력·예약여부 2단계·personal_info(주민번호/주소/동의)·QR)은
    // T-20260529-foot-SELFCHECKIN-FLOW-REVAMP / T-20260601-foot-SELFLOGIN-RESV-LIST-QR 전용 spec이 커버한다.
    // CF-1은 "등록 이후" 풀사이클(칸반→진료→결제→시술→완료) 회귀에 집중하므로 등록은 시드로 진입.
    // (이전엔 #sc-phone 직접 fill로 UI를 몰았으나 전화입력이 온스크린 NumPad로 전환되어 노후됨.)
    const h = await seedCheckIn({ status: 'registered', visit_type: 'new', name: TEST_NAME });
    testCheckInId = h.id;
    testCustomerId = h.customerId;

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { data } = await sb
      .from('check_ins')
      .select('id, customer_id, status, visit_type')
      .eq('id', testCheckInId)
      .single();
    expect(data).not.toBeNull();
    expect(data!.status).toBe('registered');
    expect(data!.visit_type).toBe('new');
  });

  test('2. 칸반 카드 발견 (초진대기 진입)', async ({ page }) => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);

    // DASH-SLOT-REMOVE(T-20260508) 이후 registered/new 체크인은 칸반이 아니라
    // 통합시간표(DashboardTimeline)에서 관리된다 (new_queue/returning_queue 컬럼 삭제).
    // 칸반 카드(data-testid="checkin-card")는 활성 단계(exam_waiting/consult_waiting/…)부터 노출 →
    // 신규 환자는 체크리스트 완료 후 초진대기(exam_waiting)로 진입하는 시점에 첫 칸반 카드가 등장한다.
    // (이전엔 registered 카드를 칸반에서 찾았으나, registered/new는 더 이상 칸반 카드가 아님 → stale.)
    await sb.from('check_ins').update({
      status: 'exam_waiting',
      notes: { checklist: { nail_condition: 'fungal' }, checklist_completed_at: new Date().toISOString() },
    }).eq('id', testCheckInId!);

    const ok = await loginAndWaitForDashboard(page);
    expect(ok).toBe(true);

    // --- 칸반 카드 노출 검증 (초진대기 컬럼) ---
    const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${testCheckInId}"]`);
    await card.waitFor({ state: 'visible', timeout: 8000 });

    // DB 단계 전환 정상 반영 검증
    const { data } = await sb.from('check_ins').select('status').eq('id', testCheckInId!).single();
    expect(data?.status).toBe('exam_waiting');
  });

  test('3. 원장 진료 패널(초진) + 진료메모(doctor_note) 입력', async ({ page }) => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    // 의사 진료 패널(DoctorTreatmentPanel)은 status가 exam_waiting 또는 examination일 때 노출된다
    // (CheckInDetailSheet L1845). exam_waiting을 유지하는 이유:
    //   - exam_waiting = 초진대기 컬럼의 plain 칸반 카드 → openSheet가 카드 클릭으로 진입 가능.
    //   - examination = RoomSection(진료방 배정) 기반 → 방 미배정 시 칸반 카드 미노출 → 클릭 불가.
    // 진료 메모는 CHART1-TRIM(T-20260522)으로 '원장 소견' 단독 textarea가 제거되고
    // DoctorTreatmentPanel '차팅' 탭의 doctor-note-textarea(doctor_note 저장)로 통합됐다.
    await sb.from('check_ins').update({ status: 'exam_waiting' }).eq('id', testCheckInId);

    const ok = await loginAndWaitForDashboard(page);
    expect(ok).toBe(true);

    await openSheet(page, TEST_NAME);

    // 의사 진료 패널 — 진료 메모 textarea (기본 '차팅' 탭)
    const textarea = page.getByTestId('doctor-note-textarea');
    await textarea.waitFor({ state: 'visible', timeout: 5000 });
    // DoctorTreatmentPanel은 useDoctorFields 쿼리 도착 시 render-phase에서 doctorNote를
    // DB값으로 1회 동기화한다(L573). fill이 동기화보다 빠르면 빈 값으로 덮어써지므로
    // 쿼리 settle을 기다린 뒤 fill하고, 채워진 값을 검증해 race를 차단한다.
    await page.waitForTimeout(1500);
    await textarea.fill('CF-1 진료 메모');
    await expect(textarea).toHaveValue('CF-1 진료 메모');

    // 진료 메모 임시 저장 (handleSaveNote → check_ins.doctor_note UPDATE).
    // 고객차트 시트(base-ui Dialog)는 포털 구조상 자기 subtree에 aria-hidden+inert가 상시 적용되어
    // (실사용은 정상이나) Playwright의 실제 포인터 클릭이 pointer-events 인터셉트로 차단된다.
    // inert subtree에서도 React 루트 위임 리스너에 도달하는 dispatchEvent('click')로 핸들러를 직접 발화.
    const saveBtn = page.getByRole('button', { name: '임시 저장' }).first();
    await saveBtn.waitFor({ state: 'attached', timeout: 5000 });
    await saveBtn.dispatchEvent('click');
    await page.waitForTimeout(1500);

    const { data } = await sb.from('check_ins').select('doctor_note').eq('id', testCheckInId).single();
    expect(data?.doctor_note).toContain('CF-1 진료 메모');
  });

  test('4. 결제 → DB payments INSERT', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    await sb.from('check_ins').update({ status: 'payment_waiting' }).eq('id', testCheckInId);

    // 결제는 PaymentDialog UI 시뮬 어려워 DB 직접 INSERT (단건 결제)
    const { error } = await sb.from('payments').insert({
      clinic_id: CLINIC_ID,
      check_in_id: testCheckInId,
      customer_id: testCustomerId,
      amount: 50000,
      method: 'card',
      installment: null,
      memo: 'CF-1 단건 결제',
      payment_type: 'payment',
    });
    expect(error).toBeNull();

    // status auto-transition (PaymentDialog 안 거치므로 수동)
    await sb.from('check_ins').update({ status: 'treatment_waiting' }).eq('id', testCheckInId);
    const { data } = await sb.from('payments').select('id, amount').eq('check_in_id', testCheckInId);
    expect((data ?? []).length).toBeGreaterThan(0);
    expect(data![0].amount).toBe(50000);
  });

  test('5. 시술 → 완료', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    // treatment_waiting → preconditioning (사전처치) → laser → done
    await sb.from('check_ins').update({ status: 'preconditioning', treatment_room: '치료실1' }).eq('id', testCheckInId);
    await sb.from('check_ins').update({ status: 'laser' }).eq('id', testCheckInId);
    await sb.from('check_ins').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', testCheckInId);
    const { data } = await sb.from('check_ins').select('status, completed_at').eq('id', testCheckInId).single();
    expect(data?.status).toBe('done');
    expect(data?.completed_at).toBeTruthy();
  });
});
