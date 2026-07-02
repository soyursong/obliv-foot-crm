/**
 * E2E spec — T-20260702-foot-MEDCHART-PROGRESS-DUMMY-UNHARDCODE (풋센터 원장, P1)
 * 진료차트 > 진료경과 하드코딩 더미 제거 — medical_charts.clinical_progress 환자·방문별 fetch.
 *
 * 현상: 실차트 0건 환자에게 고정 더미(DUMMY_CHARTS 5건, 모든 환자 동일 clinical_progress 텍스트)를 렌더
 *       → 환자를 바꿔 열어도 진료경과가 같은 고정 텍스트로 표시되던 버그.
 * 수정: 하드코딩/목데이터 상수 완전 제거. 실데이터 없으면 빈 상태 placeholder 노출.
 *       진료경과 본문은 loadData의 medical_charts fetch(customer_id·clinic_id·visit_date)가 환자·방문별로 채움.
 *       ⚠ read(fetch·바인딩) 경로만 수정 — 저장/쓰기(handleSave·clinical_progress upsert) 무변경.
 *
 * 본 스펙은 이 레포의 진료차트 검증 컨벤션(소스 정적 검증 + 회귀 가드)을 따른다.
 *
 * AC 매핑:
 *   AC-1 두 명 이상 환자를 순서대로 열면 진료경과가 각자 다르게 표시(환자별 DB fetch — 고정 더미 아님).
 *   AC-2 저장 후 재진입 시 저장 내용 그대로 로드(쓰기 회귀 없음).
 *   AC-3 기존 dummy/hardcoded 값이 코드에서 완전 제거(상수·목데이터 잔존 0).
 *   AC-4 진료경과 없는 환자 → 고정 더미가 아니라 빈 상태/placeholder 노출.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 하드코딩 더미/목데이터 완전 제거
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 하드코딩 더미 완전 제거', () => {
  test('DUMMY_CHARTS 상수 배열이 코드에서 제거됨', () => {
    const src = PANEL();
    expect(src).not.toContain('const DUMMY_CHARTS');
    expect(src).not.toContain('DUMMY_CHARTS');
  });

  test('더미 샘플 고정 텍스트(진료경과/진단) 잔존 0', () => {
    const src = PANEL();
    // 구 더미가 모든 환자에 동일하게 뿌리던 고정 문자열들 — 완전 부재.
    expect(src).not.toContain('더미 샘플');
    expect(src).not.toContain('테스트용 데이터');
    expect(src).not.toContain('1회차 시술 후 경과 양호');
    expect(src).not.toContain('2회차 통증 30% 감소');
    expect(src).not.toContain('진균 감소 확인');
    expect(src).not.toContain('굳은살 80% 제거');
    expect(src).not.toContain('초진 — 티눈 확인 및 계획 수립');
    // 더미 id 시드 생성 부재(가드용 startsWith 방어코드는 무해하나, 더미 데이터 생성은 0).
    expect(src).not.toMatch(/id:\s*['"`]__dummy__/);
  });

  test('더미 모드 배너/라벨 폐지 — isDummyMode 상태 제거', () => {
    const src = PANEL();
    expect(src).not.toContain('isDummyMode');
    expect(src).not.toContain('실데이터 없음 — 더미 샘플 표시 중');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 진료경과는 환자·방문별 DB fetch (고정 더미 아님)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 환자·방문별 clinical_progress fetch', () => {
  test('medical_charts를 customer_id 기준으로 조회(환자별 독립)', () => {
    const src = PANEL();
    // loadData의 medical_charts 조회가 customer_id·clinic_id로 스코프 → 환자마다 다른 결과.
    expect(src).toMatch(/from\(['"]medical_charts['"]\)[\s\S]{0,200}\.eq\(['"]customer_id['"],\s*customerId\)/);
    expect(src).toMatch(/\.eq\(['"]clinic_id['"],\s*clinicId\)/);
    // visit_date 정렬(방문별 타임라인).
    expect(src).toMatch(/\.order\(['"]visit_date['"]/);
  });

  test('진료경과 렌더는 chart.clinical_progress(각 차트 값) 바인딩 — 하드코딩 아님', () => {
    const src = PANEL();
    expect(src).toContain('chart.clinical_progress');
    // 폼 로드도 선택 차트의 clinical_progress에서 복원.
    expect(src).toContain('setFormClinical(chart.clinical_progress');
  });

  test('displayCharts는 활성 차트(activeCharts) 기반 — 더미 fallback 없음', () => {
    const src = PANEL();
    // 더미로 치환하던 삼항 fallback(`: DUMMY_CHARTS`) 부재.
    expect(src).not.toMatch(/:\s*DUMMY_CHARTS/);
    expect(src).toContain('const activeCharts = charts');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — 진료경과 없는 환자: 빈 상태 placeholder (더미 아님)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 빈 상태 placeholder', () => {
  test('isEmptyState 기반 안내 placeholder 렌더', () => {
    const src = PANEL();
    expect(src).toContain('const isEmptyState');
    expect(src).toContain('data-testid="medchart-empty-state"');
    expect(src).toMatch(/isEmptyState\s*&&/);
  });

  test('placeholder는 더미가 아니라 "기록 없음" 안내', () => {
    const src = PANEL();
    expect(src).toContain('아직 진료 기록이 없습니다');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 쓰기/저장 회귀 없음 (read 경로만 수정)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 저장 로직 무변경 (회귀 가드)', () => {
  test('clinical_progress upsert(저장) 페이로드 보존', () => {
    const src = PANEL();
    expect(src).toContain('clinical_progress: formClinical.trim() || null');
  });

  test('진료의 NOT NULL 강제(의료법) 저장 게이트 보존', () => {
    const src = PANEL();
    expect(src).toContain('formSigningDoctorId');
  });
});
