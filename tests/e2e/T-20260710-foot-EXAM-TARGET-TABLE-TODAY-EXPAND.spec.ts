/**
 * T-20260710-foot-EXAM-TARGET-TABLE-TODAY-EXPAND
 *   치료테이블 '균검사 & 피검사 대상자' — 진입 시 당일(오늘) 대상자만 기본 표시.
 *   (현장 7/2 최초요청 T-20260702-foot-TREATTABLE-TODAY-DEFAULT 미생성=8일 누락, 김주연 총괄 재확인)
 *
 *   ▶ 증상(responder 코드 직접확인, MSG-ri13): ExamTargetsSection.tsx 의 WINDOW_DAYS=14 →
 *     선택일 기준 직전 14일치가 일자별 그룹으로 한꺼번에 표시 = "당일 것만" 요구와 어긋남.
 *   ▶ 변경(비파괴): 윈도를 선택일 당일(1일)로 좁힘. 기본 date=오늘(TreatmentTable 부모)이라 진입 시 당일만.
 *     날짜 네비게이터(◀ ▶ / 오늘)로 date 변경 시 그 날짜 대상자 그대로 조회 가능 → 데이터 숨김 아님.
 *   ▶ 불변: exam 축 데이터 계약(EXAMONLY/SPLIT) 무변경, DB 변경 0, 표시(윈도+펼침) 레이어만.
 *
 * 검증 방식: 정적 소스 불변식(라이브 env 비의존) — 자매 exam-target spec 계열과 동일.
 *   AC(실제 브라우저 육안 확인)는 dev-foot 별도 렌더 확인으로 충족.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p: string) => resolve(__dirname, '../../', p);
const read = (p: string) => readFileSync(root(p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SEC = read('src/components/treatment/ExamTargetsSection.tsx');
const SEC_C = stripComments(SEC);
const PAGE = read('src/pages/TreatmentTable.tsx');
const PAGE_C = stripComments(PAGE);

// ── AC1 — 진입 시 당일(오늘) 대상자 기본 표시 (14일 윈도가 다 펼쳐지지 않음) ─────────────
test.describe('AC1 — 진입 시 당일 기본 표시(윈도 = 선택일 당일 1일)', () => {
  test('WINDOW_DAYS = 1 (14일 윈도 폐지)', () => {
    expect(SEC_C).toMatch(/const WINDOW_DAYS\s*=\s*1\s*;/);
    expect(SEC_C).not.toMatch(/const WINDOW_DAYS\s*=\s*14\s*;/);
  });

  test('부모 TreatmentTable 의 기본 date = 오늘(today) → 진입 시 당일 윈도', () => {
    expect(PAGE_C).toMatch(/const \[date, setDate\]\s*=\s*useState\(today\)/);
    expect(PAGE_C).toMatch(/<ExamTargetsSection date=\{date\}/);
  });

  test('windowBounds 가 WINDOW_DAYS 로 [start, end] 계산 유지(1일 → 당일만)', () => {
    expect(SEC_C).toMatch(/subDays\(new Date\(endDate \+ 'T12:00:00'\),\s*WINDOW_DAYS - 1\)/);
  });
});

// ── AC2 — '당일' 판정 기준 = 검사신청일(checked_in_at, KST), EXAMONLY exam 축과 정합 ─────
test.describe("AC2 — '당일' 기준축 = 검사신청일(checked_in_at, KST)", () => {
  test('윈도 필터가 check_ins.checked_in_at 기준(request date)', () => {
    expect(SEC_C).toMatch(/gte\('check_ins\.checked_in_at', startTs\)/);
    expect(SEC_C).toMatch(/lte\('check_ins\.checked_in_at', endTs\)/);
  });

  test('그룹 날짜 = seoulISODate(checked_in_at) — KST 일자축 일관', () => {
    expect(SEC_C).toMatch(/seoulISODate\(checkedAt as string\)/);
  });
});

// ── AC3 — 날짜 네비게이터 유지(다른 날짜 조회 가능), 기본 펼침은 오늘만 ───────────────────
test.describe('AC3 — 날짜 네비게이터 유지 + 오늘만 기본 펼침(데이터 숨김 금지)', () => {
  test('부모 날짜 네비게이터(prev/next/오늘) 보존 — date 변경 경로 유지', () => {
    expect(PAGE_C).toMatch(/const goPrev = \(\) => setDate\(/);
    expect(PAGE_C).toMatch(/setDate\(today\)/); // '오늘' 버튼
  });

  test('auto-expand 는 오늘 그룹만 — 비당일 그룹 기본 펼침 제외', () => {
    expect(SEC_C).toMatch(/groups\.some\(\(g\) => g\.date === today\)/);
    expect(SEC_C).toMatch(/setExpandedDates\(new Set\(\[today\]\)\)/);
    // 최초 1회만(ref 가드) — 사용자 토글 덮어쓰기 금지
    expect(SEC_C).toMatch(/didInitExpandRef/);
  });

  test('그룹 아코디언 토글 보존 — 다른 날짜 수동 펼침 가능', () => {
    expect(SEC_C).toMatch(/const toggleGroup = \(d: string\)/);
    expect(SEC_C).toMatch(/data-testid="exam-date-group-header"/);
  });
});

// ── AC4 — 당일 0명 엣지: 빈 상태 정상 렌더 ────────────────────────────────────────────
test.describe('AC4 — 당일 대상자 0명 시 빈 상태 정상 렌더', () => {
  test('groups.length === 0 → 빈 상태 메시지(에러/깨짐 없음)', () => {
    expect(SEC_C).toMatch(/groups\.length === 0/);
    expect(SEC_C).toMatch(/data-testid="exam-targets-empty"/);
    expect(SEC_C).toContain('균검사·피검사를 신청한 환자가 없습니다');
  });

  test('ADDITIVE 컬럼 미착지 prod(42703) → 빈 목록 폴백(무파손)', () => {
    expect(SEC_C).toMatch(/42703/);
    expect(SEC_C).toMatch(/koh_requested\|blood_test_requested/);
  });
});

// ── AC5 — exam 축 데이터 계약(EXAMONLY/SPLIT) 무변경, DB 변경 0(표시 레이어만) ────────────
test.describe('AC5 — 데이터 계약 불변 + DB 변경 0(표시 레이어만 수정)', () => {
  test('리스트업 원천 불변 — check_in_services + koh_requested/blood_test_requested 소비 read-only', () => {
    expect(SEC_C).toMatch(/from\('check_in_services'\)/);
    expect(SEC_C).toMatch(/or\('koh_requested\.eq\.true,blood_test_requested\.eq\.true'\)/);
  });

  test('신규 스키마 정의 없음 — create table / alter table 부재(표시 레이어)', () => {
    expect(SEC_C).not.toMatch(/create table/i);
    expect(SEC_C).not.toMatch(/alter table/i);
  });
});
