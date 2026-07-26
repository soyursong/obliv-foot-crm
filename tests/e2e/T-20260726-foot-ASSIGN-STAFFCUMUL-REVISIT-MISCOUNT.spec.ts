/**
 * E2E spec — T-20260726-foot-ASSIGN-STAFFCUMUL-REVISIT-MISCOUNT
 *
 * 현장(김주연 총괄, C0ATE5P6JTH):
 *   "당월 누적 - 배정(재진) 반영 된 수 전부 초진인 거 같은데 재진으로 잘 못 잡힌 듯"
 *   화면: 상담·치료사 배정 > 직원별 누적 > 당월 누적. 재진 배정건이 전부 초진 버킷으로 집계됨.
 *
 * 원인 확정(READ-ONLY prod 진단, scripts/…REVISIT-MISCOUNT_diag.mjs):
 *   - 데이터 정상(B 아님): 당월 상담배정 262건 중 stored customers.visit_type='returning' 238건 /
 *     recency(365) 재진 231건 — 재진이 DB 에 다수 존재.
 *   - 표시/집계 버그(A 확정): monthAxisOf 가 recency-override 된 visit_type 을 참조 →
 *     recency 가 'new' 로 떨어진 stored-'returning' 고객이 초진 버킷으로 흡수(check_ins.visit_type='new'
 *     가 255/262 라 fallback 시 전부 초진). "재진이 조인/필터에서 누락돼 초진에 흡수"(티켓 A 문구).
 *   - db_change=false (조회/표시만, 무-DDL).
 *
 * 수정(외과적, 소스 분리):
 *   - 직원별 누적 [배정(초진)/(재진)] 집계 = 내구 초진/재진(customers.visit_type, stored_visit_type 보존)
 *     을 정본으로 사용(monthTallyAxisOf) → 현장 기대치 "DB 당월 returning 건수" 와 정합(AC).
 *   - 오늘 배정목록 배지(monthAxisOf, recency) 는 불변 — 접수분류/엔진과 통일된 예측 유지(회귀0).
 *
 * 본 spec 은 정본 소스 정적 단언으로 불변식 인코딩(형제 foot spec 동형).
 * 실렌더/실카운트 대조는 supervisor 맥스튜디오 실브라우저(갤탭) 단계에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: stored_visit_type 원본 보존 (recency-override 와 소스 분리)
// ─────────────────────────────────────────────────────────────────────────────
test('CustomerLite 에 stored_visit_type(내구 초진/재진 원본) 필드 존재', () => {
  const src = read(PAGE);
  expect(src).toMatch(/interface CustomerLite \{[\s\S]*?stored_visit_type: string \| null;[\s\S]*?\}/);
});

test('monthCustMap 빌드 시 stored_visit_type = 원본 visit_type 로 보존', () => {
  const src = read(PAGE);
  // 월간 map 빌드에서 stored 보존
  expect(src).toMatch(/monthCustMap\.set\(c\.id, \{ \.\.\.c, stored_visit_type: c\.visit_type \}\)/);
  // recency override 는 visit_type 만 덮고 stored_visit_type 은 spread 로 보존(clobber 금지)
  expect(src).toMatch(/monthCustMap\.set\(id, \{ \.\.\.cu, visit_type: vt \}\)/);
  expect(src).not.toMatch(/stored_visit_type: vt/); // stored 를 recency 로 덮지 않음
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 누적 tally = 내구(stored) 축 / 오늘 배지 = recency 축 (소스 분리)
// ─────────────────────────────────────────────────────────────────────────────
test('monthTallyAxisOf 는 stored_visit_type 을 참조(누적 집계 정본)', () => {
  const src = read(PAGE);
  expect(src).toMatch(
    /const monthTallyAxisOf = useCallback\([\s\S]*?visit_type: cu\?\.stored_visit_type \?\? ci\.visit_type[\s\S]*?deriveTherapyAxis\(ci\)/,
  );
});

test('monthAxisOf(오늘 배지) 는 recency-override 된 visit_type 유지 — 회귀0', () => {
  const src = read(PAGE);
  expect(src).toMatch(
    /const monthAxisOf = useCallback\([\s\S]*?visit_type: cu\?\.visit_type \?\? ci\.visit_type/,
  );
});

test('직원별 누적 집계(staffStats bumpAssign)는 monthTallyAxisOf 사용 — 재진 흡수 차단', () => {
  const src = read(PAGE);
  // consult/therapy 두 축 모두 tally 축 사용
  expect(src).toContain("monthTallyAxisOf(ci, 'consult') === 'returning'");
  expect(src).toContain("monthTallyAxisOf(ci, 'therapy') === 'returning'");
  // staffStats 집계에서 monthAxisOf(recency) 를 재진 판정에 쓰지 않음
  expect(src).not.toContain("monthAxisOf(ci, 'consult') === 'returning'");
});

test('오늘 배정목록(assignmentListRows) 은 monthAxisOf(recency) 유지 — 배지 소스 불변', () => {
  const src = read(PAGE);
  // 배정목록 row.axis 는 monthAxisOf 로 파생(recency 배지)
  expect(src).toMatch(/axis: monthAxisOf\(ci, listCategory\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: db_change=false — 마이그레이션 신설 금지(no-DDL 불변식)
// ─────────────────────────────────────────────────────────────────────────────
test('db_change=false — REVISIT-MISCOUNT 전용 마이그레이션 파일 신설 없음', () => {
  const migDir = join(ROOT, 'supabase/migrations');
  if (!existsSync(migDir)) return;
  const hit = readdirSync(migDir).filter((f) => /REVISIT-MISCOUNT/i.test(f));
  expect(hit).toEqual([]);
});
