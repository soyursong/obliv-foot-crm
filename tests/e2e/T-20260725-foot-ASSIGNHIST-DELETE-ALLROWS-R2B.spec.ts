/**
 * E2E spec — T-20260725-foot-ASSIGNHIST-DELETE-ALLROWS-R2B (요청2 삭제, 전 행 노출)
 *
 * 현장(김주연 총괄, C0ATE5P6JTH, thread 1784867114.685259):
 *   08:41 "금일 배분 이력 줄 삭제" 확정 → 08:46 재정의 "수정/삭제 버튼 전부 노출해줘 —
 *   누가 테스트인지 니 구분 못하잖아". = R2(test-only 게이트) 폐지, 전 행 노출.
 *
 * scope:
 *   - 삭제 버튼 = 금일 배분 이력 전 행(모든 환자). test-flag 조건 없음.
 *   - 삭제 = soft-hide ONLY (check_ins.deleted_at/deleted_by). hard-DELETE BANNED.
 *   - 권한 = admin/manager/원장(director) 한정(canEditDistribution 재사용) + 확인 다이얼로그.
 *   - downstream completeness: 배정 누적/내원 KPI/foot_stats_consultant 등 count 소비처 deleted_at IS NULL 제외.
 *
 * ★RED LINE 인코딩:
 *   (a) hard-DELETE BANNED — check_ins 물리 DELETE 부재, deleted_at UPDATE 만.
 *   (c) 정산행 보호 — 삭제 surface(todayDistribution)는 오늘분(checked_in_at >= todayStart) 한정 = 정산기간 도달 불가.
 *   (d) downstream completeness — 집계/KPI 소비처 .is('deleted_at', null).
 *   (e) rows-affected 검증 — softHideCheckIn .select('id') + 0-row 성공 오인 차단.
 *   (f) 권한 게이트. (g) 확인 다이얼로그.
 *
 * 정본 소스 정적 단언(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(삭제→숨김 영속/권한 비노출/확인창) 확인은 supervisor 맥스튜디오 실브라우저 단계 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const ENGINE = 'src/lib/autoAssign.ts';
const TYPES = 'src/lib/types.ts';
const MIG = 'supabase/migrations/20260725160000_foot_check_ins_soft_hide.sql';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 삭제 버튼 전 행 노출 (test 조건 없음) + 확인 다이얼로그
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: 배분 이력 각 row 삭제 버튼 렌더 (전 행, test-flag 분기 없음)', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid={`dist-delete-btn-${r.id}`}');
  // 삭제 버튼은 canEditDistribution(권한) 게이트만 — test flag 조건 없음
  expect(src).not.toMatch(/is_test|isTest|test_flag|testFlag/);
  // 클릭 → 확인 다이얼로그 타깃 세팅(즉시 삭제 아님)
  expect(src).toMatch(/onClick=\{[\s\S]*?setDistDeleteTarget\(\{/);
});

test('AC-1: 삭제 열/버튼은 권한(canEditDistribution) 게이트 하에서만 노출', () => {
  const src = read(PAGE);
  // 헤더 삭제 열 + 빈 상태 colSpan 분기 (권한 시 삭제열 추가)
  // T-20260726-foot-ASSIGN-SENDCONFIRM-WEEKLYTARGET 변경2 stale 정정: '발송'(확정) 열 추가로 base 4→5, +삭제열 → 6/5.
  expect(src).toMatch(/canEditDistribution && \(\s*\n?\s*<th[^>]*>삭제<\/th>/);
  expect(src).toMatch(/colSpan=\{canEditDistribution \? 6 : 5\}/);
  // row 액션 셀도 권한 게이트
  expect(src).toMatch(/canEditDistribution && \(\s*\n?\s*<td[^>]*>\s*\n?\s*<Button/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1(계속): 확인 다이얼로그 — '삭제/취소'
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: 확인 다이얼로그(distDeleteTarget) — 취소/삭제 버튼 + 되살림 안내', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid="dist-delete-confirm-btn"');
  expect(src).toContain('data-testid="dist-delete-cancel-btn"');
  expect(src).toContain('배분 이력 삭제');
  // soft-hide(되살릴 수 있음) 안내 문구
  expect(src).toMatch(/화면에서만 숨겨지며 되살릴 수 있습니다/);
  // 확인 → doSoftHideDist
  expect(src).toMatch(/onClick=\{\(\) => void doSoftHideDist\(\)\}/);
});

// ─────────────────────────────────────────────────────────────────────────────
// RED LINE (a): hard-DELETE BANNED — soft-hide(deleted_at UPDATE) 만
// ─────────────────────────────────────────────────────────────────────────────
test('RED LINE (a): softHideCheckIn 은 물리 DELETE 없이 deleted_at UPDATE 만', () => {
  const eng = read(ENGINE);
  const start = eng.indexOf('export async function softHideCheckIn');
  expect(start).toBeGreaterThan(-1);
  const body = eng.slice(start, eng.indexOf('export async function', start + 1));
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // check_ins 물리 DELETE 부재
  expect(code).not.toMatch(/\.delete\(\)/);
  // deleted_at + deleted_by UPDATE
  expect(code).toMatch(/\.update\(\{[\s\S]*?deleted_at:[\s\S]*?deleted_by:[\s\S]*?\}\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// RED LINE (e): rows-affected 검증 — .select('id') + 0-row 성공 오인 차단
// ─────────────────────────────────────────────────────────────────────────────
test('RED LINE (e): softHideCheckIn .select(id) 회수 + 0-row → ok:false', () => {
  const eng = read(ENGINE);
  const start = eng.indexOf('export async function softHideCheckIn');
  const body = eng.slice(start, eng.indexOf('export async function', start + 1));
  expect(body).toMatch(/\.eq\('id', opts\.checkInId\)/);
  expect(body).toMatch(/\.is\('deleted_at', null\)/); // 멱등 가드
  expect(body).toMatch(/\.select\('id'\)/);
  expect(body).toMatch(/if \(!data \|\| data\.length === 0\)\s*\n?\s*return \{[\s\S]*?ok: false/);
});

// ─────────────────────────────────────────────────────────────────────────────
// RED LINE (f): 권한 게이트 — admin/manager/director. doSoftHideDist deleted_by=profile.id
// ─────────────────────────────────────────────────────────────────────────────
test('RED LINE (f): 삭제 실행자 = profile.id(deleted_by 감사) + 권한 게이트 재사용', () => {
  const src = read(PAGE);
  expect(src).toMatch(/const doSoftHideDist = async \(\)/);
  expect(src).toMatch(/softHideCheckIn\(\{\s*\n?\s*checkInId: distDeleteTarget\.checkIn\.id,\s*\n?\s*deletedBy: profile\?\.id \?\? null,/);
});

// ─────────────────────────────────────────────────────────────────────────────
// RED LINE (c): 삭제 surface 는 오늘분 한정 (정산기간 도달 불가 → period-freeze 불요)
// ─────────────────────────────────────────────────────────────────────────────
test('RED LINE (c): todayDistribution 은 오늘분(checked_in_at >= todayStart) 한정', () => {
  const src = read(PAGE);
  // todayDistribution useMemo 가 오늘 시작 이전 행 제외
  expect(src).toMatch(/if \(!ci\.checked_in_at \|\| new Date\(ci\.checked_in_at\)\.getTime\(\) < todayStartMs\) continue/);
});

// ─────────────────────────────────────────────────────────────────────────────
// RED LINE (d): downstream completeness — 집계/KPI 소비처 deleted_at IS NULL 제외
// ─────────────────────────────────────────────────────────────────────────────
test('RED LINE (d)-FE: 배정 누적/내원 count 소비처 .is(deleted_at, null)', () => {
  const assign = read(PAGE);
  // 금일 배분 이력 + 배정 누적 정본(today ci / monthCheckIns)
  const isNull = (assign.match(/\.is\('deleted_at', null\)/g) ?? []).length;
  expect(isNull).toBeGreaterThanOrEqual(2);

  expect(read('src/lib/autoAssign.ts')).toMatch(/\.is\('deleted_at', null\)/);
  expect(read('src/pages/Dashboard.tsx')).toMatch(/\.is\('deleted_at', null\)/);
  expect(read('src/components/DashboardDateDetail.tsx')).toMatch(/\.is\('deleted_at', null\)/);
  expect(read('src/lib/stats.ts')).toMatch(/\.is\('deleted_at', null\)/);
  expect(read('src/lib/visitRecency.ts')).toMatch(/\.is\('deleted_at', null\)/);
});

test('RED LINE (d)-DB: foot_stats_consultant + noshow_returning 에 축별 deleted_at 반영', () => {
  const mig = read(MIG);
  // ADDITIVE 컬럼 신설
  expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS deleted_at timestamptz/);
  expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS deleted_by uuid/);
  // 두 집계 함수 CREATE OR REPLACE
  expect(mig).toMatch(/FUNCTION public\.foot_stats_consultant/);
  expect(mig).toMatch(/FUNCTION public\.foot_stats_noshow_returning/);
  // count/ops 축(tk_count·consulted_cust) + noshow ck + 부분인덱스 = 최소 4개 exclude-deleted 지점.
  const deletedGuards = (mig.match(/deleted_at IS NULL/g) ?? []).length;
  expect(deletedGuards).toBeGreaterThanOrEqual(3);
  // hard-DELETE 금지 — 마이그에 check_ins DELETE 부재
  expect(mig).not.toMatch(/DELETE FROM (public\.)?check_ins/);
});

// ─────────────────────────────────────────────────────────────────────────────
// ★B1 (DA-...-MONEYSAFE): 매출귀속 앵커(ticketed_all)는 deleted_at 미적용 = 원귀속 pin.
//   삭제행이 join 에서 빠지면 매출이 次근접 상담사로 재귀속 = money-bug. carve-out 주석 강제.
// ─────────────────────────────────────────────────────────────────────────────
test('★B1: ticketed_all(매출 앵커)에 deleted_at 필터 부재 + money-safe carve-out 주석', () => {
  const mig = read(MIG);
  // carve-out 주석(원귀속 pin 근거) 존재
  expect(mig).toMatch(/money-safe carve-out: revenue anchor ignores deleted_at/);
  // ticketed_all CTE 본문에 deleted_at IS NULL 필터가 없어야 함(원귀속 고정).
  const taStart = mig.indexOf('ticketed_all AS (');
  expect(taStart).toBeGreaterThan(-1);
  const taBody = mig.slice(taStart, mig.indexOf('pkg_attr AS (', taStart));
  expect(taBody).not.toMatch(/deleted_at IS NULL/);
});

// ─────────────────────────────────────────────────────────────────────────────
// ★B2 (비율-정합 불변식): avg_amount = 매출/객수 rate. 분자=include-deleted(pin) → 분모 leg 도 include-deleted.
//   출력 consulted_customer_count(ops KPI)는 exclude-deleted 유지 → 별도 leg(consulted_cust_rev).
// ─────────────────────────────────────────────────────────────────────────────
test('★B2: avg_amount 분모 = include-deleted leg(consulted_cust_rev), 출력 count 는 exclude-deleted', () => {
  const mig = read(MIG);
  // include-deleted 분모 CTE 존재(deleted_at 미필터)
  expect(mig).toMatch(/consulted_cust_rev AS \(/);
  // avg_amount 계산식이 consulted_customer_count_rev(include-deleted) 를 분모로 사용
  expect(mig).toMatch(/NULLIF\(COALESCE\(ccr\.consulted_customer_count_rev, 0\), 0\)/);
  // 출력 컬럼 consulted_customer_count 는 여전히 exclude-deleted(consulted_cust=cc)
  expect(mig).toMatch(/COALESCE\(cc\.consulted_customer_count, 0\)\s*\n?\s*AS consulted_customer_count/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 타입: CheckIn.deleted_at/deleted_by (ADDITIVE)
// ─────────────────────────────────────────────────────────────────────────────
test('타입: CheckIn 에 deleted_at/deleted_by optional 필드', () => {
  const t = read(TYPES);
  expect(t).toMatch(/deleted_at\?: string \| null/);
  expect(t).toMatch(/deleted_by\?: string \| null/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 회귀: 금일 배분 이력 카드/수정(R1) 공존
// ─────────────────────────────────────────────────────────────────────────────
test('회귀: 배분 이력 카드 + R1 담당 수정 select 공존', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid="assignments-today-distribution-card"');
  expect(src).toContain('data-testid={`dist-edit-select-${r.id}`}'); // R1 수정 유지
  expect(src).toContain('data-testid={`dist-delete-btn-${r.id}`}'); // R2B 삭제 신설
});
