/**
 * E2E spec — T-20260615-foot-DOCDASH-STATNAME-WIDEN-CENTER  (문지은 대표원장)
 *
 * 요청: 진료대시보드(DoctorCallDashboard) 상태·이름 칼럼 폭 +20%(×1.2) 재확대 + 전체(헤더·데이터) 중앙정렬.
 *   6/14 COLWIDTH-RATIO-TUNE 과축소(상태 ×0.75·이름 ×0.50) 후속 보정.
 *
 * AC1(폭): (A)대기 상태7→8·이름6→7 / (B)완료 상태8→10·이름6→7.
 * AC2(합100%): 확대분을 임상경과 본문에서 차감. (A)34→32 / (B)37→34.
 * AC3(중앙정렬): 두 테이블 thead text-center + 데이터 셀 중앙(이름 버튼 text-center 포함). 긴 본문(처방·임상경과)은 left 허용.
 *
 * 정적 소스 검증 스타일(인접 DOCDASH spec 컨벤션 동일).
 *   ⚠ 실브라우저 폭·정렬 렌더는 supervisor field-soak / 갤탭 현장 confirm 게이트에서 최종 확인.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');

/** 첫 colgroup(대기 feed) 블록만 추출. */
const COLGROUP_A = () => {
  const s = DASH();
  const a = s.indexOf('data-testid="doctor-call-feed-table"');
  const start = s.indexOf('<colgroup>', a);
  return s.slice(start, s.indexOf('</colgroup>', start));
};
/** 두번째 colgroup(완료) 블록만 추출. */
const COLGROUP_B = () => {
  const s = DASH();
  const b = s.indexOf('data-testid="doctor-completed-table"');
  const start = s.indexOf('<colgroup>', b);
  return s.slice(start, s.indexOf('</colgroup>', start));
};

test.describe('AC1/AC2 — 상태·이름 폭 ×1.2 + 합 100%', () => {
  test('(A)대기: 상태 8% · 이름 7% · 임상경과 차감 32%', () => {
    const cg = COLGROUP_A();
    const cols = [...cg.matchAll(/w-\[(\d+)%\]/g)].map((m) => Number(m[1]));
    // 순서: 방 상태 이름 생년 차트번호 오늘시술 차트 처방 임상경과 시간
    expect(cols).toEqual([4, 8, 7, 9, 8, 9, 6, 12, 32, 5]);
    expect(cols.reduce((a, b) => a + b, 0)).toBe(100);
  });

  test('(B)완료: 이름 ×1.2(=7%) 적용 + 합 100% (상태폭은 WAITDONE-ALIGN-CNTNUM 이 대기폭으로 통일)', () => {
    // ⚠ COORDINATE: STATNAME 단계에서 B 는 상태 8→10·이름 6→7 로 독립 확대했으나,
    //   의존 후속 티켓 T-20260615-foot-DOCDASH-WAITDONE-ALIGN-CNTNUM 이 'B = A 픽셀 동일' 로 통일하며
    //   B 상태폭을 A 의 확정폭(8%)에 맞춰 supersede 한다(설계된 수렴, 원복 아님).
    //   따라서 최종 B 에서 STATNAME 이 남긴 불변식 = 이름 ×1.2(=7%) + 합 100%.
    const cg = COLGROUP_B();
    const cols = [...cg.matchAll(/w-\[(\d+)%\]/g)].map((m) => Number(m[1]));
    // index 2 = 이름
    expect(cols[2]).toBe(7); // 이름 6→7 (×1.2) 확대 반영
    expect(cols[1]).toBeGreaterThanOrEqual(8); // 상태 폭 확대(원본 8 이상 — WAITDONE 통일 후 A 와 동일 8)
    expect(cols.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

test.describe('AC3 — 헤더·데이터 중앙정렬', () => {
  test('두 테이블 thead 행 text-center (text-left 잔존 0)', () => {
    const s = DASH();
    const headerRows = [...s.matchAll(/bg-gray-50\/70 (text-\w+) text-\[13px\] font-semibold/g)].map(
      (m) => m[1],
    );
    expect(headerRows.length).toBe(2);
    expect(headerRows.every((t) => t === 'text-center')).toBe(true);
  });

  test('이름 버튼 중앙정렬(text-center) — 두 행 모두', () => {
    const s = DASH();
    const cnt = (s.match(/min-w-\[4rem\] break-keep text-center/g) || []).length;
    expect(cnt).toBe(2);
  });

  test('데이터 셀 td 중앙정렬 — px-1.5 py-1 text-left 잔존 0', () => {
    expect(DASH()).not.toContain('px-1.5 py-1 text-left');
  });

  test('이름 셀 flex 컨테이너 중앙정렬(justify-center)', () => {
    const cnt = (DASH().match(/flex items-center justify-center gap-1\.5/g) || []).length;
    expect(cnt).toBeGreaterThanOrEqual(2);
  });
});
