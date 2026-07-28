/**
 * E2E Spec — T-20260728-foot-DOCWRITE-DASH-UNISSUED-DATEFILTER-REOPEN (P1, FE-only, §11 gate CLEARED)
 *
 * 후속(REOPEN): 진료대시보드 '서류작성' 탭 '서류 완료' 목록에서, 어제 발행된 소견서/진단서가 자정을
 *   넘기면 사라지던 결함(track2 (b) 발행완료 day-scope). dev audit e93j/y9q3 = BRANCH A(조회 스코프),
 *   row 물리 소실 아님(form_submissions 전량 생존, read-only 조회 스코프만 확장).
 *
 * RC: usePublishedOpinionRequests(opinionRequest.ts) 는 resolved_at KST==today 로 '당일 발행'만 반환
 *   → 진료대시보드는 날짜선택기 없는 당일 surface이므로, 어제 발행분이 자정 교차 시 완료 목록에서 소실.
 *
 * FIX (FE-only, db_change=false — DDL/DML 0):
 *   · 발행완료 소스를 all-time(useAllPublishedOpinionRequests) 로 전환(치료테이블 07-26 선례 동형).
 *   · 진료대시보드는 날짜선택기 없는 당일 surface → 날짜 스코프를 '전체기간'으로 결정
 *     (selectDashboardCompletedRows, 소비 컴포넌트가 결정). = 화면 표시 범위만 확장(비파괴).
 *   · 매핑은 day-scoped·all-time 두 훅이 동일 mapPublishedRequestRow 공유(drift 0).
 *   · 미발행(draft) 큐 useOpinionRequestQueue 는 원래 날짜필터 부재 → 무접촉·무회귀.
 *
 * §11 게이트: 진료대시보드=의사공간 surface. 문지은 대표원장 confirm 완료(MSG-20260728-201914-azuv) →
 *   본 티켓이 바로 그 dashboard surface 확장을 목표로 함. 치료테이블(DiagDocSection) 재작업 없음.
 *
 * 시나리오(티켓 본문 3종, 진료대시보드=날짜선택기 부재 → '전체기간' 스코프로 해석):
 *   ① 과거일 발행분 노출 — 어제/과거 발행완료가 완료목록에 잔류(자정 교차 무손실).
 *   ② 오늘 회귀0 — 오늘 발행분도 그대로 노출(기존 동작 유지, 소실 아닌 superset).
 *   ③ 발행0 빈상태 — 발행완료 0건이면 완료목록 빈 상태(오노출/크래시 없음).
 *
 * 구성:
 *   A. 순수 로직 — 컴포넌트가 소비하는 동일 함수(selectDashboardCompletedRows) 직접 import.
 *   B. 정적 소스 가드 — dashboard all-time 전환 + day-scoped 훅 미삭제 + 단일 매핑 공유 + 미발행 큐 무접촉.
 *
 * 실행: npx playwright test T-20260728-foot-DOCWRITE-DASH-UNISSUED-DATEFILTER-REOPEN.spec.ts --project=unit
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectDashboardCompletedRows } from '../../src/components/doctor/DocRequestQueue';
import type { OpinionRequestRow } from '../../src/lib/opinionRequest';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCQUEUE_SRC = () =>
  readFileSync(join(HERE, '../../src/components/doctor/DocRequestQueue.tsx'), 'utf-8');
const HOOK_SRC = () =>
  readFileSync(join(HERE, '../../src/lib/opinionRequest.ts'), 'utf-8');

// 발행완료 OpinionRequestRow 팩토리 — useAllPublishedOpinionRequests 반환 형태(발행완료 전건).
//   resolvedKstDate 로 발행 시각(KST)을 지정. 진료대시보드는 '전체기간' 스코프 → 발행일 무관 전부 잔류.
function pub(
  id: string,
  resolvedKstDate: string,
  docType: 'opinion' | 'diagnosis' = 'opinion',
): OpinionRequestRow {
  const resolvedAt = `${resolvedKstDate}T11:00:00+09:00`;
  const requestedAt = `${resolvedKstDate}T10:30:00+09:00`;
  return {
    id,
    customerId: `cust-${id}`,
    checkInId: `ci-${id}`,
    docType,
    selectedKeys: [],
    staffMemo: '',
    oralMedReason: '',
    patientName: `환자-${id}`,
    chartNo: null,
    birthDate: null,
    requestedByName: '',
    requestedAt,
    createdAt: requestedAt,
    requestDate: resolvedKstDate,
    resolvedAt,
  };
}

const TODAY = '2026-07-28';
const YESTERDAY = '2026-07-27';
const OLDER = '2026-07-24';

// ── A. 순수 로직 — selectDashboardCompletedRows (전체기간 스코프) ─────────────────────────
test.describe('A. selectDashboardCompletedRows — 진료대시보드 발행완료 전체기간 스코프', () => {
  test('① 과거일(어제/그이전) 발행분이 완료목록에 잔류 — 자정 교차 무손실', () => {
    // all-time 훅이 반환하는 발행완료 전건(어제 2건 + 그이전 3건 + 오늘 2건).
    const allPublished: OpinionRequestRow[] = [
      pub('y1', YESTERDAY),
      pub('y2', YESTERDAY, 'diagnosis'),
      ...Array.from({ length: 3 }, (_, i) => pub(`o${i}`, OLDER, i % 2 === 0 ? 'opinion' : 'diagnosis')),
      pub('t1', TODAY),
      pub('t2', TODAY, 'diagnosis'),
    ];
    const rows = selectDashboardCompletedRows(allPublished);
    // 과거일(어제/그이전) 발행분이 day-scoped 였다면 자정 후 전량 소실 → 전체기간에선 잔류.
    const pastIds = rows.filter((r) => r.resolvedAt && r.resolvedAt < `${TODAY}T00:00:00+09:00`).map((r) => r.id);
    expect(pastIds).toEqual(expect.arrayContaining(['y1', 'y2', 'o0', 'o1', 'o2']));
    // 전체기간 = 입력 전건 보존(표시 범위 확장, 소실 0).
    expect(rows).toHaveLength(7);
    // 진단서/소견서 동일 스코프(둘 다 노출).
    expect(rows.some((r) => r.docType === 'diagnosis')).toBe(true);
    expect(rows.some((r) => r.docType === 'opinion')).toBe(true);
  });

  test('② 오늘 회귀0 — 오늘 발행분도 그대로 노출(소실 아닌 superset)', () => {
    const allPublished: OpinionRequestRow[] = [
      pub('y1', YESTERDAY),
      pub('t1', TODAY),
      pub('t2', TODAY, 'diagnosis'),
    ];
    const rows = selectDashboardCompletedRows(allPublished);
    const todayIds = rows
      .filter((r) => r.resolvedAt && r.resolvedAt >= `${TODAY}T00:00:00+09:00`)
      .map((r) => r.id);
    // 오늘 발행분(t1/t2) 온전 노출 = 기존 day-scoped 가 보여주던 것 회귀 없음.
    expect(todayIds).toEqual(expect.arrayContaining(['t1', 't2']));
    // 어제 발행분(y1)까지 추가 노출 = 확장(회귀 아님).
    expect(rows.map((r) => r.id)).toContain('y1');
    expect(rows).toHaveLength(3);
  });

  test('③ 발행0 빈상태 — 발행완료 0건이면 완료목록 빈 상태(오노출/크래시 없음)', () => {
    expect(selectDashboardCompletedRows([])).toHaveLength(0);
  });

  test('정렬 — 발행 시각(resolvedAt) 역순(최신 위)', () => {
    const rows = selectDashboardCompletedRows([
      pub('older', OLDER),
      pub('today', TODAY),
      pub('yest', YESTERDAY),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['today', 'yest', 'older']);
  });

  test('입력 불변(순수) — 원본 배열 미변형', () => {
    const input = [pub('a', OLDER), pub('b', TODAY)];
    const snapshot = input.map((r) => r.id);
    selectDashboardCompletedRows(input);
    expect(input.map((r) => r.id)).toEqual(snapshot);
  });
});

// ── B. 정적 소스 가드 ───────────────────────────────────────────────────────────
test.describe('B. 소스 가드 — dashboard all-time 전환 + 단일 매핑 공유 + 미발행 큐 무접촉', () => {
  test('DocRequestQueue 는 발행완료 소스를 all-time 훅(useAllPublishedOpinionRequests)으로 소비', () => {
    const src = DOCQUEUE_SRC();
    // 실제 훅 호출 = all-time.
    expect(src).toMatch(/const\s*\{[^}]*\}\s*=\s*useAllPublishedOpinionRequests\(clinicId\)/);
    // day-scoped 훅을 직접 호출(코드)하지 않음 — import/주석 언급은 허용하되 호출부는 없어야 함.
    expect(src).not.toMatch(/=\s*usePublishedOpinionRequests\(clinicId\)/);
    // 스코프 결정은 소비 컴포넌트의 순수 함수로 명시.
    expect(src).toMatch(/export function selectDashboardCompletedRows\(/);
    expect(src).toMatch(/selectDashboardCompletedRows\(allPublished\)/);
  });

  test('opinionRequest.ts — all-time 훅 존재 + day-scoped 훅 미삭제 + 단일 매핑 공유', () => {
    const src = HOOK_SRC();
    expect(src).toMatch(/export function useAllPublishedOpinionRequests\(/);
    // day-scoped 훅은 삭제하지 않고 유지(다른 surface·이력 재사용 여지, §11 의료로직 무변경).
    expect(src).toMatch(/export function usePublishedOpinionRequests\(/);
    // day-scoped 훅에만 존재하는 당일 필터(resolved_at KST==today) 는 all-time 훅으로 전이되지 않음:
    //   'today' 비교는 파일 전체에서 정확히 1회(usePublishedOpinionRequests 내부)만.
    const todayCmp = src.match(/seoulISODate\(ra\)\s*===\s*today/g) ?? [];
    expect(todayCmp).toHaveLength(1);
    // 단일 매핑 공유(drift 방지) — day-scoped·all-time 두 훅 공통.
    expect(src).toMatch(/export function mapPublishedRequestRow\(/);
    const mapUses = src.match(/mapPublishedRequestRow\(r,\s*fd\)/g) ?? [];
    expect(mapUses.length).toBeGreaterThanOrEqual(2);
  });

  test('all-time 훅은 read-only(SELECT only) — DDL/DML/write 0 (db_change=false)', () => {
    const src = HOOK_SRC();
    // useAllPublishedOpinionRequests 본문 슬라이스에 write/RPC 없음.
    const start = src.indexOf('export function useAllPublishedOpinionRequests(');
    const rest = src.slice(start);
    const end = rest.indexOf('\nexport function ', 1);
    const body = end > 0 ? rest.slice(0, end) : rest;
    expect(body).toMatch(/\.from\('form_submissions'\)/);
    expect(body).toMatch(/\.select\(/);
    expect(body).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(body).not.toMatch(/\.rpc\(/);
  });

  test('미발행(draft) 큐(useOpinionRequestQueue)는 무접촉 — 날짜필터 추가 없음(무회귀)', () => {
    const src = DOCQUEUE_SRC();
    // 미발행 큐는 여전히 useOpinionRequestQueue 로 소비(발행완료 확장이 미발행 경로를 안 건드림).
    expect(src).toMatch(/=\s*useOpinionRequestQueue\(clinicId\)/);
  });
});
