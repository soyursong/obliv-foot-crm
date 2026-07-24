/**
 * E2E spec — T-20260724-foot-ASSIGNHIST-CHARTNO-CHART2-LINK (P2/foot)
 *
 * 현장 요청(planner NEW-TASK MSG-20260724-144133-yc3n):
 *   「상담·치료사 배정 > 상담 > 금일 배분 이력」 고객 성함 셀에
 *   - AC-1: 차트번호 병기 (예 "홍길동 F-4790"). 미발번 고객은 성함 단독(잔여기호 금지).
 *   - AC-2: 성함 클릭 → 해당 고객 2번차트(/chart/:customerId)로 이동(별도 팝업창). 동명이인 오라우팅 금지(PK 식별).
 *   - AC-3: 정렬/페이징/타 컬럼 회귀 없음.
 *
 * 구현:
 *   - chart_number = customers 기존 컬럼(신규 컬럼/뷰 없음, db_change=false). monthCustomers map 조인.
 *   - 링크 = customers PK(customerId) 기준 window.open (Closing CLOSING-CHARTNUM-POPUP 패턴 재사용).
 *   - chartNoBadge 헬퍼로 병기(미발번이면 표시 억제 → 성함 단독).
 *
 * 정본 소스 정적 단언(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(차트번호 표기/클릭 팝업/동명이인 식별) 확인은 supervisor 맥스튜디오 실브라우저 단계 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 고객 성함 셀에 차트번호 병기 (미발번=성함 단독, 잔여기호 금지)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: chart_number 를 customers select 로 조인(신규 컬럼 없음)', () => {
  const src = read(PAGE);
  // 기존 customers select 두 경로(오늘분 custMap + 당월 monthCustMap) 모두 chart_number 포함
  const matches = src.match(/\.select\('id, visit_type, lead_source, visit_route, assigned_staff_id, chart_number'\)/g);
  expect(matches).not.toBeNull();
  expect(matches!.length).toBe(2);
  // CustomerLite 타입에 chart_number 필드
  expect(src).toMatch(/chart_number: string \| null;/);
});

test('AC-1: todayDistribution row 가 monthCustomers 에서 chart_number 파생 + 미발번 표시 억제', () => {
  const src = read(PAGE);
  // row 에 chartNumber 채움 (monthCustomers 조인)
  expect(src).toMatch(/const cust = ci\.customer_id \? monthCustomers\.get\(ci\.customer_id\) : null;/);
  expect(src).toMatch(/chartNumber: cust\?\.chart_number \?\? null,/);
  // useMemo deps 에 monthCustomers 포함(파생 정합)
  expect(src).toMatch(/\}, \[monthCheckIns, actions, activeTab, monthCustomers\]\)/);
  // 미발번(null)이면 배지 자체 미렌더 → 성함 단독(잔여기호 금지)
  expect(src).toMatch(/\{r\.chartNumber && \(/);
  expect(src).toMatch(/chartNoBadge\(r\.chartNumber\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 성함 클릭 → 2번차트(/chart/:customerId) 팝업 + 동명이인 오라우팅 금지(PK)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: 성함 클릭 → /chart/:customerId window.open (PK 기준 · 동명이인 식별)', () => {
  const src = read(PAGE);
  // 링크 버튼 + testid
  expect(src).toContain('data-testid={`dist-chart-link-${r.id}`}');
  // customers PK(customerId) 로 라우팅 — 이름 아닌 PK 식별
  expect(src).toMatch(/`\$\{window\.location\.origin\}\/chart\/\$\{r\.customerId\}`/);
  // 별도 팝업창(Closing 패턴)
  expect(src).toMatch(/width=1200,height=900,scrollbars=yes,resizable=yes/);
  // customerId = customers PK 파생
  expect(src).toMatch(/customerId: ci\.customer_id \?\? null,/);
});

test('AC-2: customer_id 없으면 링크 비활성(성함 텍스트만)', () => {
  const src = read(PAGE);
  expect(src).toMatch(/\{r\.customerId \? \(/);
  // else 분기에서 성함 단독 렌더
  expect(src).toMatch(/\) : \(\s*\n?\s*r\.customerName\s*\n?\s*\)\}/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 회귀 — 카드/정렬/타 컬럼 유지 + ROW-EDIT-DELETE 인라인 수정 select 병행 유지
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: 금일 배분 이력 카드/정렬/컬럼 헤더 유지', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid="assignments-today-distribution-card"');
  expect(src).toContain('금일 배분 이력');
  // 정렬(at desc) 유지
  expect(src).toMatch(/return rows\.sort\(\(a, b\) => b\.at\.localeCompare\(a\.at\)\)/);
  // 4컬럼(고객/담당/방식/시각) 유지
  expect(src).toMatch(/<th className="px-3 py-2 text-left font-medium">고객<\/th>/);
});

test('AC-3(병행): ROW-EDIT-DELETE 담당 인라인 수정 select 무회귀', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid={`dist-edit-select-${r.id}`}');
  expect(src).toMatch(/void doManual\(r\.checkIn, r\.role, e\.target\.value\)/);
});
