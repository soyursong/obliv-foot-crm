/**
 * E2E spec — T-20260522-foot-RESV-TREAT-UX
 * 시술내역 표시 UX 보정 (최신 1건 + 스타일 + 한글 매핑)
 *
 * AC-1: 최신 1건만 기본 표시 (slice(0,1))
 * AC-2: [회차] text-red-600 font-bold 스타일 적용
 * AC-3: 치료명 한글 매핑 (TREAT_KO) — heated_laser→가열, unheated_laser→비가열 등
 *
 * 시나리오 1: 소스코드 정적 검증 — TREAT_KO 상수 + slice(0,1) + text-red-600 font-bold
 * 시나리오 2: TREAT_KO 맵 정확성 검증
 * 시나리오 3: "더보기" 로직 1건 이상일 때 표시 검증 (코드 정적)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC = path.resolve(__dirname, '../../src/pages/Reservations.tsx');

test.describe('T-20260522-foot-RESV-TREAT-UX — 시술내역 UX 보정 정적 검증', () => {
  let src: string;

  test.beforeAll(() => {
    src = fs.readFileSync(SRC, 'utf-8');
  });

  // ── AC-1: 최신 1건만 표시 ──────────────────────────────────────────
  test('AC-1: treatHistory.slice(0,1) 로 최신 1건만 표시', () => {
    expect(src).toContain('treatHistory.slice(0, 1)');
    // 이전 10건 표시 코드가 없어야 함
    expect(src).not.toContain('treatHistory.slice(0, 10)');
  });

  test('AC-1: 더보기 버튼 조건이 1건 초과로 변경됨', () => {
    expect(src).toContain('treatHistory.length > 1');
    expect(src).not.toContain('treatHistory.length > 10');
  });

  test('AC-1: 더보기 카운트가 length-1 기준', () => {
    expect(src).toContain('treatHistory.length - 1}건 더');
  });

  // ── AC-2: 회차 빨간색+굵게 ─────────────────────────────────────────
  test('AC-2: 회차 span에 text-red-600 font-bold 클래스 존재', () => {
    expect(src).toContain('tabular-nums text-red-600 font-bold');
  });

  // ── AC-3: TREAT_KO 한글 매핑 ──────────────────────────────────────
  test('AC-3: TREAT_KO 상수 정의 존재', () => {
    expect(src).toContain('TREAT_KO');
    expect(src).toContain("heated_laser: '가열'");
    expect(src).toContain("unheated_laser: '비가열'");
    expect(src).toContain("podologue: '포돌로게'");
    expect(src).toContain("iv: '수액'");
    expect(src).toContain("trial: '체험권'");
  });

  test('AC-3: TREAT_KO 맵핑이 치료명 표시에 적용됨 (TREAT_KO[row.session_type] ?? ...)', () => {
    expect(src).toContain('TREAT_KO[row.session_type]');
  });

  // ── 회귀: 기존 RESV-TREAT-HISTORY AC 유지 ────────────────────────
  test('회귀: treat-history-panel testId 유지', () => {
    expect(src).toContain('data-testid="treat-history-panel"');
  });

  test('회귀: treat-history-loading / treat-history-empty testId 유지', () => {
    expect(src).toContain('data-testid="treat-history-loading"');
    expect(src).toContain('data-testid="treat-history-empty"');
  });

  test('회귀: treat-history-show-more 더보기 버튼 유지', () => {
    expect(src).toContain('data-testid="treat-history-show-more"');
  });

  // ── TREAT_KO 맵 정확성 (단위 테스트 대체) ────────────────────────
  test('TREAT_KO 매핑 값 정확성 — preconditioning 포함', () => {
    expect(src).toContain("preconditioning: '프컨'");
  });
});
