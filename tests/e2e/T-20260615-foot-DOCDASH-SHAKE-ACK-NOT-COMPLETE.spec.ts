/**
 * E2E spec — T-20260615-foot-DOCDASH-SHAKE-ACK-NOT-COMPLETE  (SUPERSEDED)
 *
 * ⚠ 이 티켓의 접근(2-탭 arm 땜질: ✋ 초록 두 번째 탭에서만 완료)은
 *   후속 P0 핫픽스 T-20260615-foot-SHAKEHAND-NO-COMPLETE 로 대체됐다.
 *   교정 방향이 "✋ = 수신확인(ack) 전용, 완료는 별도 명시 액션(TreatmentCompleteButton)"으로 바뀌어
 *   armedCompleteCalls(arm 레지스트리)·초록 탭 완료 전이가 전부 제거됐다.
 *
 * 권위 스펙: tests/e2e/T-20260615-foot-SHAKEHAND-NO-COMPLETE.spec.ts
 * 본 파일은 supersede 사실을 박제하는 회귀 가드만 유지한다(arm 부활 차단).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DASH = () =>
  readFileSync(join(HERE, '../../src/components/doctor/DoctorCallDashboard.tsx'), 'utf-8');

test.describe('SUPERSEDED — 2-탭 arm 접근은 폐기됨(SHAKEHAND-NO-COMPLETE 로 대체)', () => {
  test('arm 레지스트리(armedCompleteCalls)가 부활하지 않는다', () => {
    expect(DASH()).not.toContain('armedCompleteCalls');
  });

  test('✋ HandToggle 본문에 완료 전이가 결합되지 않는다(ack 전용 환원 유지)', () => {
    const s = DASH();
    const start = s.indexOf('function HandToggle(');
    const end = s.indexOf('// ─── 진료완료 버튼', start);
    const fn = s.slice(start, end > 0 ? end : undefined);
    expect(fn).not.toContain('applyStatusFlagTransition');
  });
});
