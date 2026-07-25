/**
 * E2E spec — T-20260725-foot-VISITCALL-RECEIVER-404-POPUP-MISS
 * RC-1a: receiver 404-despite-write 정직 응답 / RC-1b: 예방콜 결과 status필터 미표시 해소.
 *
 * 진단 결론(부모 RECHECK T-20260722 §10 + 본 티켓 DB 실측 — jongno-foot 31건 visit_call_result 기록,
 *   접수전 status 0건):
 *   - RC-1a: receiver 의 found-path 만 UPDATE→2xx. write 성공하며 404 반환하는 코드경로 부재.
 *     '404-despite-write' 는 cross-request 아티팩트(타 도메인 오라우팅/선행 forward-ingest 이전 도착분).
 *     → cross-CRM Write Rows-Affected 표준(.select() rows-affected 검증)으로 2xx==실영속 확정.
 *   - RC-1b: 예방콜 결과 배지가 접수전(latestCheckIn===null && confirmed) 블록에 갇혀,
 *     동기 레코드가 전부 접수 이후 status 라 미표시. → status 무관 read-only 배지로 분리.
 *
 * 정적 소스 검증 스타일(sibling T-20260714 spec 계승).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const EF = 'supabase/functions/dopamine-visitcall-receiver/index.ts';
const BADGE = 'src/components/VisitCallResultBadge.tsx';
const DASH = 'src/pages/Dashboard.tsx';
const CHART = 'src/pages/CustomerChartPage.tsx';
const TYPES = 'src/lib/types.ts';

const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf-8');
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');

test.describe('아티팩트 존재', () => {
  test('receiver EF + 배지 컴포넌트 존재', () => {
    expect(fs.existsSync(path.resolve(EF))).toBe(true);
    expect(fs.existsSync(path.resolve(BADGE))).toBe(true);
  });
});

test.describe('RC-1a — receiver 응답이 write 실재를 정직 반영 (cross-CRM Write Rows-Affected)', () => {
  const ef = () => read(EF);

  test('UPDATE 에 .select() rows-affected 검증 부착', () => {
    const code = stripComments(ef());
    // update(...).eq('id', resv.id).select('id') 체인
    expect(code).toMatch(/\.update\(\{[\s\S]*?\}\)\s*\.eq\('id',\s*resv\.id\)\s*\.select\('id'\)/);
  });

  test('0-row UPDATE 는 2xx 위장 금지 → 5xx(WRITE_NO_ROWS) 반환', () => {
    const code = stripComments(ef());
    expect(code).toMatch(/updRows.*length\s*===\s*0/);
    expect(code).toMatch(/WRITE_NO_ROWS/);
    // WRITE_NO_ROWS 는 500(재시도 가능) — 404 아님
    expect(ef()).toMatch(/error:\s*'WRITE_NO_ROWS'[\s\S]*?\},\s*500\)/);
  });

  test('404 는 write 이전 예약 미존재 early-return 에서만 (write 후 404 경로 부재)', () => {
    const code = stripComments(ef());
    // RESERVATION_NOT_FOUND 는 !resv (조회 실패) 블록 안에서만 등장
    const notFoundIdx = code.indexOf('RESERVATION_NOT_FOUND');
    const updateIdx = code.indexOf('.update({');
    expect(notFoundIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    // 404 반환이 UPDATE 문보다 앞에 위치(=write 이전) → write-then-404 불가
    expect(notFoundIdx).toBeLessThan(updateIdx);
  });

  test('멱등(event_id) 재수신은 200 duplicate (재전송 시 404 아님)', () => {
    const code = stripComments(ef());
    expect(code).toMatch(/reason:\s*'duplicate'[\s\S]*?\},\s*200\)/);
  });
});

test.describe('RC-1b — 예방콜 결과 read-only 배지 (status 무관)', () => {
  test('배지 컴포넌트: canonical→라벨 SSOT 재사용 + 값 없으면 미렌더', () => {
    const b = read(BADGE);
    expect(b).toMatch(/VISIT_CALL_RESULT_LABEL/);
    expect(b).toMatch(/if\s*\(!result\)\s*return null/);
    expect(b).toMatch(/data-testid="visit-call-result-badge"/);
    // reachable/absent 색 분기
    expect(b).toMatch(/emerald/);
    expect(b).toMatch(/rose/);
  });

  test('배지는 write 무접점(도파민 write, 풋 read-only) — 값 입력 prop 만', () => {
    const b = stripComments(read(BADGE));
    expect(b).not.toMatch(/\.update\(|\.insert\(|\.upsert\(|supabase/);
  });

  test('Dashboard 통합시간표: 초진(Box1)·재진(Box2) 미내원 카드에 배지 부착', () => {
    const d = read(DASH);
    expect(d).toMatch(/import\s*\{\s*VisitCallResultBadge\s*\}/);
    // 두 카드 모두에 reservation.visit_call_result 를 넘김 (2회 이상 등장)
    const uses = d.match(/<VisitCallResultBadge\s+result=\{reservation\.visit_call_result\}/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });

  test('CustomerChartPage 예약내역 탭: 예약별 배지(모든 status) 부착', () => {
    const c = read(CHART);
    expect(c).toMatch(/import\s*\{\s*VisitCallResultBadge\s*\}/);
    // 예약 목록 map 항목(r)에 배지
    expect(c).toMatch(/<VisitCallResultBadge\s+result=\{r\.visit_call_result\}/);
  });

  test('접수전 사이드바 블록(수동확인 버튼)은 유지 — status 되돌림 아님', () => {
    const c = read(CHART);
    // 기존 접수전 블록(내원예정 ✓ / 부재 ✗ 수동확인)이 여전히 존재
    expect(c).toMatch(/내원콜 방문 확인 \(접수 전\)/);
    expect(c).toMatch(/btn-visit-confirm-yes/);
  });

  test('라벨 SSOT 불변(reachable=내원예정 / absent=부재)', () => {
    const t = read(TYPES);
    expect(t).toMatch(/reachable:\s*'내원예정'/);
    expect(t).toMatch(/absent:\s*'부재'/);
  });
});
