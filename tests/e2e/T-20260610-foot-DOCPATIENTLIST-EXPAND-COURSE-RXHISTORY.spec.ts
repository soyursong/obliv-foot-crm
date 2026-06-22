/**
 * E2E spec — T-20260610-foot-DOCPATIENTLIST-EXPAND-COURSE-RXHISTORY
 * 진료환자목록(DoctorPatientList) 행 확장 영역에 임상경과 + 처방내역(read 뷰) 표시.
 *
 * 신고(문지은 대표원장 6/10): "(진료환자목록에서) 불가 뜨고, 임상경과·처방내역이 떠야 하는데 안 뜸, 차트연결 안됨"
 *   3요소 중 ①'불가 패널'·②'차트연결' 은 351dd72(BLOCKED-PANEL-HIDE) + 497672b(빈 렌더)로 이미 해소(prod 반영).
 *   본 티켓은 ③ "임상경과 + 처방내역 표시" DELTA 만 구현 — ①②(351dd72/497672b)를 다시 손대지 않음(회귀 금지).
 *
 * 구현(DELTA):
 *   확장 영역(expanded) 하단에 공통 상세 블록 추가 —
 *   - 처방내역: prescriptionOneLine(formatRxConfirmedSummary 정본) 다중약 전체 read 한 줄.
 *       확정 행은 상단 RxConfirmedSummary 가 이미 약물 표시 → 중복 방지로 !isConfirmed 행만 별도 표시.
 *   - 임상경과: MedicalChartPanel embed variant='clinical' (DoctorCallDashboard showClinical 동일 SSOT).
 *       customer_id + clinic_id 있을 때만. 기존 차트 있으면 read 모드(isReadOnly) 로드. 신규 조회경로/Drawer 없음.
 *
 * 검증(현장 클릭 시나리오 3종 → AC):
 *   S1: 비잔류(빠른처방 불가) 행 펼침 — QuickRxBar 빈 렌더(null)된 빈 자리에 임상경과+처방내역 표시(핵심, 최소요건 b).
 *   S2: 미확정 잔류 행 펼침 — QuickRxBar(처방버튼) + 임상경과 + 처방내역(read) 동반 표시.
 *   S3: 확정 행 펼침 — RxConfirmedSummary(처방완료 약물) + 임상경과 표시(처방내역은 상단 요약이 담당 → 하단 중복 없음).
 *   AC-3 회귀가드:
 *     R1: 351dd72/497672b 회귀금지 — QuickRxBar blockedByUiGate → return null, 'quick-rx-blocked'/'Ban'/차단용 차트열기 부활 금지.
 *     R2: QuickRxBar 빠른처방 버튼·게이트(blockedByUiGate) 배선 불변 + onOpenChart 전달 보존.
 *     R3: RxConfirmedSummary 회귀금지 — onOpenChart 전달 + rx-cancel-open-chart 보존.
 *     R4: 인접 DoctorCallDashboard 미접촉 — showClinical(MedicalChartPanel embed clinical) 패턴 보존.
 *     R5: 임상경과 재사용 = MedicalChartPanel embed clinical, 신규 Drawer/조회경로 신설 0.
 *
 * 스타일: 형제 티켓(QUICKRX-CHARTBTN/RXCANCEL-DISCHARGE-GATE)과 동일 — 표시 결정 in-page 모사
 *   + 소스 정적 배선 가드. auth/DB 비의존(page 미사용 순수 함수).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

// ── 정본 모사: 확장 상세 블록의 표시 결정 ─────────────────────────────────────
//   구현 정본(DoctorPatientList.tsx) = `{expanded && (...)}` 공통 블록:
//   - 처방내역 read 라인 = !isConfirmed 일 때만(확정 행은 상단 RxConfirmedSummary가 담당).
//   - 임상경과(MedicalChartPanel embed clinical) = customer_id && clinicId 일 때만.
interface ExpandDetail {
  showRxHistory: boolean;       // 하단 처방내역 read 라인 노출 여부
  showClinicalCourse: boolean;  // 하단 임상경과(임베드 차트) 노출 여부
}
function expandDetailRender(args: {
  expanded: boolean;
  isConfirmed: boolean;
  customerId: string | null;
  clinicId: string | null;
}): ExpandDetail {
  if (!args.expanded) return { showRxHistory: false, showClinicalCourse: false };
  return {
    showRxHistory: !args.isConfirmed,
    showClinicalCourse: !!args.customerId && !!args.clinicId,
  };
}

const CLINIC = 'clinic-1';
const CUST = 'cust-1';

// ─────────────────────────────────────────────────────────────────────────────
// S1 — 비잔류(빠른처방 불가) 행 펼침: 빈 자리에 임상경과 + 처방내역 표시 (핵심)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 — 비잔류(불가) 행 확장: 임상경과+처방내역으로 빈 자리 채움', () => {
  test('비잔류 미확정 행 펼침 → 처방내역(read) + 임상경과 모두 표시', () => {
    // 비잔류 = QuickRxBar 가 빈 렌더(null) → 본 블록이 빈 자리를 채움.
    const r = expandDetailRender({ expanded: true, isConfirmed: false, customerId: CUST, clinicId: CLINIC });
    expect(r.showRxHistory).toBe(true);
    expect(r.showClinicalCourse).toBe(true);
  });

  test('고객정보 없으면(customer_id null) 임상경과 미표시 — 폴백 안내', () => {
    const r = expandDetailRender({ expanded: true, isConfirmed: false, customerId: null, clinicId: CLINIC });
    expect(r.showClinicalCourse).toBe(false);
    // 처방내역 read 라인은 여전히 표시(임상경과만 N/A).
    expect(r.showRxHistory).toBe(true);
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    expect(src).toContain('data-testid="expand-clinical-na"');
  });

  test('확장 블록 testid + 처방내역/임상경과 testid 존재', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    expect(src).toContain('data-testid="patient-expand-detail"');
    expect(src).toContain('data-testid="expand-rx-history"');
    expect(src).toContain('data-testid="expand-clinical-course"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 — 미확정 잔류 행 펼침: 처방버튼(QuickRxBar) + 임상경과 + 처방내역 동반
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 — 미확정 잔류 행 확장: 처방버튼 + 임상경과 + 처방내역', () => {
  test('미확정 행 → 처방내역 read + 임상경과 동반 표시', () => {
    const r = expandDetailRender({ expanded: true, isConfirmed: false, customerId: CUST, clinicId: CLINIC });
    expect(r.showRxHistory).toBe(true);
    expect(r.showClinicalCourse).toBe(true);
  });

  test('처방내역 read = prescriptionOneLine(formatRxConfirmedSummary 정본) 재사용 — 신규 포맷 신설 0', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    // 정본 한 줄 포맷 재사용(다중약 전체). 확장 블록에서 prescriptionOneLine 호출.
    expect(src).toMatch(/function prescriptionOneLine/);
    const block = src.match(/data-testid="expand-rx-history"[\s\S]*?<\/div>/);
    expect(block, 'expand-rx-history 블록 존재').not.toBeNull();
    expect(block![0]).toContain('prescriptionOneLine(row.prescription_items)');
  });

  test('접힌 행(expanded=false)은 상세 블록 미렌더', () => {
    const r = expandDetailRender({ expanded: false, isConfirmed: false, customerId: CUST, clinicId: CLINIC });
    expect(r.showRxHistory).toBe(false);
    expect(r.showClinicalCourse).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 — 확정 행 펼침: RxConfirmedSummary + 임상경과 (처방내역 하단 중복 없음)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 — 확정 행 확장: 처방완료 약물 + 임상경과, 하단 처방내역 중복 없음', () => {
  test('확정 행 → 임상경과 표시 + 하단 처방내역 라인 미표시(상단 RxConfirmedSummary가 담당)', () => {
    const r = expandDetailRender({ expanded: true, isConfirmed: true, customerId: CUST, clinicId: CLINIC });
    expect(r.showClinicalCourse).toBe(true);
    // 중복 방지: 확정 행은 하단 처방내역 read 라인 미노출.
    expect(r.showRxHistory).toBe(false);
  });

  test('하단 처방내역 라인은 !isConfirmed 가드로 조건부 — 소스 정합', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    // expand-rx-history 가 !isConfirmed 가드 안에 위치.
    //   T-20260617-foot-DOCDASH-DOCLIST-5FIX B2-5: 진료완료(isVisitDone) read-only preview 도입으로
    //   `!isConfirmed && !isVisitDone &&` 형태가 됨 → 선택적 !isVisitDone 가드 허용(게이팅 의도 불변).
    expect(src).toMatch(/\{!isConfirmed && (?:!isVisitDone && )?\([\s\S]*?data-testid="expand-rx-history"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R1/R2 — 351dd72/497672b(BLOCKED-PANEL-HIDE) 회귀금지 + QuickRxBar 게이트 불변
// ─────────────────────────────────────────────────────────────────────────────
test.describe('R1/R2 회귀가드 — 불가패널 빈 렌더 + 빠른처방 게이트 불변', () => {
  test('R1: QuickRxBar blockedByUiGate → return null (앰버 차단패널/Ban/차단용 차트열기 부활 금지)', () => {
    const src = SRC('components/doctor/QuickRxBar.tsx');
    expect(src).toMatch(/if\s*\(blockedByUiGate\)\s*\{\s*return null;\s*\}/);
    expect(src).not.toContain('quick-rx-blocked');
    expect(src).not.toContain('data-testid="quick-rx-open-chart"');
    expect(src).not.toMatch(/\bBan\b/);
  });

  test('R2: DoctorPatientList → QuickRxBar JSX 블록 보존 + onOpenChart 전달 보존', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    const block = src.match(/<QuickRxBar[\s\S]*?\/>/);
    expect(block, 'QuickRxBar JSX 블록 존재').not.toBeNull();
    expect(block![0]).toContain('onOpenChart={onOpenChart}');
    // 빠른처방 미확정 분기(!isConfirmed) 자체 보존.
    //   T-20260617 B2-5: `!isVisitDone &&` 가드 추가 → 선택적 허용(분기 보존 의도 불변).
    expect(src).toMatch(/\{expanded && !isConfirmed && (?:!isVisitDone && )?\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R3 — RxConfirmedSummary 회귀금지
// ─────────────────────────────────────────────────────────────────────────────
test.describe('R3 회귀가드 — RxConfirmedSummary 차트열기/취소게이트 보존', () => {
  test('R3: RxConfirmedSummary JSX onOpenChart 전달 + 귀가 차트열기 동선 보존', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    const block = src.match(/<RxConfirmedSummary[\s\S]*?\/>/);
    expect(block, 'RxConfirmedSummary JSX 블록 존재').not.toBeNull();
    expect(block![0]).toContain('onOpenChart={onOpenChart}');
    //   T-20260617 B2-5: `!isVisitDone &&` 가드 추가 → 선택적 허용(분기 보존 의도 불변).
    expect(src).toMatch(/\{expanded && isConfirmed && (?:!isVisitDone && )?\(/);
    const qsrc = SRC('components/doctor/QuickRxBar.tsx');
    expect(qsrc).toContain('rx-cancel-open-chart');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R4/R5 — 인접 DoctorCallDashboard 미접촉 + 임상경과 재사용(신규 Drawer 신설 0)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('R4/R5 회귀가드 — 인접 미접촉 + MedicalChartPanel embed clinical 재사용', () => {
  test('R4: DoctorCallDashboard showClinical(embed clinical) 패턴 보존(미접촉)', () => {
    const src = SRC('components/doctor/DoctorCallDashboard.tsx');
    // 인접 컴포넌트의 임상경과 인라인(embed clinical) 패턴이 그대로 존재해야 함.
    expect(src).toMatch(/variant="clinical"/);
    expect(src).toMatch(/showClinical/);
    expect(src).toMatch(/import MedicalChartPanel from '@\/components\/MedicalChartPanel'/);
  });

  test('R5: DoctorPatientList 임상경과 = MedicalChartPanel embed variant="clinical" 재사용', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    expect(src).toMatch(/import MedicalChartPanel from '@\/components\/MedicalChartPanel'/);
    const block = src.match(/data-testid="expand-clinical-course"[\s\S]*?<\/MedicalChartPanel>|data-testid="expand-clinical-course"[\s\S]*?\/>/);
    expect(block, 'expand-clinical-course 블록 존재').not.toBeNull();
    expect(block![0]).toContain('embed');
    expect(block![0]).toContain('variant="clinical"');
    expect(block![0]).toContain('customerId={row.customer_id}');
    expect(block![0]).toContain('clinicId={clinicId}');
    // 신규 Drawer/조회경로 신설 금지 — 별도 supabase from('medical_charts') 신설 쿼리 없음(패널이 SSOT).
    expect(src).not.toMatch(/createPortal|<Drawer/);
  });
});
