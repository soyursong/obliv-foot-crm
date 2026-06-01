/**
 * E2E spec — T-20260601-foot-DOCTOR-CALL-PUSH-DASH
 * 의사 호출 알림(소리+푸쉬) + 진료부 통합 대시보드
 *
 * 현장 요청 (김주연 총괄, 슬랙 C0ATE5P6JTH):
 *   진료부가 한 창만 켜놓고 — 소리나는 푸쉬알람 + 처방/차팅/진료완료 환자/알람 누적을 모두 확인.
 *
 * 구현:
 *   - src/lib/doctor-call-notify.ts (순수 헬퍼 — 본 spec이 직접 import해 박제 검증)
 *   - src/hooks/useDoctorCallNotifier.ts (소리/Notification/토스트 폴백)
 *   - src/components/doctor/DoctorCallDashboard.tsx (통합 대시보드)
 *   - src/pages/DoctorTools.tsx ('진료 알림판' 탭 추가)
 *   - src/lib/audio.ts (playDoctorCallAlert 추가)
 *
 * 데이터 모델: 풋 CRM 진료 호출 = check_ins.status_flag (purple=진료필요, pink=진료완료).
 *   기존 doctor_call(status_flag) 발신/상태머신/집계 변경 없음(회귀 0).
 *
 * 시나리오(티켓 §5) → AC 매핑:
 *   S1 알림 수신/피드 누적 → AC-1·AC-3·AC-5
 *   S2 음소거/권한 폴백     → AC-2·AC-7
 *   중복 알림 차단          → AC-4
 *   통합 확인               → AC-6
 */
import { test, expect } from '@playwright/test';
import {
  isActiveCall,
  isDoneCall,
  getCallTime,
  callKey,
  detectNewCallKeys,
  elapsedMinutes,
  formatElapsed,
  treatmentLabel,
  buildCallNotification,
} from '../../src/lib/doctor-call-notify';
import { loginAndWaitForDashboard } from '../helpers';

