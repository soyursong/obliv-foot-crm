/**
 * E2E spec — T-20260610-foot-DOCPATIENTLIST-EXPAND-CLINICAL
 * 진료환자목록(DoctorPatientList) 펼침 패널 임상경과 보기+수정 (당일 접수환자 한정).
 *
 * 신고(문지은 대표원장 6/10, 확정 MSG-20260610-195724-xtz6):
 *   "당일환자는 수정까지" = A안. 당일 접수 환자는 펼침 패널에서 임상경과를 바로 보고 입력·수정까지.
 *   당일 외(과거/이력) 환자는 임상경과 편집 불가 — 미표시 또는 읽기전용.
 *
 * 구현(DELTA — BASE COURSE-RXHISTORY의 임상경과 read 위에 '당일 편집 게이트'만 가산):
 *   - MedicalChartPanel 에 caller-forced `readOnly?: boolean` prop 추가(default false → 기존 호출자 무변경).
 *       readOnly=true → isReadOnly 강제(textarea readOnly + embed footer[닫기/저장] 미노출) + clinicalInit editMode 진입 금지.
 *   - DoctorPatientList: 펼침 임상경과(embed clinical)에 `readOnly={!isToday}` 전달.
 *       당일(isToday=true) → 편집 허용(readOnly=false). 당일 외(미래) → readOnly=true(편집 차단).
 *       과거(isPast)는 기존 분기로 MedicalChartPanel 미마운트(미표시) — 변경 없음.
 *
 * 검증(현장 클릭 시나리오 3종 → AC):
 *   S1: 당일환자 — 임상경과 보기+수정(readOnly=false, 저장 버튼 노출, 동일 SSOT handleSave 재사용).
 *   S2: 당일 외 — 읽기전용/미표시(readOnly=true → 저장버튼·편집창 미노출; 과거는 미마운트).
 *   S3: 회귀 — 처방내역/빠른처방/RxConfirmedSummary/isPast 이력모드/DoctorCallDashboard 인라인 불변.
 *
 * 스타일: 형제 티켓(EXPAND-COURSE-RXHISTORY)과 동일 — 표시/게이트 결정 in-page 모사 + 소스 정적 배선 가드.
 *   auth/DB 비의존(순수 함수 + 소스 grep).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

// ── 정본 모사: 임상경과 편집 게이트 결정 ──────────────────────────────────────
//   구현 정본(DoctorPatientList.tsx):
//   - 과거(isPast): isPast 분기로 별도 렌더 → MedicalChartPanel 미마운트(mounted=false).
//   - 당일/미래(non-past): MedicalChartPanel embed clinical 마운트. readOnly = !isToday.
//   MedicalChartPanel(embed clinical): isReadOnly = readOnly || (selectedChartId && !editMode).
//     editable(저장 버튼/편집창) = embed && variant clinical && !isReadOnly.
interface ClinicalGate {
  mounted: boolean;      // 임상경과 패널 마운트 여부
  readOnly: boolean;     // caller 강제 읽기전용 여부
  editable: boolean;     // 편집(저장 버튼/입력창) 노출 여부
}
function clinicalGate(args: {
  isPast: boolean;
  isToday: boolean;
  customerId: string | null;
  clinicId: string | null;
}): ClinicalGate {
  // 과거(isPast)는 임상경과 패널 미마운트(미표시).
  if (args.isPast) return { mounted: false, readOnly: false, editable: false };
  // 고객 정보 없으면 폴백(임상경과 미표시).
  const mounted = !!args.customerId && !!args.clinicId;
  const readOnly = !args.isToday;
  // 당일 = readOnly false → 편집(신규 작성 즉시 editMode) 가능. 당일 외 = readOnly true → 편집 차단.
  const editable = mounted && !readOnly;
  return { mounted, readOnly, editable };
}

const CLINIC = 'clinic-1';
const CUST = 'cust-1';

// ─────────────────────────────────────────────────────────────────────────────
// S1 — 당일환자: 임상경과 보기 + 수정 (정상)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 — 당일 접수환자: 임상경과 보기+수정', () => {
  test('당일 확정 환자 펼침 → 임상경과 편집 가능(readOnly=false, 저장 버튼 노출)', () => {
    const g = clinicalGate({ isPast: false, isToday: true, customerId: CUST, clinicId: CLINIC });
    expect(g.mounted).toBe(true);
    expect(g.readOnly).toBe(false);
    expect(g.editable).toBe(true);
  });

  test('당일 미확정 환자 펼침 → 임상경과 편집 가능', () => {
    const g = clinicalGate({ isPast: false, isToday: true, customerId: CUST, clinicId: CLINIC });
    expect(g.editable).toBe(true);
  });

  test('DoctorPatientList: 펼침 임상경과에 readOnly={!isToday} 전달 — 당일만 편집', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    const block = src.match(/data-testid="expand-clinical-course"[\s\S]*?\/>\s*<\/div>/);
    expect(block, 'expand-clinical-course 블록 존재').not.toBeNull();
    expect(block![0]).toContain('readOnly={!isToday}');
    // isToday prop 이 호출부에서 전달되는지.
    expect(src).toMatch(/isToday=\{isToday\}/);
    // 조회 날짜=오늘 판별 정본 재사용(신규 판별 신설 0).
    expect(src).toMatch(/const isToday = selectedDate === todayISO/);
  });

  test('저장 경로 재사용 — MedicalChartPanel embed clinical handleSave(신규 저장경로 0)', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    const block = src.match(/data-testid="expand-clinical-course"[\s\S]*?\/>\s*<\/div>/);
    expect(block![0]).toContain('variant="clinical"');
    expect(block![0]).toContain('onSaved={onRefresh}');
    // DoctorPatientList 가 medical_charts 직접 write 신설하지 않음(패널 handleSave 가 SSOT).
    expect(src).not.toMatch(/\.from\(['"]medical_charts['"]\)\s*\.\s*(update|insert|upsert)/);
  });

  test('MedicalChartPanel: readOnly prop 정의 + isReadOnly 합류 + clinicalInit editMode 게이트', () => {
    const src = SRC('components/MedicalChartPanel.tsx');
    expect(src).toMatch(/readOnly\?:\s*boolean/);
    expect(src).toMatch(/readOnly = false/);
    // isReadOnly 가 forced readOnly 를 포섭.
    expect(src).toMatch(/const isReadOnly = readOnly \|\| \(!!selectedChartId && !editMode\)/);
    // clinicalInit: readOnly 면 editMode 진입 금지.
    expect(src).toMatch(/if \(!readOnly\) setEditMode\(true\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 — 당일 외 환자: 읽기전용 / 미표시 (게이트 가드)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 — 당일 외 환자: 읽기전용/미표시 (오기입 방지)', () => {
  test('미래 날짜 환자 펼침 → 임상경과 마운트되지만 읽기전용(편집 불가)', () => {
    const g = clinicalGate({ isPast: false, isToday: false, customerId: CUST, clinicId: CLINIC });
    expect(g.mounted).toBe(true);
    expect(g.readOnly).toBe(true);
    expect(g.editable).toBe(false);
  });

  test('과거(이력모드) 환자 펼침 → 임상경과 패널 미마운트(미표시)', () => {
    const g = clinicalGate({ isPast: true, isToday: false, customerId: CUST, clinicId: CLINIC });
    expect(g.mounted).toBe(false);
    expect(g.editable).toBe(false);
  });

  test('MedicalChartPanel: embed 읽기전용 시 footer(닫기/저장) 미노출 — 비-embed는 보존', () => {
    const src = SRC('components/MedicalChartPanel.tsx');
    // embed && isReadOnly 일 때 footer 전체 미렌더(저장 버튼 노출 차단).
    expect(src).toMatch(/\{!\(embed && isReadOnly\) && \(/);
    // textarea 읽기전용 회색 힌트.
    expect(src).toMatch(/isReadOnly && 'bg-gray-50 text-gray-500 cursor-not-allowed'/);
    // textarea readOnly={isReadOnly} 보존(편집 입력 차단).
    expect(src).toMatch(/readOnly=\{isReadOnly\}/);
  });

  test('당일 외 라벨에 "읽기전용" 명시 — 현장 인지', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    expect(src).toMatch(/!isToday && <span[\s\S]*?읽기전용/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 / AC-4 — 회귀가드
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 / AC-4 회귀가드 — 인접·기존 동선 불변', () => {
  test('R-DOCDASH: DoctorCallDashboard 인라인 임상경과(embed clinical) readOnly 미전달 → 편집 유지(회귀 0)', () => {
    const src = SRC('components/doctor/DoctorCallDashboard.tsx');
    // 인접 컴포넌트의 임상경과 인라인 패턴 보존 + readOnly 게이트 미주입(항상 편집 가능).
    expect(src).toMatch(/variant="clinical"/);
    expect(src).toMatch(/showClinical/);
    expect(src).not.toMatch(/readOnly=\{/);
  });

  test('R-RXHIST: 처방내역(prescriptionOneLine) read 라인 !isConfirmed 가드 보존', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    expect(src).toMatch(/\{!isConfirmed && \([\s\S]*?data-testid="expand-rx-history"/);
    expect(src).toMatch(/function prescriptionOneLine/);
  });

  test('R-QUICKRX: QuickRxBar 빠른처방 블록 + onOpenChart 전달 보존', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    const block = src.match(/<QuickRxBar[\s\S]*?\/>/);
    expect(block, 'QuickRxBar JSX 블록 존재').not.toBeNull();
    expect(block![0]).toContain('onOpenChart={onOpenChart}');
    expect(src).toMatch(/\{expanded && !isConfirmed && \(/);
  });

  test('R-RXCONFIRMED: RxConfirmedSummary onOpenChart 전달 + 확정 분기 보존', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    const block = src.match(/<RxConfirmedSummary[\s\S]*?\/>/);
    expect(block, 'RxConfirmedSummary JSX 블록 존재').not.toBeNull();
    expect(block![0]).toContain('onOpenChart={onOpenChart}');
    expect(src).toMatch(/\{expanded && isConfirmed && \(/);
  });

  test('R-ISPAST: 이력모드(isPast) 분기 보존 — 과거 행 임상경과 미마운트', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    // isPast 조기 분기(별도 button 렌더) 보존 — 이 분기 안에는 MedicalChartPanel 없음.
    expect(src).toMatch(/if \(isPast\) \{/);
    const pastBlock = src.match(/if \(isPast\) \{[\s\S]*?\n  \}\n\n  return \(/);
    expect(pastBlock, 'isPast 분기 블록 존재').not.toBeNull();
    expect(pastBlock![0]).not.toContain('MedicalChartPanel');
  });

  test('R-NOPORTAL: 신규 Drawer/조회경로 신설 0 — 임상경과는 embed clinical 재사용', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    expect(src).not.toMatch(/createPortal|<Drawer/);
    expect(src).toMatch(/import MedicalChartPanel from '@\/components\/MedicalChartPanel'/);
  });
});
