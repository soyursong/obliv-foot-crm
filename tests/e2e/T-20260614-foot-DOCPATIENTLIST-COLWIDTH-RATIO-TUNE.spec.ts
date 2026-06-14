/**
 * E2E spec — T-20260614-foot-DOCPATIENTLIST-COLWIDTH-RATIO-TUNE (문지은 대표원장)
 * LISTCOL-WIDTH-SHRINK(취소) canonical 대체. 진료 환자목록 테이블(DoctorCallDashboard) 4컬럼 비율 축소.
 *
 * 기준: EXPAND-QUICKEDIT 배포본(commit f8ad7a9, bundle DoctorTools-DJDZh6-y.js).
 *   feed   = 5·9·11·9·8·9·6·24·14·5 (방·상태·이름·생년·차트번호·오늘시술·차트·처방·임상경과·시간)
 *   complt = 5·10·12·9·8·9·6·25·16 (방·상태·이름·생년·차트번호·오늘시술·차트·처방·임상경과)
 *
 * 비율: 방 ×0.75 · 상태 ×0.75 · 이름 ×0.50 · 처방 ×0.50.
 * 해방된 ~20%p(feed) / ~21%p(complt) 전량을 임상경과 본문(우선)에 재분배. 나머지 컬럼 불변.
 *   feed   → 4·7·6·9·8·9·6·12·34·5 (합 100)
 *   complt → 4·8·6·9·8·9·6·13·37   (합 100)
 *
 * ⚠ GUARD: CSS-only. DB 무변경, 신규 컴포넌트 0, colgroup w-[..] 값만 조정.
 *   부모 AC-2(컬럼앵커 팝오버)·AC-3(빠른수정) 회귀 0 — 폭만 변경.
 *   DoctorCallListBar.tsx 미터치(잘못된 surface 후보).
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH/COLWIDTH-EXPAND-QUICKEDIT spec 컨벤션 동일.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');

function colWidths(block: string): number[] {
  return [...block.matchAll(/w-\[(\d+)%\]/g)].map((m) => Number(m[1]));
}
function colgroupAfter(s: string, anchor: string): number[] {
  const start = s.indexOf(anchor);
  const cgStart = s.indexOf('<colgroup>', start);
  const cgEnd = s.indexOf('</colgroup>', cgStart);
  return colWidths(s.slice(cgStart, cgEnd));
}
// 기준 배포본(f8ad7a9) 폭 — 비율 검증 baseline.
const BASE_FEED = [5, 9, 11, 9, 8, 9, 6, 24, 14, 5];
const BASE_CMPL = [5, 10, 12, 9, 8, 9, 6, 25, 16];

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 현장 클릭: 호출(대기) 테이블 환자행 — 방·상태·이름·처방 비율 축소 적용
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 호출 테이블 — 4컬럼 비율 축소 + 합 100', () => {
  test('feed colgroup: 방4·상태7·이름6·처방12 (×0.75/0.75/0.5/0.5) · 합 100', () => {
    const w = colgroupAfter(DASH(), 'doctor-call-feed-table');
    // 순서: 방·상태·이름·생년·차트번호·오늘시술·차트·처방·임상경과·시간
    expect(w).toEqual([4, 7, 6, 9, 8, 9, 6, 12, 34, 5]);
    // 비율 검증 (반올림 1%p 허용).
    expect(Math.abs(w[0] - BASE_FEED[0] * 0.75)).toBeLessThanOrEqual(1); // 방
    expect(Math.abs(w[1] - BASE_FEED[1] * 0.75)).toBeLessThanOrEqual(1); // 상태
    expect(Math.abs(w[2] - BASE_FEED[2] * 0.5)).toBeLessThanOrEqual(1);  // 이름
    expect(Math.abs(w[7] - BASE_FEED[7] * 0.5)).toBeLessThanOrEqual(1);  // 처방
    // table-fixed 합 100% hard 제약.
    expect(w.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 현장 클릭: 진료 완료 테이블 환자행 — 동일 비율 축소 적용
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 완료 테이블 — 4컬럼 비율 축소 + 합 100', () => {
  test('completed colgroup: 방4·상태8·이름6·처방13 (×0.75/0.75/0.5/0.5) · 합 100', () => {
    const w = colgroupAfter(DASH(), 'doctor-completed-table');
    // 순서: 방·상태·이름·생년·차트번호·오늘시술·차트·처방·임상경과
    expect(w).toEqual([4, 8, 6, 9, 8, 9, 6, 13, 37]);
    expect(Math.abs(w[0] - BASE_CMPL[0] * 0.75)).toBeLessThanOrEqual(1); // 방
    expect(Math.abs(w[1] - BASE_CMPL[1] * 0.75)).toBeLessThanOrEqual(1); // 상태
    expect(Math.abs(w[2] - BASE_CMPL[2] * 0.5)).toBeLessThanOrEqual(1);  // 이름
    expect(Math.abs(w[7] - BASE_CMPL[7] * 0.5)).toBeLessThanOrEqual(1);  // 처방
    expect(w.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — 현장 클릭: 임상경과 셀 클릭(본문 우선) — 해방분 재분배가 임상경과로 갔는가
//             + AC-2 컬럼앵커 팝오버 / AC-3 빠른수정 회귀 0 (폭만 변경)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 임상경과 본문 우선 재분배 + AC-2/AC-3 회귀 0', () => {
  test('임상경과 컬럼이 최대 폭 — 해방분(축소 4컬럼 합 감소분) 전량 흡수', () => {
    const feed = colgroupAfter(DASH(), 'doctor-call-feed-table');
    const cmpl = colgroupAfter(DASH(), 'doctor-completed-table');
    // 임상경과(feed[8], cmpl[8])가 각 테이블 최대 폭 데이터 컬럼.
    expect(feed[8]).toBe(Math.max(...feed));
    expect(cmpl[8]).toBe(Math.max(...cmpl));
    // 임상경과는 기준 대비 확대(14→34, 16→37) — 본문 우선.
    expect(feed[8]).toBeGreaterThan(BASE_FEED[8]);
    expect(cmpl[8]).toBeGreaterThan(BASE_CMPL[8]);
    // 4컬럼 축소분 == 임상경과 증가분 (나머지 컬럼 불변 보장).
    const feedShrink = (BASE_FEED[0] - feed[0]) + (BASE_FEED[1] - feed[1]) + (BASE_FEED[2] - feed[2]) + (BASE_FEED[7] - feed[7]);
    expect(feed[8] - BASE_FEED[8]).toBe(feedShrink);
    const cmplShrink = (BASE_CMPL[0] - cmpl[0]) + (BASE_CMPL[1] - cmpl[1]) + (BASE_CMPL[2] - cmpl[2]) + (BASE_CMPL[7] - cmpl[7]);
    expect(cmpl[8] - BASE_CMPL[8]).toBe(cmplShrink);
    // 불변 컬럼(생년·차트번호·오늘시술·차트) feed/cmpl 동일하게 보존.
    expect([feed[3], feed[4], feed[5], feed[6]]).toEqual([9, 8, 9, 6]);
    expect([cmpl[3], cmpl[4], cmpl[5], cmpl[6]]).toEqual([9, 8, 9, 6]);
  });

  test('AC-2 컬럼앵커 팝오버(처방/임상경과 전문) 회귀 0 — 폭만 변경', () => {
    const s = DASH();
    // table-fixed 유지(폭 hard 제약 근거).
    expect(s).toContain('table-fixed');
    // 컬럼앵커 펼침 팝오버·앵커 ref 보존.
    expect(s).toContain('function ColumnExpandPopover');
    expect(s).toContain('anchorRef={rxCellRef}');
    expect(s).toContain('anchorRef={clinicalCellRef}');
    expect(s).toContain('doctor-call-rx-expand-pop');
    expect(s).toContain('doctor-completed-rx-expand-pop');
    expect(s).toContain('doctor-call-clinical-expand-pop');
    expect(s).toContain('doctor-completed-clinical-expand-pop');
    // 폐기된 행 전체폭 펼침행 testId 잔존 0.
    expect(s).not.toContain('doctor-call-rx-expand-row');
    expect(s).not.toContain('doctor-completed-rx-expand-row');
  });

  test('AC-3 빠른수정 어포던스 회귀 0 + DoctorCallListBar 미터치', () => {
    const s = DASH();
    // 빠른수정 토글/펼침 상태 보존.
    expect(s).toContain('setExpandRx');
    expect(s).toContain('onToggleExpand={() => setExpandRx');
    // 폭만 변경 — 신규 컴포넌트 생성 흔적(이번 티켓 ID 컴포넌트) 0, colgroup만 수정.
    // (RATIO-TUNE 코멘트는 두 colgroup 주석에만 존재)
    const tuneRefs = [...s.matchAll(/COLWIDTH-RATIO-TUNE/g)].length;
    expect(tuneRefs).toBe(2);
  });
});
