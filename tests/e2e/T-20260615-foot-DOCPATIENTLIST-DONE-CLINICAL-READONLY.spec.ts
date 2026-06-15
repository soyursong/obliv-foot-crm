/**
 * E2E spec — T-20260615-foot-DOCPATIENTLIST-DONE-CLINICAL-READONLY
 * 진료환자목록(DoctorPatientList) 펼침 임상경과 패널 — 진료완료 환자 읽기전용 + 내용 없으면 빈 편집폼 금지.
 *
 * 신고(문지은 대표원장, #foot, item3 / MSG-20260615-115926-h2ek):
 *   "진료완료 환자는 읽기전용(편집/수정화면 금지), 내용 있을 때만 표시."
 *
 * 구현(DELTA — EXPAND-CLINICAL(cfa110b) 임상경과 편집 게이트 위에 '완료조건'만 가산):
 *   - DoctorPatientList: 진료완료 SSOT isVisitDone = completed_at || status_flag==='pink'
 *       (목록 필터 usePatients L285 · DoctorCallDashboard.completedPatients · RXLIST-RENAME-DOCFILTER 와 1:1 동일).
 *     임상경과 편집 활성 = '당일' AND '진료 미완료' → readOnly={!isToday || isVisitDone}.
 *     AC-3(당일 외 = 읽기전용)는 그대로 — 완료조건만 OR 가산(회귀 0).
 *   - MedicalChartPanel(embed clinical): isReadOnly && 임상경과 내용 비어있으면 — 담당의 select·textarea(빈 편집폼)
 *     미렌더, '작성된 임상경과가 없습니다.' 안내만(data-testid clinical-mini-empty-readonly). 내용 있을 때만 표시.
 *     읽기전용 시 진료의 미선택 경고(저장 프롬프트)도 미노출.
 *
 * 검증(현장 클릭 시나리오 3종 → AC):
 *   S1: 진료완료 환자 펼침 → 임상경과 읽기전용(저장버튼·편집 진입 차단), 당일이어도 편집 불가.
 *   S2: 진료 미완료(당일) 환자 → 편집 가능(회귀 0). / 읽기전용 + 내용 없음 → 빈 편집폼 미노출.
 *   S3: 회귀 — EXPAND-CLINICAL AC-3(당일외=읽기전용)·QuickRxBar·RxConfirmedSummary·DoctorCallDashboard 인라인 불변.
 *
 * 스타일: 형제 티켓(EXPAND-CLINICAL)과 동일 — 게이트 결정 in-page 모사 + 소스 정적 배선 가드(auth/DB 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

// ── 정본 모사: 진료완료 판정 + 임상경과 편집 게이트 ──────────────────────────────
//   isVisitDone = completed_at 보유 OR status_flag==='pink' (목록 필터·completedPatients 와 1:1 동일).
//   편집 활성 = 당일(isToday) AND 진료 미완료(!isVisitDone). readOnly = !isToday || isVisitDone.
function isVisitDone(row: { completed_at: string | null; status_flag: string | null }): boolean {
  return !!row.completed_at || row.status_flag === 'pink';
}
function clinicalReadOnly(args: { isToday: boolean; row: { completed_at: string | null; status_flag: string | null } }): boolean {
  return !args.isToday || isVisitDone(args.row);
}

// ─────────────────────────────────────────────────────────────────────────────
// S1 — 진료완료 환자: 읽기전용 (당일이어도 편집 차단)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 — 진료완료 환자: 임상경과 읽기전용', () => {
  test('당일 + completed_at 보유 → 읽기전용(편집 차단)', () => {
    const row = { completed_at: '2026-06-15T05:00:00Z', status_flag: null };
    expect(isVisitDone(row)).toBe(true);
    expect(clinicalReadOnly({ isToday: true, row })).toBe(true);
  });

  test('당일 + status_flag=pink(진료완료) → 읽기전용(편집 차단)', () => {
    const row = { completed_at: null, status_flag: 'pink' };
    expect(isVisitDone(row)).toBe(true);
    expect(clinicalReadOnly({ isToday: true, row })).toBe(true);
  });

  test('진료완료 판정 SSOT 1:1 — 목록 필터(usePatients)와 동일 식', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    // 행 단위 완료 판정.
    expect(src).toMatch(/const isVisitDone = !!row\.completed_at \|\| row\.status_flag === 'pink'/);
    // 목록 필터(L285)도 동일 식 — SSOT 일치.
    expect(src).toMatch(/\.filter\(\(row\) => !!row\.completed_at \|\| row\.status_flag === 'pink'\)/);
  });

  test('readOnly 게이트에 완료조건 가산 — readOnly={!isToday || isVisitDone}', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    const block = src.match(/data-testid="expand-clinical-course"[\s\S]*?\/>\s*<\/div>/);
    expect(block, 'expand-clinical-course 블록 존재').not.toBeNull();
    expect(block![0]).toContain('readOnly={!isToday || isVisitDone}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 — 진료 미완료 편집 유지(회귀 0) + 읽기전용 빈 편집폼 금지
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 — 미완료 편집 유지 + 빈 편집폼 금지', () => {
  test('당일 + 진료 미완료(미완료·non-pink) → 편집 가능(readOnly=false)', () => {
    const row = { completed_at: null, status_flag: 'purple' };
    expect(isVisitDone(row)).toBe(false);
    expect(clinicalReadOnly({ isToday: true, row })).toBe(false);
  });

  test('MedicalChartPanel: 읽기전용 + 임상경과 빈값 → 빈 편집폼 미렌더(기록 없음 안내만)', () => {
    const src = SRC('components/MedicalChartPanel.tsx');
    // 읽기전용 + 내용 비어있을 때 담당의 select·textarea 대신 안내 노출.
    expect(src).toMatch(/\{isReadOnly && !formClinical\.trim\(\) \? \(/);
    expect(src).toMatch(/data-testid="clinical-mini-empty-readonly"/);
    expect(src).toMatch(/작성된 임상경과가 없습니다/);
  });

  test('MedicalChartPanel: 읽기전용 시 진료의 미선택 경고(저장 프롬프트) 미노출', () => {
    const src = SRC('components/MedicalChartPanel.tsx');
    expect(src).toMatch(/\{!formSigningDoctorId && !isReadOnly && \(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 / AC-4 — 회귀가드 (EXPAND-CLINICAL field-soak 불변)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 / AC-4 회귀가드 — EXPAND-CLINICAL AC-3 불변', () => {
  test('R-AC3: 당일 외(미래) 읽기전용 유지 — 완료조건과 무관하게 readOnly', () => {
    const row = { completed_at: null, status_flag: 'purple' }; // 미완료지만
    expect(clinicalReadOnly({ isToday: false, row })).toBe(true); // 당일 외 → 읽기전용(AC-3)
  });

  test('R-LABEL: 읽기전용 라벨 게이트도 완료조건 가산', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    expect(src).toMatch(/\(!isToday \|\| isVisitDone\) &&[\s\S]*?읽기전용/);
  });

  test('R-READONLY-WIRING: MedicalChartPanel readOnly→isReadOnly 합류 + footer/textarea 가드 보존', () => {
    const src = SRC('components/MedicalChartPanel.tsx');
    expect(src).toMatch(/const isReadOnly = readOnly \|\| \(!!selectedChartId && !editMode\)/);
    expect(src).toMatch(/\{!\(embed && isReadOnly\) && \(/);
    expect(src).toMatch(/readOnly=\{isReadOnly\}/);
    expect(src).toMatch(/if \(!readOnly\) setEditMode\(true\)/);
  });

  test('R-DOCDASH: DoctorCallDashboard 인라인 임상경과 readOnly 미주입 — 편집 유지(회귀 0)', () => {
    const src = SRC('components/doctor/DoctorCallDashboard.tsx');
    expect(src).toMatch(/variant="clinical"/);
    expect(src).not.toMatch(/readOnly=\{/);
  });

  test('R-QUICKRX: QuickRxBar 빠른처방 분기(expanded && !isConfirmed) 보존 — 본 티켓 미간섭', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    expect(src).toMatch(/\{expanded && !isConfirmed && \(/);
    const block = src.match(/<QuickRxBar[\s\S]*?\/>/);
    expect(block![0]).toContain('onOpenChart={onOpenChart}');
  });

  test('R-NOPORTAL: 신규 read 스캐폴딩/Drawer 신설 0 — embed clinical 재사용', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    expect(src).not.toMatch(/createPortal|<Drawer/);
    expect(src).not.toMatch(/\.from\(['"]medical_charts['"]\)\s*\.\s*(update|insert|upsert)/);
  });
});
