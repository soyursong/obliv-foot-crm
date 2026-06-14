/**
 * E2E spec — T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item② (문지은 대표원장 U0ALGAAAJAV)
 *
 * 대상 surface = 진료대시보드(DoctorCallDashboard / 진료알림판)의 임베드 진료차트(MedicalChartPanel
 * singleLine) "진료의 ○○○" 셀. (차트 탭 아님)
 *
 * 버그: "진료의 ○○○" 레이블 클릭 → 진료의 드롭다운(select, editingSingleDoctor=true) 즉시 펼침 →
 *       다른 곳으로 커서 이동/외부클릭(blur) 해도 드롭다운(수정상태)이 그대로 유지됨.
 * 기대: blur(외부 mousedown) → 드롭다운 닫고 원래(접힘) 레이블 상태로 원복(저장 안 함).
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH/CLICKOUTSIDE spec 컨벤션 동일.
 *
 * AC:
 *   AC-1 외부 mousedown(blur) → setEditingSingleDoctor(false) 로 레이블 원복. 기존 RxPopover/
 *        InlinePatientSearch clickOutside(mousedown) 패턴 재사용(신규 라이브러리 0).
 *   AC-2 정상 '선택' 보존 — 진료의 셀 컨테이너(레이블/select) 내부 클릭은 제외(contains 가드).
 *   AC-3 재확인 모달(pendingDoctorChange) 떠있는 동안은 비개입(모달이 소유) + 모달 portal 내부 제외.
 *   AC-4 원복할 진료의가 없으면(formSigningDoctorId 빈값) 비개입 — NOT NULL 강제 드롭다운 유지(무회귀).
 *   AC-5 셀 컨테이너는 display:contents(className="contents") — flex 레이아웃 무영향, DOM 포함관계만.
 *
 * GUARD: 진료의 NOT NULL 강제(AC-P2-6, 의료법, handleSave `if (!formSigningDoctorId)`) 무변경.
 *        임상경과 singleLine 입력·// 상용구 자동완성(phrase-popover)·재확인 모달 동선 회귀 금지.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');

// 외부클릭 원복 useEffect 본문만 슬라이스 — 마커 주석 ~ 의존성 배열 닫힘까지.
function sliceRevertEffect(s: string): string {
  const start = s.indexOf('item②: 진료의 드롭다운 외부클릭');
  expect(start).toBeGreaterThan(-1);
  const end = s.indexOf('[editingSingleDoctor, pendingDoctorChange, formSigningDoctorId]);', start);
  expect(end).toBeGreaterThan(start);
  return s.slice(start, end + 80);
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 외부 mousedown(blur) 으로 레이블 원복 (기존 패턴 재사용)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 — 외부 mousedown 으로 접힘 원복', () => {
  test('document mousedown 리스너로 setEditingSingleDoctor(false) 호출(저장 없음)', () => {
    const eff = sliceRevertEffect(PANEL());
    expect(eff).toContain("addEventListener('mousedown', onDoc)");
    expect(eff).toContain("removeEventListener('mousedown', onDoc)");
    expect(eff).toContain('setEditingSingleDoctor(false)');
    // blur 원복은 저장 트리거 금지 — 핸들러 내 handleSave/setFormSigningDoctorId 미호출.
    expect(eff).not.toContain('handleSave');
    expect(eff).not.toContain('setFormSigningDoctorId');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 정상 '선택' 보존(셀 내부 클릭 제외)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 — 진료의 셀 내부 클릭은 원복 안 함(선택 보존)', () => {
  test('singleDoctorCellRef.contains(node) 면 early-return(원복 skip)', () => {
    const eff = sliceRevertEffect(PANEL());
    expect(eff).toContain('singleDoctorCellRef.current?.contains(node)');
    expect(eff).toMatch(/singleDoctorCellRef\.current\?\.contains\(node\)\)\s*return;/);
  });

  test('진료의 셀(레이블/select)이 singleDoctorCellRef 컨테이너로 감싸짐', () => {
    const s = PANEL();
    expect(s).toContain('const singleDoctorCellRef = useRef<HTMLSpanElement>(null);');
    // 컨테이너 <span ref=...> 안에 레이블/select 가 함께 존재.
    const openIdx = s.indexOf('<span ref={singleDoctorCellRef}');
    expect(openIdx).toBeGreaterThan(-1);
    // 컨테이너 종료 = 임상경과 입력 주석 직전(중첩 <span> 다수라 첫 </span> 로 자르면 안 됨).
    const closeIdx = s.indexOf('임상경과 — 한 줄 입력', openIdx);
    expect(closeIdx).toBeGreaterThan(openIdx);
    const inner = s.slice(openIdx, closeIdx);
    expect(inner).toContain('data-testid="clinical-singleline-doctor-label"'); // 레이블
    expect(inner).toContain('data-testid="clinical-singleline-doctor"'); // select 드롭다운
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 재확인 모달 비개입 + 모달 portal 제외
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 — 재확인 모달(pendingDoctorChange) 비개입', () => {
  test('모달 떠있으면 effect 미부착(가드) + 모달 portal 내부 클릭 제외', () => {
    const eff = sliceRevertEffect(PANEL());
    // 가드 조건에 pendingDoctorChange 포함 → 모달 중에는 리스너 자체가 안 붙음.
    expect(eff).toMatch(/if \([^)]*pendingDoctorChange[^)]*\) return;/);
    // 모달 portal(clinical-singleline-doctor-confirm) 내부 클릭은 closest 제외.
    expect(eff).toContain("closest?.('[data-testid=\"clinical-singleline-doctor-confirm\"]')");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — 미선택(빈값)일 땐 비개입 (NOT NULL 강제 무회귀)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 — formSigningDoctorId 빈값이면 드롭다운 유지', () => {
  test('가드에 !formSigningDoctorId early-return 포함', () => {
    const eff = sliceRevertEffect(PANEL());
    expect(eff).toMatch(/if \([^)]*!formSigningDoctorId[^)]*\) return;/);
    expect(eff).toMatch(/if \(!editingSingleDoctor/);
  });

  test('진료의 NOT NULL 강제(handleSave 게이트) 무변경 — 가드 토스트 그대로', () => {
    const s = PANEL();
    expect(s).toContain('진료의가 필요합니다 — 담당 의사를 선택해주세요');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5 — 컨테이너 레이아웃 무영향(display:contents)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-5 — 컨테이너 flex 레이아웃 무영향', () => {
  test('singleDoctorCellRef span 은 className="contents"(레이아웃 박스 미생성)', () => {
    const s = PANEL();
    expect(s).toContain('<span ref={singleDoctorCellRef} className="contents">');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GUARD — 회귀 가드
// ─────────────────────────────────────────────────────────────────────────────
test.describe('GUARD — 기존 동선 무회귀', () => {
  test('singleLine 진료의 레이블 클릭 → setEditingSingleDoctor(true) 진입 보존', () => {
    const s = PANEL();
    expect(s).toContain('onClick={() => setEditingSingleDoctor(true)}');
  });

  test('재확인 모달 동선(pendingDoctorChange → 확인 시에만 반영) 보존', () => {
    const s = PANEL();
    expect(s).toContain('setPendingDoctorChange({ id: next, name: nd?.name ?? \'\' })');
    expect(s).toContain('setFormSigningDoctorId(pendingDoctorChange.id)');
  });

  test('// 상용구 자동완성 popover(clinical-singleline-phrase-popover) 무변경', () => {
    const s = PANEL();
    expect(s).toContain('data-testid="clinical-singleline-phrase-popover"');
  });
});
