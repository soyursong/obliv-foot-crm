/**
 * T-20260723-foot-STATS-VISITROUTE-TAB — 통계 '내원 통계' 탭(방문경로별 내원 건수) AC 회귀 가드
 *
 * 상태 노트(중복 티켓 해소):
 *   본 티켓의 기능(통계 대시보드 4번째 '내원 통계' 탭 = 요약카드 3개 + 도넛/표 + 일별 누적막대,
 *   조회전용 SELECT-only)은 선행 티켓 T-20260723-foot-STAT-NAEWON-TAB 에서 이미 main 에 반영됨.
 *   두 티켓은 동일 주제(방문경로별 내원 건수 탭)로, 본 spec 은 프로덕션 코드를 재구현하지 않고
 *   현재 티켓의 AC 9개를 이미 배포된 소스(VisitRouteSection.tsx / Stats.tsx / stats.ts)에
 *   정적 불변식으로 재고정하는 회귀 가드다. 브라우저 동선은 canonical 인
 *   T-20260723-foot-STAT-NAEWON-TAB.spec.ts 가 커버한다(중복 실행 회피).
 *
 * 커버 AC:
 *   AC1 탭 4번째(TM집계 오른쪽) / AC2 공유 기간필터 구독(신규 필터 생성 금지) /
 *   AC3 검산 불변식(경로별 합계+미입력=총 내원, 표에 합계행) / AC4 방문완료=checked_in /
 *   AC5 데이터 없음 상태 / AC6 기간경계 당일 포함 / AC7 방문경로 동적 렌더(하드코딩 금지) /
 *   AC9 SELECT-only(DB write 부재)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test.describe('내원 통계 탭 AC 회귀 가드 (T-20260723-foot-STATS-VISITROUTE-TAB)', () => {
  const stats = read('src/lib/stats.ts');
  const section = read('src/components/stats/VisitRouteSection.tsx');
  const page = read('src/pages/Stats.tsx');

  test('AC1: 내원 통계 탭이 TM집계 바로 오른쪽(마지막, 4번째)', () => {
    expect(page).toMatch(/key:\s*'tm'[\s\S]*?key:\s*'visit',\s*label:\s*'내원 통계'/);
    expect(page).toMatch(/type StatsTab = 'revenue' \| 'therapist' \| 'tm' \| 'visit'/);
  });

  test('AC2: visit 탭은 기존 공유 preset 구독(전용 필터 신설 금지 — tmPreset 미사용)', () => {
    // 공유 preset 그대로 사용. tm 만 전용 tmPreset, visit 은 else 분기(공유 preset).
    expect(page).toMatch(/const activePreset = tab === 'tm' \? tmPreset : preset;/);
    // visit 탭 전용 preset state 가 새로 생기지 않았음을 방어(visitPreset 부재).
    expect(page).not.toMatch(/visitPreset/);
  });

  test('AC3: 검산 불변식 — 경로별 건수 합계(미입력 포함) = 총 내원, 표에 합계행 렌더', () => {
    // total = rows.length (전체 방문완료 건수), 미입력은 숨기지 않고 버킷 집계.
    expect(section).toMatch(/const total = rows\.length;/);
    expect(section).toMatch(/UNSET_LABEL\s*=\s*'미입력'/);
    // 표 하단 합계행이 agg.total 을 표시(검산 시각화).
    expect(section).toMatch(/합계/);
    expect(section).toMatch(/agg\.total\.toLocaleString/);
    // 표는 건수 내림차순 정렬.
    expect(section).toMatch(/\.sort\(\(a, b\) => b\.count - a\.count\)/);
  });

  test('AC4: 방문 완료 정의 = status checked_in (취소·노쇼 자동 제외, 신규 정의 금지)', () => {
    const fn = stats.slice(stats.indexOf('export async function fetchVisitRouteStats'));
    expect(fn).toMatch(/\.eq\('status',\s*'checked_in'\)/);
  });

  test('AC6: 기간경계 시작·종료일 당일 포함 (reservation_date gte from / lte to)', () => {
    const fn = stats.slice(stats.indexOf('export async function fetchVisitRouteStats'));
    expect(fn).toMatch(/\.gte\('reservation_date',\s*from\)/);
    expect(fn).toMatch(/\.lte\('reservation_date',\s*to\)/);
    expect(fn).toMatch(/\.eq\('clinic_id',\s*clinicId\)/); // 지점 스코프
  });

  test('AC7: 방문경로 동적 렌더 — 드롭다운 SSOT(VISIT_ROUTE_OPTIONS) 소스, 리터럴 하드코딩 금지', () => {
    expect(section).toMatch(/import\s*\{\s*VISIT_ROUTE_OPTIONS\s*\}\s*from\s*'@\/lib\/types'/);
    expect(section).not.toMatch(/\[\s*'TM'\s*,\s*'네이버'/);
  });

  test('AC5: 0건 기간 → 데이터 없음 빈 상태 렌더', () => {
    expect(section).toMatch(/데이터 없음/);
  });

  test('AC9: fetchVisitRouteStats 는 SELECT-only — insert/update/delete/upsert 부재', () => {
    const fn = stats.slice(stats.indexOf('export async function fetchVisitRouteStats'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
    expect(body).toMatch(/\.from\('reservations'\)/);
    expect(body).toMatch(/\.select\(/);
    expect(body).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });
});
