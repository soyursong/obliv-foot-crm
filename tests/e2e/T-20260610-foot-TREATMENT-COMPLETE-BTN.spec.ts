/**
 * E2E spec — T-20260610-foot-TREATMENT-COMPLETE-BTN  [SUPERSEDED]
 *
 * 원본 결정(문지은 대표원장, 6/10): DoctorCallDashboard 활성 호출(purple)에 '진료완료' 버튼 추가
 *   (의사/직원 공통, 클릭 시 purple→pink 전이).
 *
 * ⚠ SUPERSEDED — T-20260616-foot-DOCDASH-COMPLETEBTN-REMOVE (김주연 총괄 확정, slack_ts 1781584427.576269):
 *   '진료완료' 별도 버튼(TreatmentCompleteButton, doctor-call-complete-btn)을 제거하고,
 *   완료(purple→pink) 처리를 칸반 '상태 플래그 메뉴 → 진료완료(핑크)'로 일원화한다.
 *   → 기존 '버튼 존재' 런타임 검증은 더 이상 유효하지 않다(버튼 제거가 합의 상태).
 *
 * 본 spec 은 회귀 박제만 유지한다: 버튼이 다시 살아나지 않음(완료경로 회귀 방지).
 *   완료 동선의 적극 검증(상태 메뉴→핑크→진료완료 섹션·staff 접근성)은
 *   T-20260616-foot-DOCDASH-COMPLETEBTN-REMOVE.spec.ts 가 담당.
 *
 * 정적 소스 검증 스타일(데이터 시드 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');

test.describe('T-20260610 TREATMENT-COMPLETE-BTN — SUPERSEDED by COMPLETEBTN-REMOVE', () => {
  test('진료완료 버튼(TreatmentCompleteButton)이 복원되지 않는다(제거 합의 박제)', () => {
    const s = DASH();
    expect(s).not.toContain('function TreatmentCompleteButton(');
    expect(s).not.toContain('<TreatmentCompleteButton');
    expect(s).not.toContain('data-testid="doctor-call-complete-btn"');
  });

  test('완료 전이(applyStatusFlagTransition pink)는 이 화면에서 호출되지 않는다(상태 메뉴로 이전)', () => {
    expect(DASH()).not.toContain("applyStatusFlagTransition(checkIn, 'pink'");
  });
});
