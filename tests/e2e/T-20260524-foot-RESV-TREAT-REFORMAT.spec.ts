/**
 * E2E spec — T-20260524-foot-RESV-TREAT-REFORMAT
 * 재진 예약 시술내역 패키지 구성 재편성 (5컬럼)
 *
 * AC-1: 시술내역 5컬럼 — 패키지명 / 회차 / 치료명 / 치료사 / 시술일
 * AC-2: packages JOIN + staff:performed_by(name) JOIN 추가
 * AC-3: 최신 1건 표시 유지 (RESV-TREAT-UX 규칙)
 * AC-4: 데이터 없는 컬럼 "—" fallback
 * AC-5: 기존 스타일 유지 (회차 빨간색+굵게, 치료명 한글 매핑)
 *
 * 시나리오 1: TreatHistoryRow 타입에 therapist_name 필드 존재
 * 시나리오 2: 쿼리에 performed_by + staff JOIN 추가 여부
 * 시나리오 3: 5컬럼 그리드 렌더링 — 치료사 헤더 + 셀 존재
 * 시나리오 4: fallback "—" 처리 확인
 * 시나리오 5: AC-3/AC-5 회귀 — slice(0,1), text-red-600 font-bold, TREAT_KO 유지
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC = path.resolve(__dirname, '../../src/pages/Reservations.tsx');

test.describe('T-20260524-foot-RESV-TREAT-REFORMAT — 시술내역 5컬럼 재편성', () => {
  let src: string;

  test.beforeAll(() => {
    src = fs.readFileSync(SRC, 'utf-8');
  });

  // ── AC-1: TreatHistoryRow 타입 ────────────────────────────────────
  test('AC-1: TreatHistoryRow에 therapist_name 필드 존재', () => {
    expect(src).toContain('therapist_name: string');
  });

  // ── AC-2: staff JOIN 쿼리 ─────────────────────────────────────────
  test('AC-2: package_sessions 쿼리에 performed_by 포함', () => {
    expect(src).toContain('performed_by');
  });

  test('AC-2: staff:performed_by(name) JOIN 포함', () => {
    expect(src).toContain('staff:performed_by(name)');
  });

  test('AC-2: staffObj?.name ?? fallback 처리', () => {
    expect(src).toContain('staffObj?.name');
  });

  // ── AC-1: 5컬럼 헤더 렌더링 ──────────────────────────────────────
  test('AC-1: 치료사 헤더 스팬 존재', () => {
    expect(src).toContain('<span>치료사</span>');
  });

  test('AC-1: 5컬럼 그리드 레이아웃 적용', () => {
    // grid-cols-[2fr_1fr_1fr_1fr_1.2fr] 또는 유사한 5컬럼
    expect(src).toMatch(/grid-cols-\[.*1fr.*1fr.*1fr.*\]/);
  });

  test('AC-1: 치료사 셀 row.therapist_name 렌더링', () => {
    expect(src).toContain('row.therapist_name');
  });

  // ── AC-4: fallback "—" ────────────────────────────────────────────
  test('AC-4: therapist_name fallback "—" 처리', () => {
    // staffObj?.name ?? '—' 패턴
    expect(src).toMatch(/staffObj\?\.name\s*\?\?\s*'—'/);
  });

  // ── AC-3: 최신 1건 유지 (회귀) ────────────────────────────────────
  test('AC-3 회귀: treatHistory.slice(0, 1) 최신 1건 유지', () => {
    expect(src).toContain('treatHistory.slice(0, 1)');
  });

  // ── AC-5: 기존 스타일 유지 (회귀) ────────────────────────────────
  test('AC-5 회귀: 회차 빨간색+굵게 스타일 유지', () => {
    expect(src).toContain('tabular-nums text-red-600 font-bold');
  });

  test('AC-5 회귀: TREAT_KO 한글 매핑 유지', () => {
    expect(src).toContain('TREAT_KO[row.session_type]');
    expect(src).toContain("heated_laser: '가열'");
  });

  // ── 회귀: testId 유지 ─────────────────────────────────────────────
  test('회귀: treat-history-panel testId 유지', () => {
    expect(src).toContain('data-testid="treat-history-panel"');
  });

  test('회귀: treat-history-row testId 유지', () => {
    expect(src).toContain('data-testid={`treat-history-row-${row.session_id}`}');
  });

  test('회귀: 더보기 버튼 유지', () => {
    expect(src).toContain('data-testid="treat-history-show-more"');
  });
});
