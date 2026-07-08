/**
 * T-20260708-foot-DASH-STAT-COUNT-MISMATCH — 대시보드 상단 통계(전체/신규/재진) 카운트 정합 E2E spec
 *
 * 증상(현장, 스샷 F0BFXRDQAMQ): 상단 '전체 1 / 신규 1 / 재진 0' ↔ 실제 완료 15건 + 수납대기 2건.
 *
 * 근본원인(FIXED):
 *   (1) 상단 카운트가 activeNonTerminal(= done·payment_waiting·done-ever 이력 제외) 기반이라
 *       '전체'라 표기하면서 실제로는 '진행중' 환자만 셌다 → 완료·수납대기 환자 통째로 누락.
 *   (2) 신규/재진 분류축이 라벨(new = visit_type !== 'returning')과 탭 필터
 *       (new = visit_type === 'new' / returning = visit_type !== 'new')에서 달라
 *       'experience'(체험) 방문이 라벨↔필터에서 반대로 분류(상단↔board 불일치).
 *
 * 정정: 카운트 소스를 board 와 동일한 rows(당일 fetch 전량, cancelled만 제외 = 탭 'all' 필터와 동일소스)로,
 *       분류축을 탭 필터와 동일한 (=== 'new' / !== 'new')로 통일. 전체 = 신규 + 재진 = board 건수(완료·수납대기 포함).
 *
 * 검증:
 *   A. 정적 소스 불변식 — 카운트 소스·축 정정 + 구 activeNonTerminal 제거.
 *   B. 분류 로직 재현(순수) — prod 당일 실데이터 스냅샷(2026-07-08 KST) 대조 3종 시나리오.
 *
 * prod 실데이터 스냅샷(2026-07-08 KST, Management API 조회):
 *   done/new 15, payment_waiting/new 1(접수테스트2), payment_waiting/returning 1(김민경) → 전체 17 / 신규 16 / 재진 1
 *
 * READ-ONLY — DB 변경 없음.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// A. 정적 소스 불변식 — 카운트 소스·축 정정 (무회귀 가드)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('A. 정적 소스 불변식 — 상단 카운트 정정 (T-20260708-DASH-STAT-COUNT-MISMATCH)', () => {
  const src = read('src/pages/Dashboard.tsx');

  test('AC-근본원인1: 카운트 소스 = boardCountRows(rows, cancelled만 제외) — activeNonTerminal 폐기', () => {
    expect(src).toMatch(/const\s+boardCountRows\s*=\s*rows\.filter\(\(r\)\s*=>\s*r\.status\s*!==\s*'cancelled'\)/);
    // 구 결함 소스 선언이 완전히 사라졌는지(재발 차단) — 주석 언급은 허용, 코드 선언은 금지
    expect(src).not.toMatch(/const\s+activeNonTerminal\s*=/);
    expect(src).not.toMatch(/const\s+doneCumulativeIds\s*=/);
  });

  test('AC-근본원인2: 신규/재진 분류축 = 탭 필터와 동일(=== new / !== new)', () => {
    expect(src).toMatch(/statusNewCount\s*=\s*boardCountRows\.filter\(\(r\)\s*=>\s*r\.visit_type\s*===\s*'new'\)\.length/);
    expect(src).toMatch(/statusReturningCount\s*=\s*boardCountRows\.filter\(\(r\)\s*=>\s*r\.visit_type\s*!==\s*'new'\)\.length/);
    // 구 분류축 카운트식(activeNonTerminal.filter(... !=='returning'))은 제거되어야 함(주석 언급은 허용)
    expect(src).not.toMatch(/\.filter\(\(r\)\s*=>\s*r\.visit_type\s*!==\s*'returning'\)/);
  });

  test('상단↔탭 동일소스: 탭 필터가 rows(비취소)를 visit_type 축으로 분할(불변)', () => {
    // filtered useMemo — 탭 'all'=비취소 전량, 'new'==='new', 'returning'!=='new'
    expect(src).toMatch(/tab\s*===\s*'all'\)\s*return\s*rows\.filter\(\(r\)\s*=>\s*r\.status\s*!==\s*'cancelled'\)/);
    expect(src).toMatch(/tab\s*===\s*'new'\)\s*return\s*rows\.filter\(\(r\)\s*=>\s*r\.visit_type\s*===\s*'new'/);
  });

  test('전체 라벨 = 신규 + 재진(= boardCountRows.length), 0건도 정상 표기(NaN 방지)', () => {
    expect(src).toMatch(/전체\s*\{statusNewCount\s*\+\s*statusReturningCount\}건/);
    expect(src).toMatch(/신규\s*\{statusNewCount\}건/);
    expect(src).toMatch(/재진\s*\{statusReturningCount\}건/);
  });

  test('rows 는 done 포함(취소만 제외) — 완료 환자도 카운트 소스에 잔존', () => {
    // T-20260629 DONE-PATIENT-VANISH: done 은 fetch 포함, 취소만 제외
    expect(src).toMatch(/'done'은 fetch에 포함\(취소만 제외\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. 분류 로직 재현(순수) — prod 당일 실데이터 스냅샷 대조
//    Dashboard 의 카운트/탭 필터 로직을 그대로 복제해 회귀 없이 산식 정합을 고정한다.
// ─────────────────────────────────────────────────────────────────────────────
type Row = { id: string; status: string; visit_type: 'new' | 'returning' | 'experience' };

// prod 2026-07-08 KST 실측 스냅샷 (Management API 조회 결과)
const PROD_SNAPSHOT: Row[] = [
  ...Array.from({ length: 15 }, (_, i) => ({ id: `done-${i}`, status: 'done', visit_type: 'new' as const })),
  { id: 'pw-new-접수테스트2', status: 'payment_waiting', visit_type: 'new' },
  { id: 'pw-ret-김민경', status: 'payment_waiting', visit_type: 'returning' },
];

// ── 정정된 카운트 로직 (Dashboard.tsx SSOT 복제) ──
function fixedCounts(rows: Row[]) {
  const boardCountRows = rows.filter((r) => r.status !== 'cancelled');
  const statusNewCount = boardCountRows.filter((r) => r.visit_type === 'new').length;
  const statusReturningCount = boardCountRows.filter((r) => r.visit_type !== 'new').length;
  return { total: statusNewCount + statusReturningCount, statusNewCount, statusReturningCount };
}

// ── 구(버그) 카운트 로직 — 회귀 witness 전용 ──
function buggyCounts(rows: Row[]) {
  const activeNonTerminal = rows.filter(
    (r) => r.status !== 'done' && r.status !== 'payment_waiting' && r.status !== 'cancelled',
  );
  const n = activeNonTerminal.filter((r) => r.visit_type !== 'returning').length;
  const ret = activeNonTerminal.filter((r) => r.visit_type === 'returning').length;
  return { total: n + ret, statusNewCount: n, statusReturningCount: ret };
}

test.describe('B. 분류 로직 재현 — prod 실데이터 대조 (T-20260708)', () => {
  test('시나리오1(전체=실 당일건수): 완료·수납대기 포함 → 전체 17', () => {
    const { total } = fixedCounts(PROD_SNAPSHOT);
    expect(total).toBe(17); // done 15 + payment_waiting 2
    // 구 로직은 완료·수납대기 제외 → 전체 0 (증상 재현)
    expect(buggyCounts(PROD_SNAPSHOT).total).toBe(0);
  });

  test('시나리오2(신규+재진 정합·재진>0): 신규 16 / 재진 1, 합=전체', () => {
    const c = fixedCounts(PROD_SNAPSHOT);
    expect(c.statusNewCount).toBe(16);
    expect(c.statusReturningCount).toBe(1);
    expect(c.statusReturningCount).toBeGreaterThan(0); // AC: 재진 > 0
    expect(c.statusNewCount + c.statusReturningCount).toBe(c.total); // 정합
    // 구 로직: 재진(payment_waiting) 제외 → 재진 0 (증상 재현)
    expect(buggyCounts(PROD_SNAPSHOT).statusReturningCount).toBe(0);
  });

  test('시나리오3(상단↔하단 동일소스): 완료 15 + 수납대기 2 가 전체에 그대로 반영', () => {
    const doneN = PROD_SNAPSHOT.filter((r) => r.status === 'done').length;            // 하단 완료 컬럼
    const pwN = PROD_SNAPSHOT.filter((r) => r.status === 'payment_waiting').length;   // 하단 수납대기 컬럼
    const { total } = fixedCounts(PROD_SNAPSHOT);
    expect(doneN).toBe(15);
    expect(pwN).toBe(2);
    expect(total).toBe(doneN + pwN); // 상단 전체 = 하단 컬럼 합 (동일소스)
  });

  test('무회귀: cancelled 는 상단·탭 모두에서 제외(동일소스 유지)', () => {
    const withCancelled: Row[] = [...PROD_SNAPSHOT, { id: 'cx', status: 'cancelled', visit_type: 'returning' }];
    expect(fixedCounts(withCancelled).total).toBe(17); // cancelled 미포함 유지
  });

  test('무회귀: experience(체험)는 재진 축(!== new)으로 분류 — 라벨↔탭필터 일치', () => {
    const withExp: Row[] = [...PROD_SNAPSHOT, { id: 'exp', status: 'consultation', visit_type: 'experience' }];
    const c = fixedCounts(withExp);
    expect(c.statusNewCount).toBe(16);       // experience 는 신규로 세지 않음
    expect(c.statusReturningCount).toBe(2);  // 재진(!== new) 축에 편입 → 탭 'returning' 필터와 동일
    expect(c.total).toBe(18);
  });
});
