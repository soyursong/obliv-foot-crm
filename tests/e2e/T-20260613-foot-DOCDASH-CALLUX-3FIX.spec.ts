/**
 * E2E spec — T-20260613-foot-DOCDASH-CALLUX-3FIX
 * 진료 알림판(DoctorCallDashboard) UX 3종 (문지은 대표원장, MONOTONE-RELAYOUT 위 빌드).
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH spec 컨벤션 동일.
 *
 * 항목1(AC-1) 컬럼 순서 재배치: 방|상태|이름|생년(만나이)|차트번호|오늘시술|차트|처방|임상경과 (+시간=기본보존, 대기테이블 끝).
 *            생년(만나이) 신설 셀 = customers.birth_date 파생 "YYYY (만 N세)".
 * 항목2(AC-2) 임상경과 진료의 변경: '변경' 버튼 기본 비노출 → 레이블 클릭 드롭다운 + 다른 의사 선택 시 재확인 모달.
 * 항목3(AC-3) 처방완료 버튼: 즉시취소 금지 → 드롭다운(수정/취소). 귀가 환자 비활성.
 * 항목4(AC-4) MONOTONE 회귀 보존: 손들기 ✋ 토글·차트 칼럼·처방 plainText 스코프 유지.
 *
 * ⚠ GUARD: DB 무변경(birth_date·chart_number read-only 파생). 진료의 NOT NULL 강제 / 처방게이트(inClinicRxGate) /
 *   useCancelConfirmedRx·rxUndo 취소 내부로직 / status_flag 전이 SSOT 회귀 금지.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');
const CHART = () => SRC('components/MedicalChartPanel.tsx');
const QRX = () => SRC('components/doctor/QuickRxBar.tsx');
const FORMAT = () => SRC('lib/format.ts');

// 헤더 <th>텍스트</th> 순서 추출 헬퍼 — 특정 thead 블록에서 칼럼 라벨 순서를 뽑는다.
function thOrder(block: string): string[] {
  return [...block.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1].trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// 항목1 / AC-1 — 컬럼 순서 재배치 + 생년(만나이) 신설
// ─────────────────────────────────────────────────────────────────────────────
test.describe('항목1/AC-1 — 컬럼 순서 재배치 + 생년(만나이)', () => {
  test('대기(호출) 테이블 헤더 순서: 방·상태·이름·생년(만나이)·차트번호·오늘시술·차트·처방·임상경과·시간', () => {
    const s = DASH();
    const start = s.indexOf('doctor-call-feed-table');
    const tbody = s.indexOf('doctor-call-feed-rows');
    const block = s.slice(start, tbody);
    expect(thOrder(block)).toEqual([
      '방', '상태', '이름', '생년(만나이)', '차트번호', '오늘시술', '차트', '처방', '임상경과', '시간',
    ]);
  });

  test('완료 테이블 헤더 순서: 방·상태·이름·생년(만나이)·차트번호·오늘시술·차트·처방·임상경과 (시간 없음)', () => {
    const s = DASH();
    const start = s.indexOf('doctor-completed-table');
    const tbody = s.indexOf('doctor-completed-rows');
    const block = s.slice(start, tbody);
    const order = thOrder(block);
    expect(order).toEqual([
      '방', '상태', '이름', '생년(만나이)', '차트번호', '오늘시술', '차트', '처방', '임상경과',
    ]);
    // UX7 보존: 완료 테이블엔 시간(경과시간) 칼럼 없음
    expect(order).not.toContain('시간');
  });

  test('생년(만나이) 신설 셀 — birth_date 파생 표기(양 테이블)', () => {
    const s = DASH();
    expect(s).toContain('birthYearAgeDisplay');
    expect(s).toContain('readBirthDate');
    expect(s).toContain('data-testid="doctor-call-birth"');
    expect(s).toContain('data-testid="doctor-completed-birth"');
    // CALL_SELECT join 에 birth_date 추가(read-only)
    expect(s).toContain('customers!customer_id(chart_number, birth_date)');
  });

  test('birthYearAgeDisplay 헬퍼 — 세기추정 + "YYYY (만 N세)" 포맷', () => {
    const s = FORMAT();
    expect(s).toContain('export function birthYearAgeDisplay');
    expect(s).toContain('만 ');
    // 2자리 연도 세기 추정 규칙(YY ≤ 현재연도2자리 → 2000년대)
    expect(s).toMatch(/yy <= curYY \? 2000 : 1900/);
  });

  test('colspan 갱신 — 대기 10 / 완료 9(인라인 임상경과 펼침행 폭 정합)', () => {
    const s = DASH();
    expect(s).toMatch(/DOCDASH_COLSPAN = 10/);
    expect(s).toMatch(/DOCDASH_COMPLETED_COLSPAN = 9/);
  });

  test('시간(경과시간) 칼럼 보존 — 대기 테이블 doctor-call-elapsed 유지(AC-1 기본보존)', () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-call-elapsed"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 항목2 / AC-2 — 임상경과 진료의 변경 UX
// ─────────────────────────────────────────────────────────────────────────────
test.describe('항목2/AC-2 — 임상경과 진료의 변경(변경버튼 숨김+드롭다운+재확인 모달)', () => {
  test('별도 "변경" 텍스트 버튼 제거 — 레이블 자체가 드롭다운 진입 트리거', () => {
    const s = CHART();
    // 구 '변경' 인라인 버튼(clinical-singleline-doctor-edit) 제거
    expect(s).not.toContain('clinical-singleline-doctor-edit');
    // 레이블(클릭→editingSingleDoctor) 유지
    expect(s).toContain('data-testid="clinical-singleline-doctor-label"');
    expect(s).toMatch(/onClick=\{\(\) => setEditingSingleDoctor\(true\)\}/);
  });

  test('재확인 모달 — pendingDoctorChange state + 확인/취소 버튼', () => {
    const s = CHART();
    expect(s).toContain('pendingDoctorChange');
    expect(s).toContain('data-testid="clinical-singleline-doctor-confirm"');
    expect(s).toContain('data-testid="clinical-singleline-doctor-confirm-ok"');
    expect(s).toContain('data-testid="clinical-singleline-doctor-confirm-cancel"');
  });

  test('확인 시에만 진료의 반영(setFormSigningDoctorId), 취소/배경 시 무변경', () => {
    const s = CHART();
    // 확인 버튼이 pending.id 를 setFormSigningDoctorId 에 반영
    expect(s).toMatch(/setFormSigningDoctorId\(pendingDoctorChange\.id\)/);
    // 다른 의사 선택 시 즉시 반영이 아니라 pending 으로 보류
    expect(s).toMatch(/setPendingDoctorChange\(\{ id: next, name: nd\?\.name \?\? '' \}\)/);
  });

  test('GUARD — 진료의 NOT NULL 강제(미선택 빈값 → 즉시 반영 경로) 보존', () => {
    const s = CHART();
    // 빈값(clear)은 모달 없이 즉시 반영(NOT NULL 게이트가 저장 차단)
    expect(s).toMatch(/if \(!next\) \{\s*setFormSigningDoctorId\(''\);/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 항목3 / AC-3 — 처방완료 버튼 드롭다운(수정/취소)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('항목3/AC-3 — 처방완료 드롭다운(수정/취소)·귀가 비활성', () => {
  test('RxConfirmedSummary actionMenu prop — 드롭다운(수정/취소) 메뉴', () => {
    const s = QRX();
    expect(s).toContain('actionMenu');
    expect(s).toContain('data-testid="rx-confirmed-menu"');
    expect(s).toContain('data-testid="rx-confirmed-menu-edit"');
    expect(s).toContain('data-testid="rx-confirmed-menu-cancel"');
  });

  test('즉시 취소 제거 — actionMenu 클릭은 드롭다운 토글(handleButtonClick)', () => {
    const s = QRX();
    expect(s).toContain('function handleButtonClick');
    // 버튼 onClick 이 즉시-confirm(handleDoneClick) 직결이 아니라 handleButtonClick 경유
    expect(s).toMatch(/onClick=\{handleButtonClick\}/);
  });

  test('귀가(blockedByGate) 환자 — 버튼 비활성(actionMenu 시 cancellable 아니면 disabled)', () => {
    const s = QRX();
    expect(s).toMatch(/buttonDisabled = cancelMut\.isPending \|\| \(actionMenu \? !cancellable : !interactive\)/);
    // actionMenu 시 비활성이면 드롭다운 안 띄움
    expect(s).toMatch(/if \(!cancellable\) return; \/\/ AC-3/);
  });

  test('수정 → onOpenChart, 취소 → executeCancel(확인 팝업 + clean 원복) 재사용', () => {
    const s = QRX();
    expect(s).toContain('function executeCancel');
    // 취소 내부로직(useCancelConfirmedRx/rxUndo) 변경 금지 — executeCancel 이 cancelMut 사용
    expect(s).toContain('cancelMut');
    expect(s).toContain('처방완료를 취소할까요?');
  });

  test('GUARD — 다른 소비처(DoctorPatientList)는 actionMenu 미지정 → 종전 즉시동선 무회귀', () => {
    const s = SRC('components/doctor/DoctorPatientList.tsx');
    // DoctorPatientList 의 RxConfirmedSummary 에는 actionMenu 미부여(기본 false)
    const start = s.indexOf('<RxConfirmedSummary');
    const block = s.slice(start, start + 800);
    expect(block).not.toContain('actionMenu');
  });

  test('대시보드 양 테이블 RxConfirmedSummary 에 actionMenu 부여', () => {
    const s = DASH();
    const count = (s.match(/actionMenu/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 항목4 / AC-4 — MONOTONE 회귀 보존
// ─────────────────────────────────────────────────────────────────────────────
test.describe('항목4/AC-4 — MONOTONE 회귀 보존', () => {
  test('손들기 ✋ 토글(HandToggle) 상태 셀 유지', () => {
    const s = DASH();
    expect(s).toContain('HandToggle');
    expect(s).toContain('completed={false}');
    expect(s).toMatch(/completed\s*\n?\s*onRefresh/); // 완료 테이블 completed
  });

  test('차트 칼럼(📝/🩺) 보존', () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-call-chart-btn"');
    expect(s).toContain('data-testid="doctor-call-fullchart-btn"');
    expect(s).toContain('data-testid="doctor-completed-chart-btn"');
    expect(s).toContain('data-testid="doctor-completed-fullchart-btn"');
  });

  test('처방 plainText 스코프 + 차트번호 칼럼 보존', () => {
    const s = DASH();
    expect(s).toContain('plainText');
    expect(s).toContain('data-testid="doctor-call-chartno"');
    expect(s).toContain('chartNoDisplay');
  });
});
