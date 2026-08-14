/**
 * T-20260814-foot-TREATTABLE-PROGRESSANALYSIS-ERROR — 경과분석 조회 400 Bad Request 회귀방지 (pure-logic E2E)
 *
 * 현상(스크린샷 F0BQACNPJDS): 치료테이블 > 경과분석 진입 시 리스트 영역에
 *   "조회 중 오류가 발생했습니다. Bad Request" (PostgREST 400) 표시.
 *
 * 근본원인: T-20260812 나열기준 변경으로 useProgressTargets 가 '활성 패키지 전건'을 조회한 뒤
 *   package_sessions/customers/reservations 를 .in(<pkgIds|customerIds>) 로 조회.
 *   운영 누적으로 id 목록이 수백~수천 개가 되면 PostgREST GET URL 길이 한계를 초과 → 400 Bad Request →
 *   list 쿼리 throw → 섹션 전체가 isError 로 빠져 위 오류 배너 렌더.
 *
 * 수정: .in() 목록을 chunkIds(IN_CHUNK_SIZE=200) 단위로 분할 조회.
 *
 * 검증 대상(순수 로직) = 분할이 (a)각 청크가 한계-안전 크기 이하 (b)전체 원소 무손실·무중복·순서보존 을 만족.
 *   Supabase 조립·URL 실측은 컴포넌트 통합 수동 QA(현장 브라우저)로 확인.
 */
import { test, expect } from '@playwright/test';
import { chunkIds, IN_CHUNK_SIZE } from '../../src/lib/progressSixMultiple';

test.describe('PROGRESSANALYSIS-ERROR · chunkIds (.in() URL 한계 회피)', () => {
  test('IN_CHUNK_SIZE = 200 (선례 visitRecency 와 동일, URL 안전 크기)', () => {
    expect(IN_CHUNK_SIZE).toBe(200);
  });

  test('빈 배열 → 청크 0개 (불필요 쿼리 미발생)', () => {
    expect(chunkIds([], IN_CHUNK_SIZE)).toEqual([]);
  });

  test('한계 이하 소량(예: 오늘 예약 소수) → 단일 청크(무분할)', () => {
    const ids = Array.from({ length: 37 }, (_, i) => `pkg-${i}`);
    const chunks = chunkIds(ids, IN_CHUNK_SIZE);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual(ids);
  });

  test('정확히 경계(200개) → 단일 청크', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `pkg-${i}`);
    const chunks = chunkIds(ids, IN_CHUNK_SIZE);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(200);
  });

  test('대량(운영 누적 재현: 1250개) → 각 청크 ≤200 (400 방지 불변식)', () => {
    const ids = Array.from({ length: 1250 }, (_, i) => `pkg-${i}`);
    const chunks = chunkIds(ids, IN_CHUNK_SIZE);
    // 1250 / 200 = 7 청크(200×6 + 50).
    expect(chunks.length).toBe(7);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(IN_CHUNK_SIZE);
  });

  test('무손실·무중복·순서보존 — 재조립 시 원본과 동일', () => {
    const ids = Array.from({ length: 1250 }, (_, i) => `pkg-${i}`);
    const chunks = chunkIds(ids, IN_CHUNK_SIZE);
    const flat = chunks.flat();
    expect(flat).toEqual(ids); // 순서·개수·값 모두 일치(누락/중복/뒤섞임 없음).
    expect(new Set(flat).size).toBe(ids.length);
  });

  test('size<=0 폴백 — 통짜 1청크(비어있으면 0청크), 무한루프 방지', () => {
    const ids = ['a', 'b', 'c'];
    expect(chunkIds(ids, 0)).toEqual([ids]);
    expect(chunkIds(ids, -5)).toEqual([ids]);
    expect(chunkIds([], 0)).toEqual([]);
  });

  test('기본 인자(size 생략) → IN_CHUNK_SIZE 적용', () => {
    const ids = Array.from({ length: 500 }, (_, i) => i);
    const chunks = chunkIds(ids);
    expect(chunks.length).toBe(3); // 200 + 200 + 100
    expect(chunks.flat()).toEqual(ids);
  });
});
