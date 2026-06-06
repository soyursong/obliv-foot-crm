/**
 * Static drift scanner — T-20260606-foot-CHART-OPEN-ENTRYPOINT-UNIFY (AC-4)
 * 차트오픈 진입점 단일화 불변식(INVARIANT) 정적 락.
 *
 * 부모 RCA: T-20260606-foot-DASH-FIRSTVISIT-CHART-RECUR-RCA §개선안3.
 *   대시보드 초진 차트 안열림이 6번 재발한 근원 = 칸반/타임라인/명단 여러 뷰가 ctxOpenChart
 *   primitive 만 공유한 채 onClick→handler 코어를 "각자 따로" 배선 → 한 뷰만 죽어도 안 터짐.
 *
 *   ⇒ 단일 진입점 openChartFor() 로 통합해 "한 뷰만 배선" 결함 클래스 자체를 제거했다.
 *      이 spec 은 그 통합이 caller 드리프트(뷰 핸들러가 다시 ctxOpenChart 를 직접 호출)로
 *      풀리는 것을 정적으로 잠근다 — 행위 게이트(CHART-OPEN-GATE.spec)의 보강 안전망.
 *
 * db_change=false (소스 정적 스캔만 — DB/네트워크 미접근).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASH = path.resolve(__dirname, '../../src/pages/Dashboard.tsx');

function readDash(): string {
  return fs.readFileSync(DASH, 'utf-8');
}

/**
 * `const <name> = useCallback(` 부터 deps 배열 `[openChartFor]` 직전까지의 래퍼 본문 슬라이스.
 * 경계를 deps 마커로 잡아 다음 핸들러의 주석/코드가 섞이지 않게 한다(false-positive 방지).
 * 본 spec 의 3개 뷰 래퍼는 모두 openChartFor 단일 deps 를 갖는다(이것이 바로 검증 대상).
 */
function sliceHandlerBody(src: string, name: string): string {
  const startIdx = src.indexOf(`const ${name} = useCallback(`);
  expect(startIdx, `${name} 선언을 찾지 못함 — 핸들러 이름 변경/삭제 회귀`).toBeGreaterThanOrEqual(0);
  const depsIdx = src.indexOf('[openChartFor]', startIdx);
  expect(depsIdx, `${name} 가 openChartFor 를 deps 로 갖지 않음 — 위임 래퍼가 아님(분기 부활 회귀)`).toBeGreaterThan(startIdx);
  return src.slice(startIdx, depsIdx);
}

test.describe('CHART-OPEN-ENTRYPOINT-UNIFY · AC-1 단일 진입점 존재', () => {
  test('U1: openChartFor 단일 엔트리가 3종 입력 다형성으로 존재', () => {
    const src = readDash();
    expect(src, 'openChartFor 단일 진입점 선언 부재').toContain('const openChartFor = useCallback(async (target: ChartOpenTarget)');
    // 입력 다형성: 칸반 카드 / 타임라인 예약 / 명단 이름
    expect(src).toContain(`kind: 'checkin'`);
    expect(src).toContain(`kind: 'reservation'`);
    expect(src).toContain(`kind: 'name'`);
  });
});

test.describe('CHART-OPEN-ENTRYPOINT-UNIFY · AC-1/AC-4 뷰 핸들러는 단일 엔트리로만 위임', () => {
  for (const [name, delegation] of [
    ['handleCardClick', `openChartFor({ kind: 'checkin'`],
    ['handleReservationSelect', `openChartFor({ kind: 'reservation'`],
    ['handleNameChartOpen', `openChartFor({ kind: 'name'`],
  ] as const) {
    test(`U2: ${name} 는 openChartFor 로 위임`, () => {
      const body = sliceHandlerBody(readDash(), name);
      expect(body, `${name} 가 openChartFor 로 위임하지 않음 (진입점 분기 부활 회귀)`).toContain(delegation);
    });

    test(`U3: ${name} 는 직접 ctxOpenChart 를 호출하지 않음 (caller 드리프트 락)`, () => {
      const body = sliceHandlerBody(readDash(), name);
      expect(
        body.includes('ctxOpenChart('),
        `${name} 가 ctxOpenChart 를 직접 호출 — 6차 재발 근원(뷰별 배선) 드리프트. openChartFor 경유 필수.`,
      ).toBe(false);
    });
  }
});

test.describe('CHART-OPEN-ENTRYPOINT-UNIFY · AC-2 게이팅 일원화 (read-only 무관)', () => {
  test('U4: 타임라인 read-only 오픈 배선은 !isPast 게이트 없이 무조건 배선', () => {
    const src = readDash();
    // 차트오픈은 read-only → isPast 로 막지 않는다 (G6-1 과 동형의 회귀 라인 락)
    expect(src).toContain('onCardClick={handleCardClick}');
    expect(src).toContain('onReservationSelect={handleReservationSelect}');
    expect(src).toContain('onNameOpen={handleNameChartOpen}');
    expect(src).not.toContain('onCardClick={!isPast ? handleCardClick : undefined}');
    expect(src).not.toContain('onReservationSelect={!isPast ? handleReservationSelect : undefined}');
  });
});
