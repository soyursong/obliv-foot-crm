/**
 * E2E spec — T-20260620-foot-CHART-DOCISSUE-BTN
 * 진료차트 '서류 발급하기' 버튼 신규 연결 (문지은 대표원장, #project-doai-crm-풋확장).
 *
 * 스펙:
 *   - 진료차트(MedicalChartPanel) '새 기록' 칸 아래에 '서류 발급하기' 버튼 신규 추가.
 *   - 클릭 시 진료대시보드 진료완료환자 칼럼 서류아이콘과 '동일한' 서류발급 팝업(DoctorDocsHubDialog) 오픈
 *     → 기존 팝업 컴포넌트 재사용(신규 팝업 제작 금지).
 *
 * 수용 기준(AC):
 *   AC-1 '새 기록' 아래 '서류 발급하기' 버튼 노출 (data-testid="medical-chart-docissue-btn").
 *   AC-2 클릭 시 DoctorDocsHubDialog(대시보드와 동일 컴포넌트) 오픈.
 *   AC-3 팝업에서 기존과 동일 발급 — DoctorDocsHubDialog 내부 로직 무변경(import/재사용만).
 *   AC-4 환자 컨텍스트 정합: 당일 check_in 을 customer_id+clinic_id 로 조회해 checkIn 으로 전달.
 *        오늘 체크인 없는 환자는 팝업을 열지 않고 안내(엉뚱한 환자 발급 X).
 *   AC-5 회귀 방지: 대시보드 경유 서류발급 동선 무변경(별도 트리거).
 *
 * 스타일: 정본 소스 정적 검증(회귀 가드) + 조회→오픈 결정 로직 모사. auth/DB 비의존(unit 프로젝트).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

const MEDCHART = () => SRC('components/MedicalChartPanel.tsx');

// ── 정본 모사: openDocsHub 의 '조회 결과 → 팝업 오픈 여부' 결정 ───────────────────
//   당일 check_in 1건이 조회되면 docsCheckIn 채우고 open. 없으면 안내 토스트만(팝업 미오픈).
function decideDocsOpen(row: { id: string } | null): { open: boolean; checkIn: { id: string } | null; toast: boolean } {
  if (!row) return { open: false, checkIn: null, toast: true };
  return { open: true, checkIn: row, toast: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// S1 — AC-1: '서류 발급하기' 버튼이 '새 기록' 칸 아래에 신규 노출
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 AC-1 — 새 기록 아래 서류 발급하기 버튼', () => {
  test('docissue 버튼 testid + 라벨이 소스에 존재', () => {
    const src = MEDCHART();
    expect(src).toContain('data-testid="medical-chart-docissue-btn"');
    expect(src).toContain('서류 발급하기');
  });

  test('서류 발급하기 버튼이 새 기록 버튼 뒤(아래)에 배치', () => {
    const src = MEDCHART();
    const newBtn = src.indexOf('data-testid="medical-chart-new-btn"');
    const docBtn = src.indexOf('data-testid="medical-chart-docissue-btn"');
    expect(newBtn).toBeGreaterThan(-1);
    expect(docBtn).toBeGreaterThan(-1);
    expect(docBtn).toBeGreaterThan(newBtn); // DOM 순서상 새 기록 다음 = 화면상 아래
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 — AC-2/AC-3: 기존 DoctorDocsHubDialog 재사용(신규 팝업 제작 금지)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 AC-2/AC-3 — 동일 서류발급 팝업 재사용', () => {
  test('DoctorDocsHubDialog 를 import 하고 렌더', () => {
    const src = MEDCHART();
    expect(src).toContain("import DoctorDocsHubDialog from '@/components/doctor/DoctorDocsHubDialog'");
    expect(src).toContain('<DoctorDocsHubDialog');
  });

  test('대시보드(DoctorCallDashboard)와 동일 컴포넌트 경로를 가리킨다', () => {
    const dash = SRC('components/doctor/DoctorCallDashboard.tsx');
    expect(dash).toContain("import DoctorDocsHubDialog from '@/components/doctor/DoctorDocsHubDialog'");
    // 양쪽이 같은 모듈을 재사용 → 신규 팝업 제작 0
    expect(MEDCHART()).toContain("'@/components/doctor/DoctorDocsHubDialog'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 — AC-4: 환자 컨텍스트 정합 (당일 check_in 조회 → checkIn 전달)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 AC-4 — 컨텍스트 정합(당일 check_in 조회)', () => {
  test('customer_id + clinic_id 로 당일 check_in 을 조회', () => {
    const src = MEDCHART();
    // openDocsHub 내 조회 게이트
    expect(src).toMatch(/openDocsHub/);
    expect(src).toContain(".eq('customer_id', customerId)");
    expect(src).toContain(".eq('clinic_id', clinicId)");
    // customers 임베드 포함(DoctorDocsHubDialog visitorFromCheckIn 가 chart/birth 요구)
    expect(src).toContain('customers!customer_id(chart_number, birth_date)');
  });

  test('조회된 row → docsCheckIn 을 dialog 의 checkIn 으로 전달', () => {
    const src = MEDCHART();
    expect(src).toContain('checkIn={docsCheckIn}');
  });

  test('조회 결과 있음 → 팝업 오픈, checkIn 채워짐', () => {
    const d = decideDocsOpen({ id: 'ci-9' });
    expect(d.open).toBe(true);
    expect(d.checkIn).toEqual({ id: 'ci-9' });
    expect(d.toast).toBe(false);
  });

  test('오늘 체크인 없는 환자 → 팝업 미오픈 + 안내(엉뚱한 환자 발급 X)', () => {
    const d = decideDocsOpen(null);
    expect(d.open).toBe(false);
    expect(d.checkIn).toBeNull();
    expect(d.toast).toBe(true);
  });

  test('소스: 오늘 체크인 없을 때 안내 토스트 분기 존재', () => {
    const src = MEDCHART();
    expect(src).toContain('오늘 내원(체크인) 기록이 없어');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S4 — AC-5: 대시보드 경유 동선 회귀 방지(별도 트리거, 컴포넌트 무변경)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S4 AC-5 — 대시보드 동선 회귀 방지', () => {
  test('대시보드는 기존 openDocsHub(행 CheckIn 직접 전달) 트리거 유지', () => {
    const dash = SRC('components/doctor/DoctorCallDashboard.tsx');
    expect(dash).toContain('onOpenDocs={openDocsHub}');
    expect(dash).toContain('checkIn={docsHubCheckIn}');
  });
});
