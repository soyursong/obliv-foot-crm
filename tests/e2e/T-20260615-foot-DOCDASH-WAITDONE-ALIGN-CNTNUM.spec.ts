/**
 * E2E spec — T-20260615-foot-DOCDASH-WAITDONE-ALIGN-CNTNUM  (문지은 대표원장, P1)
 *
 * 요청: ① 진료대기↔진료완료 두 테이블이 안 맞고 삐뚤 → 같은 테이블처럼 칼럼 세로경계 일치.
 *       ② '진료필요 N' 배지에서 '진료필요' 라벨 제거 → 숫자만 크게·볼드.
 *
 * AC1(폭 일치): 완료 테이블 colgroup = 대기 테이블 colgroup 과 글자 그대로 동일(10칼럼, 시간=빈칸 placeholder).
 *               STATNAME-WIDEN-CENTER 확정폭 = 4·8·7·9·8·9·6·12·32·5.
 * AC2(시간 처리): 완료는 경과시간 값 미표시(빈 th/td) — WAITFILTER-UX7 유지하되 폭 정렬은 깨지 않음.
 * AC3(배지 숫자화): '진료필요' 라벨 제거, 숫자만 text-lg 이상 + font-bold.
 *
 * depends_on: T-20260615-foot-DOCDASH-STATNAME-WIDEN-CENTER (이 spec 의 대기 폭 기준선).
 * 정적 소스 검증 스타일.
 *   ⚠ 실브라우저 두 테이블 나란히 세로경계 정렬은 supervisor field-soak / 갤탭 현장 confirm 게이트에서 최종 확인.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');

const colsOf = (tableTestId: string) => {
  const s = DASH();
  const t = s.indexOf(`data-testid="${tableTestId}"`);
  const start = s.indexOf('<colgroup>', t);
  const block = s.slice(start, s.indexOf('</colgroup>', start));
  return [...block.matchAll(/w-\[(\d+)%\]/g)].map((m) => Number(m[1]));
};

test.describe('AC1/AC2 — 두 테이블 칼럼 폭 픽셀 일치', () => {
  test('대기·완료 colgroup 이 글자 그대로 동일(10칼럼)', () => {
    const a = colsOf('doctor-call-feed-table');
    const b = colsOf('doctor-completed-table');
    expect(a).toEqual([4, 8, 7, 9, 8, 9, 6, 12, 32, 5]);
    expect(b).toEqual(a); // 공유 9칼럼 + 시간 placeholder 까지 1:1 동일
  });

  test('두 colgroup 합 100% (table-fixed 무결)', () => {
    expect(colsOf('doctor-call-feed-table').reduce((x, y) => x + y, 0)).toBe(100);
    expect(colsOf('doctor-completed-table').reduce((x, y) => x + y, 0)).toBe(100);
  });

  test('완료 테이블 colspan = 10 (대기와 동일)', () => {
    expect(DASH()).toContain('const DOCDASH_COMPLETED_COLSPAN = 10');
  });

  test('완료 행 끝 시간 빈 셀 placeholder 존재(경과시간 값 미표시)', () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-completed-elapsed-empty"');
    // 완료 테이블에 경과시간 데이터 testid(doctor-completed-elapsed = 값표시)는 없어야 함(빈칸만)
    expect(s).not.toContain('data-testid="doctor-completed-elapsed"'); // -empty 와 구분(접미사)
  });
});

test.describe('AC3 — 진료필요 카운트 배지 숫자화', () => {
  test("'진료필요 {N}' 라벨 텍스트 제거", () => {
    expect(DASH()).not.toContain('진료필요 {activeCalls.length}');
  });

  test('숫자만 크게·볼드(text-2xl/text-xl/text-lg + font-bold)', () => {
    const s = DASH();
    const idx = s.indexOf('data-testid="doctor-call-active-count"');
    expect(idx).toBeGreaterThan(0);
    // 배지 span class 추출
    const spanStart = s.lastIndexOf('<span', idx);
    const cls = s.slice(spanStart, idx);
    expect(/text-(lg|xl|2xl)/.test(cls)).toBe(true);
    expect(cls).toContain('font-bold');
    expect(cls).toContain('text-red-600'); // 기존 red 계열 유지
  });

  test('섹션 제목 「진료 대기중」 + 행 상태 라벨 「진료필요」/「진료완료」 보존(회귀 0)', () => {
    const s = DASH();
    expect(s).toContain('진료 대기중');
    expect(s).toContain("{inactive ? '진료완료' : '진료필요'}"); // 행 상태 셀 라벨 불변
  });
});
