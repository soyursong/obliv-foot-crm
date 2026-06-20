/**
 * E2E spec — T-20260620-foot-MEDCHART-HEADER-NAV-LAYOUT-STABLE (FE-only, DB 무변경)
 * 진료기록 헤더 회차(←/→) 이동 시 가로 layout shift 제거 (문지은 대표원장).
 *
 * RC(AC-0): 좌측 타이틀 `진료 기록 … — {fmtDateFull(formDate)}` 가 content-fit.
 *   fmtDateFull = `yyyy년 M월 d일 (EEE)` (월/일 비-padding → 1~2자리 가변). 회차 이동 시
 *   날짜 텍스트 길이가 달라져 타이틀 span 폭이 변동 → 형제 회차 네비 div 가 좌우로 밀림.
 *
 * FIX(AC-1/2): 날짜 부분을 고정 min-width(10rem) inline-block(좌측 정렬)으로 분리.
 *   짧은 날짜는 우측 여백으로 흡수 → 폭 불변 → 화살표/회차 배지 위치 고정.
 *   최장 케이스 수용으로 truncate/overflow 없음. 데이터·회차 로직 무변경(표시 폭만).
 *
 * 스타일: 라이브 서버 없이 정본 소스(MedicalChartPanel.tsx) + fmtDateFull 포맷 규칙을
 *   in-page 순수 함수로 모사해 회귀를 잡는다 (MEDCHART-PANEL-CLARITY spec 동일 패턴).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const PANEL_SRC = readFileSync(
  resolve(__dir, '../../src/components/MedicalChartPanel.tsx'),
  'utf-8',
);

// ── 정본 모사: fmtDateFull 포맷 규칙 (yyyy년 M월 d일 (EEE), 월/일 비-padding) ──────
//   실제 구현은 date-fns format(...,'yyyy년 M월 d일 (EEE)') — 자릿수 가변성만 모사.
const fmtDateLen = (y: number, m: number, d: number, weekday: string): string =>
  `${y}년 ${m}월 ${d}일 (${weekday})`;

// ─────────────────────────────────────────────────────────────────────────────
// AC-0: RC — 날짜 텍스트가 회차마다 길이가 달라진다 (가변폭 원인)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-0 RC: 날짜 텍스트 길이 가변성', () => {
  test('1자리 월/일 vs 2자리 월/일 회차의 날짜 문자열 길이가 다르다', () => {
    const short = fmtDateLen(2026, 6, 1, '월');   // "2026년 6월 1일 (월)"
    const long = fmtDateLen(2026, 12, 30, '수');  // "2026년 12월 30일 (수)"
    expect(long.length).toBeGreaterThan(short.length); // content-fit이면 폭이 달라짐 → shift 원인
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 날짜 부분 고정 min-width inline-block (폭 불변 보장)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 날짜 고정 폭 컨테이너', () => {
  test('날짜 전용 span(data-testid=medical-chart-form-title-date)이 존재한다', () => {
    expect(PANEL_SRC).toContain('data-testid="medical-chart-form-title-date"');
  });

  test('날짜 span은 inline-block + min-w-[10rem] 고정 폭을 갖는다', () => {
    // 날짜 testid 와 동일 라인/근방에 inline-block min-w-[10rem] 클래스가 있어야 함.
    const idx = PANEL_SRC.indexOf('medical-chart-form-title-date');
    expect(idx).toBeGreaterThan(-1);
    const around = PANEL_SRC.slice(Math.max(0, idx - 200), idx);
    expect(around).toContain('inline-block');
    expect(around).toContain('min-w-[10rem]');
  });

  test('fmtDateFull(formDate)이 날짜 전용 span 안에서 렌더된다', () => {
    // 날짜 span 영역에 fmtDateFull(formDate) 호출이 포함됨
    const idx = PANEL_SRC.indexOf('medical-chart-form-title-date');
    const block = PANEL_SRC.slice(idx, idx + 160);
    expect(block).toContain('fmtDateFull(formDate)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 헤더 전체 layout stable — 타이틀 span whitespace-nowrap (줄바꿈/폭변동 방지)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 헤더 layout stable', () => {
  test('타이틀 span(medical-chart-form-title)에 whitespace-nowrap 적용', () => {
    const idx = PANEL_SRC.indexOf('data-testid="medical-chart-form-title"');
    expect(idx).toBeGreaterThan(-1);
    const around = PANEL_SRC.slice(Math.max(0, idx - 200), idx);
    expect(around).toContain('whitespace-nowrap');
  });

  test('회차 네비(prev/배지/next)는 타이틀의 형제로 유지 — 폭 고정 시 위치 불변', () => {
    expect(PANEL_SRC).toContain('data-testid="chart-nav-prev"');
    expect(PANEL_SRC).toContain('data-testid="chart-nav-next"');
    expect(PANEL_SRC).toContain('회차'); // {chartsIdx+1}/{len}회차 배지
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1+2 모사: 고정 폭 컨테이너 모델에서 날짜 길이 차이가 폭에 영향 없음
// ─────────────────────────────────────────────────────────────────────────────
test.describe('회차 이동 시 폭 불변 (고정 min-width 모델)', () => {
  // min-w-[10rem] = 160px. 좌측 정렬이므로 컨텐츠가 더 짧으면 컨테이너 폭은 min-width 로 고정.
  const MIN_W_PX = 160;
  // 모사: 텍스트 폭(px) ≈ 한글 14 / 숫자·공백·괄호 8 (text-sm 근사). 자르지 않고 길이만 비교 목적.
  const approxTextPx = (s: string): number =>
    [...s].reduce((acc, ch) => acc + (/[가-힣]/.test(ch) ? 14 : 8), 0);
  // 고정 컨테이너 폭 모델: max(컨텐츠폭, min-width)
  const containerPx = (s: string): number => Math.max(approxTextPx(s), MIN_W_PX);

  test('짧은 날짜·긴 날짜 모두 컨테이너 폭은 min-width(160px)로 동일 (가로 shift 0)', () => {
    const short = fmtDateLen(2026, 6, 1, '월');
    const long = fmtDateLen(2026, 12, 30, '수');
    // 두 케이스 모두 컨텐츠가 160px 미만이면 컨테이너 폭은 동일하게 160px → shift 0.
    expect(approxTextPx(short)).toBeLessThanOrEqual(MIN_W_PX);
    expect(approxTextPx(long)).toBeLessThanOrEqual(MIN_W_PX);
    expect(containerPx(short)).toBe(containerPx(long));
  });

  test('최장 케이스도 min-width 안에 들어와 truncate/overflow 없음', () => {
    const longest = fmtDateLen(2026, 12, 30, '수'); // 가장 긴 정상 케이스
    expect(approxTextPx(longest)).toBeLessThanOrEqual(MIN_W_PX); // 잘림 없이 수용
  });
});
