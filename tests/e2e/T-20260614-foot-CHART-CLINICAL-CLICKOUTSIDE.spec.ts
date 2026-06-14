/**
 * E2E spec — T-20260614-foot-CHART-CLINICAL-CLICKOUTSIDE (문지은 대표원장)
 * 진료 알림판(DoctorCallDashboard) '차트' 칼럼의 📝 임상경과 토글(showClinical)이 수정모드(인라인 한 줄
 * 입력 + 담당의 + 저장)로 열린 상태에서, 토글 영역 바깥을 마우스로 클릭하면 토글이 닫히고 수정모드 진입
 * 이전 상태로 복귀(미저장 폐기)하는 clickOutside 동작.
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH spec(POSTDEPLOY-REFINE-5 / CALLUX-3FIX) 컨벤션 동일.
 *
 * AC:
 *   AC-1 외부 클릭(mousedown) → 토글 닫힘. 기존 RxPopover clickOutside(mousedown) 패턴 재사용(신규 라이브러리 0).
 *   AC-2 닫히면 안 되는 '내부' 3종 제외 — (1) 📝 토글 버튼(toggleBtnRef), (2) 인라인 입력 영역(inlineRef =
 *        입력·담당의 선택·저장 버튼=embed footer 포함), (3) embed 내부 portal 팝오버(// 상용구 자동완성·
 *        담당의 변경 확인) = clinical-singleline-phrase-popover / clinical-singleline-doctor-confirm.
 *   AC-3 닫힘 = 인라인 embed 언마운트 → 작성 중 미저장분 폐기(수정모드 진입 이전 상태 복귀).
 *
 * GUARD: 임상경과 입력(📝 singleLine) 동선·미리보기 펼침(item④)·슈퍼상용구(RX-SUPER-PHRASE) 회귀 금지.
 *        MedicalChartPanel 무변경(clickOutside 는 토글 소유자 DoctorCallDashboard 에만 추가).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 외부 클릭(mousedown) 으로 토글 닫힘 (기존 패턴 재사용)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 — 외부 클릭 mousedown 으로 닫힘', () => {
  test('공용 훅 useClinicalToggleClickOutside 가 mousedown 리스너로 onClose 호출', () => {
    const s = DASH();
    expect(s).toContain('function useClinicalToggleClickOutside');
    // 기존 RxPopover 와 동일 패턴: document mousedown 리스너.
    const hookStart = s.indexOf('function useClinicalToggleClickOutside');
    const hookEnd = s.indexOf('\nfunction ', hookStart + 1);
    const hook = s.slice(hookStart, hookEnd);
    expect(hook).toContain("addEventListener('mousedown'");
    expect(hook).toContain("removeEventListener('mousedown'");
    expect(hook).toContain('onClose()');
    // open=false 면 리스너 미부착(불필요 글로벌 핸들러 방지).
    expect(hook).toContain('if (!open) return;');
  });

  test('두 행(대기/완료) 모두 showClinical=false 로 닫는 onClose 주입', () => {
    const s = DASH();
    // useCallback(() => setShowClinical(false), []) 형태가 2회(CallFeedRow·CompletedRow) 존재.
    const occ = [...s.matchAll(/useCallback\(\(\) => setShowClinical\(false\), \[\]\)/g)];
    expect(occ.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 토글 '내부' 3종 제외(닫히지 않음)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 — 내부 클릭은 닫히지 않음(3종 제외)', () => {
  test('(1) 📝 토글 버튼 ref 제외 — 재토글은 onClick 이 처리', () => {
    const s = DASH();
    const hook = sliceHook(s);
    expect(hook).toContain('toggleBtnRef.current?.contains(node)');
    // 두 행 📝 버튼에 ref 부착.
    expect(s).toContain('ref={clinicalBtnRef}');
    expect((s.match(/ref=\{clinicalBtnRef\}/g) || []).length).toBe(2);
  });

  test('(2) 인라인 입력 영역(입력·담당의·저장=embed footer) ref 제외', () => {
    const s = DASH();
    const hook = sliceHook(s);
    expect(hook).toContain('inlineRef.current?.contains(node)');
    // 두 행 인라인 embed <td> 에 ref 부착(전체 입력/담당의/저장 버튼 포함).
    expect((s.match(/ref=\{clinicalInlineRef\}/g) || []).length).toBe(2);
    // ref 가 붙는 td 가 실제 embed singleLine 을 감싸는 셀인지 확인.
    expect(s).toMatch(/ref=\{clinicalInlineRef\}[^>]*data-testid="doctor-call-chart-inline"/);
    expect(s).toMatch(/ref=\{clinicalInlineRef\}[^>]*data-testid="doctor-completed-chart-inline"/);
  });

  test('(3) embed 내부 portal 팝오버(상용구 자동완성·담당의 확인) 는 closest 로 내부 취급', () => {
    const s = DASH();
    const hook = sliceHook(s);
    // createPortal 로 body 에 빠지는 두 팝오버 testid 를 closest 로 제외.
    expect(hook).toContain('clinical-singleline-phrase-popover');
    expect(hook).toContain('clinical-singleline-doctor-confirm');
    expect(hook).toContain('.closest?.(');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 닫힘 = 인라인 언마운트(미저장 폐기, 수정모드 이전 복귀)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 — 닫힘 시 인라인 언마운트(미저장 폐기)', () => {
  test('인라인 embed 는 showClinical 조건부 렌더 → 닫히면 언마운트(폼 폐기)', () => {
    const s = DASH();
    // showClinical && customer_id 조건 렌더 = false 전이 시 MedicalChartPanel 언마운트.
    expect(s).toContain('{showClinical && checkIn.customer_id && (');
    // 두 행 모두 인라인 행 존재.
    expect(s).toContain('doctor-call-chart-inline-row');
    expect(s).toContain('doctor-completed-chart-inline-row');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GUARD — 기존 동선 회귀 금지
// ─────────────────────────────────────────────────────────────────────────────
test.describe('GUARD — 회귀 금지', () => {
  test('임상경과 입력(📝 singleLine) 동선·미리보기 펼침(item④) 보존', () => {
    const s = DASH();
    expect(s).toContain('setShowClinical');
    expect(s).toContain('variant="clinical"');
    expect(s).toContain('singleLine');
    // item④ 미리보기 펼침 토글은 별개 축으로 보존.
    expect(s).toContain('doctor-call-clinical-expand-btn');
    expect(s).toContain('setExpandClinical');
  });

  test('MedicalChartPanel 은 clickOutside 변경에서 제외(RX-SUPER-PHRASE 회귀 차단)', () => {
    // 토글 소유자(DoctorCallDashboard)에만 clickOutside 추가 — embed 컴포넌트는 무변경.
    const panel = SRC('components/MedicalChartPanel.tsx');
    expect(panel).not.toContain('useClinicalToggleClickOutside');
    // 슈퍼상용구 라우팅 동선 보존.
    expect(panel).toContain('RX-SUPER-PHRASE');
  });
});

function sliceHook(s: string): string {
  const start = s.indexOf('function useClinicalToggleClickOutside');
  const end = s.indexOf('\nfunction ', start + 1);
  return s.slice(start, end);
}