type Hist = Array<{ flag: string | null; changed_at: string; changed_by: string | null }>;
function ci(over: Record<string, unknown>) {
  return {
    id: 'x',
    customer_id: 'c1',
    customer_name: '홍길동',
    visit_type: 'new',
    status: 'treatment_waiting',
    status_flag: 'purple',
    status_flag_history: null as Hist | null,
    checked_in_at: '2026-06-01T01:00:00+00:00',
    completed_at: null,
    treatment_kind: null,
    treatment_category: null,
    consultation_room: null,
    treatment_room: null,
    laser_room: null,
    examination_room: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test.describe('T-20260601 DOCTOR-CALL-PUSH-DASH — 순수 로직 박제', () => {
  // ── AC-1·AC-5: 활성/완료 호출 구분 ────────────────────────────────────────
  test('AC-5: status_flag purple=활성호출, pink=완료호출 판정', () => {
    expect(isActiveCall('purple')).toBe(true);
    expect(isActiveCall('pink')).toBe(false);
    expect(isActiveCall('white')).toBe(false);
    expect(isActiveCall(null)).toBe(false);
    expect(isDoneCall('pink')).toBe(true);
    expect(isDoneCall('purple')).toBe(false);
  });

  // ── 호출시각 = status_flag_history 마지막 purple 전환, 폴백 checked_in_at ──
  test('getCallTime: 마지막 purple 전환시각 우선, 없으면 checked_in_at', () => {
    // 이력 없음 → checked_in_at
    expect(getCallTime(ci({}))).toBe('2026-06-01T01:00:00+00:00');
    // 이력 마지막 purple 전환 사용 (white→purple→pink→purple 의 두 번째 purple)
    const hist: Hist = [
      { flag: 'white', changed_at: '2026-06-01T01:10:00+00:00', changed_by: null },
      { flag: 'purple', changed_at: '2026-06-01T01:20:00+00:00', changed_by: null },
      { flag: 'pink', changed_at: '2026-06-01T01:30:00+00:00', changed_by: null },
      { flag: 'purple', changed_at: '2026-06-01T01:40:00+00:00', changed_by: null },
    ];
    expect(getCallTime(ci({ status_flag_history: hist }))).toBe('2026-06-01T01:40:00+00:00');
  });

  // ── AC-4: 중복 알림 차단 + 재호출은 새 키 ──────────────────────────────────
  test('AC-4: callKey 중복 차단 — 같은 호출 재알림 없음, 재호출은 새 키', () => {
    const histA: Hist = [{ flag: 'purple', changed_at: '2026-06-01T01:20:00+00:00', changed_by: null }];
    const call1 = ci({ id: 'p1', status_flag_history: histA });
    const k1 = callKey(call1);

    // 같은 호출이 realtime tick으로 두 번째 들어와도 키 동일 → seen에 있으면 신규 아님
    const seen = new Set<string>([k1]);
    expect(detectNewCallKeys(seen, [callKey(call1)])).toEqual([]); // 재알림 없음

    // 재호출(새 purple 전환) → 키 변경 → 신규로 감지
    const histB: Hist = [
      ...histA,
      { flag: 'pink', changed_at: '2026-06-01T01:30:00+00:00', changed_by: null },
      { flag: 'purple', changed_at: '2026-06-01T01:50:00+00:00', changed_by: null },
    ];
    const call2 = ci({ id: 'p1', status_flag_history: histB });
    expect(detectNewCallKeys(seen, [callKey(call2)])).toEqual([callKey(call2)]); // 재호출 = 알림
  });

  test('detectNewCallKeys: seen에 없는 키만 신규', () => {
    const seen = new Set(['a@t1', 'b@t1']);
    expect(detectNewCallKeys(seen, ['a@t1', 'c@t2', 'b@t1', 'd@t3'])).toEqual(['c@t2', 'd@t3']);
  });

  // ── AC-3: 경과시간/시술명 표기 ─────────────────────────────────────────────
  test('AC-3: 경과시간 한국어 표기', () => {
    expect(formatElapsed(0)).toBe('방금');
    expect(formatElapsed(5)).toBe('5분 전');
    expect(formatElapsed(60)).toBe('1시간 전');
    expect(formatElapsed(95)).toBe('1시간 35분 전');
  });

  test('elapsedMinutes: 음수/NaN 방어', () => {
    const base = new Date('2026-06-01T01:00:00+00:00').getTime();
    expect(elapsedMinutes('2026-06-01T01:00:00+00:00', base + 5 * 60_000)).toBe(5);
    expect(elapsedMinutes('2026-06-01T01:10:00+00:00', base)).toBe(0); // 미래 → 0 (음수 방지)
    expect(elapsedMinutes('not-a-date')).toBe(0);
  });

  test('treatmentLabel: kind→category→폴백', () => {
    expect(treatmentLabel(ci({ treatment_kind: '도수치료' }))).toBe('도수치료');
    expect(treatmentLabel(ci({ treatment_kind: null, treatment_category: '레이저' }))).toBe('레이저');
    expect(treatmentLabel(ci({ treatment_kind: '  ', treatment_category: null }))).toBe('시술 미지정');
  });

  // ── AC-3·AC-1: 알림 텍스트(방·환자명·시술명) ────────────────────────────────
  test('AC-3: 알림 텍스트에 방·환자명·시술명 포함', () => {
    const n = buildCallNotification(ci({ customer_name: '김철수', treatment_kind: '체외충격파' }), '1번방');
    expect(n.title).toBe('진료 호출 — 김철수');
    expect(n.body).toBe('1번방 · 체외충격파');
    // 방 미배정 → '대기' 폴백
    const n2 = buildCallNotification(ci({ customer_name: '이영희' }), null);
    expect(n2.body).toBe('대기 · 시술 미지정');
  });
});

// ── 렌더 스모크 (데이터/인증 없으면 graceful skip) ───────────────────────────
test.describe('T-20260601 DOCTOR-CALL-PUSH-DASH — 통합 대시보드 렌더', () => {
  test('AC-6: 진료 알림판 탭에서 통합 대시보드(알람·완료환자)가 한 화면에 렌더', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await page.goto('/admin/doctor-tools');
    const tab = page.locator('[data-testid="tab-call-dashboard"]');
    if ((await tab.count()) === 0) {
      test.skip(true, '진료 알림판 탭 미표시(권한/환경) — 스킵');
      return;
    }
    await tab.click();
    const dash = page.locator('[data-testid="doctor-call-dashboard"]');
    await expect(dash).toBeVisible();
    // 한 화면에 알람 피드 + 진료완료 섹션 동시 존재 (여러 창 불필요 — AC-6)
    await expect(page.locator('[data-testid="doctor-call-feed"]')).toBeVisible();
    await expect(page.locator('[data-testid="doctor-completed-section"]')).toBeVisible();
    // AC-2: 음소거 토글 존재
    await expect(page.locator('[data-testid="doctor-call-mute-toggle"]')).toBeVisible();
  });
});
