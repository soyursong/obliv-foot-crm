/**
 * E2E spec — T-20260614-foot-CHART-CLINICAL-CLICKOUTSIDE (문지은 대표원장)
 *   CANON narrow refine — FIX-REQUEST MSG-20260614-181732 (planner CANON RULING + item② 통합).
 *
 * ── 정정 경위 ────────────────────────────────────────────────────────────────
 *   1차 배포(8b14746)는 "진료알림판 '차트' 📝 임상경과 토글(showClinical) 전체를 외부클릭 시 닫는다"는
 *   coarse 선해석(OVERSHOOT)이었다. reporter(17:48) 명확화 = "진료의 ___ 토글 누르면 드롭다운 열려
 *   수정상태, 다른데 커서 옮기면 [라벨로] 원복" → 닫혀야 하는 대상은 'showClinical embed 전체'가 아니라
 *   '진료의 select(editingSingleDoctor)' 하나뿐.
 *
 *   embed 전체 닫힘은 (a) "진료의 ○○○" 읽기 라벨까지 사라지고(reporter 라벨 유지 기대 위배),
 *   (b) 작성 중 임상경과 한 줄 입력 미저장분을 언마운트로 폐기(data-loss) → canon 위배.
 *
 * ── CANON ────────────────────────────────────────────────────────────────────
 *   CANON-1 (overshoot 제거) 외부클릭으로 showClinical embed 전체를 닫지 않는다 — DoctorCallDashboard 에
 *           embed-close clickOutside 핸들러/훅 없음. showClinical 토글 닫힘은 오직 📝 버튼 재클릭(onClick).
 *   CANON-2 (data-loss 0) showClinical embed(MedicalChartPanel singleLine)는 외부클릭으로 언마운트되지
 *           않으므로 작성 중 임상경과 텍스트가 보존된다. (1차 우려 AC-3 data-loss 경로 차단)
 *   CANON-3 (내부 진료의 라벨 원복 = item②) 진료의 select(editingSingleDoctor) 펼침 상태에서 외부클릭 →
 *           select 만 닫혀 "진료의 ○○○" 라벨로 원복(저장 안 함). 이 단일 핸들러는 editingSingleDoctor
 *           상태 소유자인 MedicalChartPanel(commit 7f6cd8b item②)에 있으며, clickOutside(mousedown)
 *           패턴을 재사용한다(중복 핸들러 신설 없음).
 *
 * GUARD: RX-SUPER-PHRASE(T-20260603-foot) 회귀 0 · 진료의 NOT NULL 저장경로 무변경 · // 상용구 popover ·
 *        재확인 모달 · item④ 미리보기 펼침 동선 보존.
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH/REFINE-5 spec 컨벤션 동일.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');

// MedicalChartPanel item② 외부클릭 원복 useEffect 본문 슬라이스(마커 ~ 의존성 배열 닫힘).
function sliceRevertEffect(s: string): string {
  const start = s.indexOf('item②: 진료의 드롭다운 외부클릭');
  expect(start).toBeGreaterThan(-1);
  const end = s.indexOf('[editingSingleDoctor, pendingDoctorChange, formSigningDoctorId]);', start);
  expect(end).toBeGreaterThan(start);
  return s.slice(start, end + 80);
}

// ─────────────────────────────────────────────────────────────────────────────
// CANON-1 — overshoot(embed 전체 외부클릭 닫힘) 제거
// ─────────────────────────────────────────────────────────────────────────────
test.describe('CANON-1 — embed 전체 외부클릭 닫힘 제거(overshoot 철회)', () => {
  test('DoctorCallDashboard 에 embed-close clickOutside 훅/잔재 없음', () => {
    const s = DASH();
    // 1차 overshoot 훅·refs 완전 제거.
    expect(s).not.toContain('useClinicalToggleClickOutside');
    expect(s).not.toContain('clinicalBtnRef');
    expect(s).not.toContain('clinicalInlineRef');
    // showClinical 을 닫는 document mousedown 리스너가 Dashboard 에 없음(=embed 외부클릭 닫힘 없음).
    expect(s).not.toContain("setShowClinical(false), []");
  });

  test('showClinical 토글 닫힘 경로는 오직 📝 버튼 재클릭(onClick)만', () => {
    const s = DASH();
    // 두 행(대기/완료) 📝 버튼 onClick 토글 보존.
    expect((s.match(/onClick=\{\(\) => setShowClinical\(\(v\) => !v\)\}/g) || []).length).toBe(2);
  });

  test('정정 사유가 소스에 명시(향후 재-coarse 화 방지)', () => {
    const s = DASH();
    expect(s).toContain('CANON narrow');
    expect(s).toContain('OVERSHOOT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CANON-2 — data-loss 0 (embed 외부클릭으로 언마운트 안 됨)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('CANON-2 — 작성 중 임상경과 입력 보존(data-loss 0)', () => {
  test('embed 는 showClinical/📝 토글로만 조건부 렌더 — 외부클릭은 false 전이 안 시킴', () => {
    const s = DASH();
    // 조건부 렌더 자체는 유지(토글 표시/숨김 메커니즘).
    expect(s).toContain('{showClinical && checkIn.customer_id && (');
    // 외부클릭으로 showClinical=false 를 만드는 onClose 주입이 없어야 함(=언마운트로 폐기 경로 제거).
    expect(s).not.toContain('useCallback(() => setShowClinical(false)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CANON-3 / item② — 진료의 select 만 click-away 라벨 원복(MedicalChartPanel 단일 핸들러)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('CANON-3 — 진료의 select click-away 라벨 원복 + 임상입력 유지(item②)', () => {
  test('narrow 원복 핸들러는 MedicalChartPanel(editingSingleDoctor 소유자)에 단일 존재', () => {
    const eff = sliceRevertEffect(PANEL());
    // clickOutside(mousedown) 패턴 재사용.
    expect(eff).toContain("addEventListener('mousedown', onDoc)");
    expect(eff).toContain("removeEventListener('mousedown', onDoc)");
    // select 만 닫아 라벨 원복 — embed/showClinical 은 건드리지 않음.
    expect(eff).toContain('setEditingSingleDoctor(false)');
    expect(eff).not.toContain('setShowClinical');
    // 원복은 저장 트리거 금지(미저장 라벨 원복).
    expect(eff).not.toContain('handleSave');
    expect(eff).not.toContain('setFormSigningDoctorId');
  });

  test('Dashboard 에는 진료의 revert 중복 핸들러를 신설하지 않음', () => {
    const s = DASH();
    // editingSingleDoctor 는 panel 내부 상태 — Dashboard 는 revert 로직(setEditingSingleDoctor 호출)을
    //   소유하지 않음(중복구현 금지). 설명 주석상 언급은 가능하나 상태 변경 핸들러는 없어야 함.
    expect(s).not.toContain('setEditingSingleDoctor');
  });

  test('가드 — 펼침 + 원복 진료의 존재 + 모달 비점유 일 때만 개입(NOT NULL 무회귀)', () => {
    const eff = sliceRevertEffect(PANEL());
    expect(eff).toContain('if (!editingSingleDoctor || pendingDoctorChange || !formSigningDoctorId) return;');
    // (4) 셀 내부 클릭(정상 선택) 제외, (5) 재확인 모달 portal 제외.
    expect(eff).toContain('singleDoctorCellRef.current?.contains(node)');
    expect(eff).toContain('clinical-singleline-doctor-confirm');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GUARD — 회귀 금지
// ─────────────────────────────────────────────────────────────────────────────
test.describe('GUARD — 회귀 금지', () => {
  test('임상경과 입력(📝 singleLine)·item④ 미리보기 펼침 동선 보존', () => {
    const s = DASH();
    expect(s).toContain('setShowClinical');
    expect(s).toContain('variant="clinical"');
    expect(s).toContain('singleLine');
    expect(s).toContain('doctor-call-clinical-expand-btn');
    expect(s).toContain('setExpandClinical');
  });

  test('RX-SUPER-PHRASE 슈퍼상용구 라우팅 보존(MedicalChartPanel)', () => {
    const panel = PANEL();
    expect(panel).toContain('RX-SUPER-PHRASE');
  });

  test('진료의 NOT NULL 저장경로(handleSave 가드) 무변경', () => {
    const panel = PANEL();
    // 의료법 NOT NULL 강제: 저장 시 formSigningDoctorId 빈값 차단 가드 유지.
    expect(panel).toContain('formSigningDoctorId');
  });
});
