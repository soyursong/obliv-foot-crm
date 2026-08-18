/**
 * T-20260818-foot-STORAGELIST-EMERGENCY-COMPUTE-RELIEF-HOTFIX
 *
 * [배경] DB compute 포화의 진짜 드라이버 = photos 버킷 storage.list() 폭주
 *   (storage.search 3.5M calls · pg_stat_statements 1위). 원인 = 고객차트/체크인상세의
 *   StorageImageSection 컴포넌트가 mount/remount 마다 .list() 재호출.
 *
 * [조치] READ 경로에 세션 캐시(TTL) + in-flight dedup(cachedStorageList) 도입,
 *   WRITE(업로드/삭제) 후 invalidateStorageList 로 즉시 반영. FE-only relief(db_change=false).
 *
 * 본 spec = **실제 export 함수**(cachedStorageList/invalidateStorageList)를 구동해
 *   underlying supabase.storage.list() 호출 횟수를 계측 → before/after 호출빈도 evidence 를 단언한다.
 *   supabase 싱글턴의 storage.from 을 counting fake 로 교체(네트워크 0, auth/webServer 불요·결정론).
 *   TTL 만료(30s) 자체는 시간의존이라 단언 제외 — dedup+cache-HIT+invalidation 축소분만 검증.
 *
 * project=unit (순수 로직·counting fake) — desktop-chrome testIgnore 로 브라우저/auth 유입 차단.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { supabase } from '@/lib/supabase';
import { cachedStorageList, invalidateStorageList } from '@/lib/photoUrl';

// ── supabase.storage.from(bucket).list(path,opts) counting fake ──────────────
let listCalls = 0;
const seenArgs: { path: string; opts: unknown }[] = [];
function installCountingFake(files: { name: string; id?: string }[] = [{ name: 'a.jpg' }, { name: 'b.jpg' }]) {
  listCalls = 0;
  seenArgs.length = 0;
  (supabase.storage as unknown as { from: (b: string) => unknown }).from = (_bucket: string) => ({
    list: async (p: string, opts: unknown) => {
      listCalls++;
      seenArgs.push({ path: p, opts });
      return { data: files, error: null };
    },
  });
}

// 캐시는 모듈 스코프 Map(테스트 간 잔존) → 테스트마다 유니크 path 로 key 충돌 회피.
let seq = 0;
const uniqPath = (tag: string) => `customer/UNIT-${tag}-${seq++}/before-after`;

test.describe('STORAGELIST emergency relief — cachedStorageList 호출빈도 계측', () => {
  test('dedup: 동시 mount N회 → underlying .list() 1회로 collapse', async () => {
    installCountingFake();
    const p = uniqPath('dedup');
    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, () => cachedStorageList('photos', p, { limit: 50, sortBy: { column: 'name', order: 'desc' } })),
    );
    expect(listCalls).toBe(1); // 동시 8 요청 → in-flight Promise 병합 → 실호출 1
    // 모든 caller 가 동일 결과(파일 2건) 수신 — 캐시가 데이터 무결성 보존.
    for (const r of results) expect(r.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);
    // eslint-disable-next-line no-console
    console.log(`[EVIDENCE dedup] callers=${N}  underlying.list=${listCalls}`);
  });

  test('cache-HIT: TTL 창 내 반복 mount → 첫 1회만 실호출', async () => {
    installCountingFake();
    const p = uniqPath('hit');
    await cachedStorageList('photos', p, { limit: 50 }); // 1
    await cachedStorageList('photos', p, { limit: 50 }); // HIT
    await cachedStorageList('photos', p, { limit: 50 }); // HIT
    expect(listCalls).toBe(1);
  });

  test('invalidate: 업로드/삭제 후 무효화 → 다음 load 재조회(즉시 반영)', async () => {
    installCountingFake();
    const p = uniqPath('inval');
    await cachedStorageList('photos', p, { limit: 50 }); // 1
    await cachedStorageList('photos', p, { limit: 50 }); // HIT (still 1)
    expect(listCalls).toBe(1);
    invalidateStorageList('photos', p); // 업로드/삭제 후 캐시 비움
    await cachedStorageList('photos', p, { limit: 50 }); // 재조회 → 2
    expect(listCalls).toBe(2);
  });

  test('key-separation: 다른 opts/path 는 별개 캐시 키(오염 없음)', async () => {
    installCountingFake();
    const p = uniqPath('keysep');
    await cachedStorageList('photos', p, { limit: 50 });
    await cachedStorageList('photos', p, { limit: 100 }); // limit 다름 → 새 키
    await cachedStorageList('photos', `${p}/x`, { limit: 50 }); // path 다름 → 새 키
    expect(listCalls).toBe(3);
  });

  test('EVIDENCE before/after: 반복 mount 50회 storage.search 호출빈도 축소', async () => {
    installCountingFake();
    const p = uniqPath('storm');
    const MOUNTS = 50; // before(raw .list): 매 mount 마다 1 = 50
    for (let i = 0; i < MOUNTS; i++) await cachedStorageList('photos', p, { limit: 50 });
    const after = listCalls; // after(cached): TTL 창 내 1
    expect(after).toBe(1);
    const reduction = ((1 - after / MOUNTS) * 100).toFixed(1);
    // eslint-disable-next-line no-console
    console.log(`[EVIDENCE before/after] before(raw .list)=${MOUNTS}  after(cached)=${after}  reduction=${reduction}%`);
    expect(after).toBeLessThan(MOUNTS); // 축소 확정
  });
});

test.describe('STORAGELIST relief — 소스 정적 가드(회귀 락)', () => {
  const SRC = path.resolve(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

  test('CustomerChartPage: raw storage.list() 미사용 + cachedStorageList/invalidateStorageList 경유', () => {
    const s = read('pages/CustomerChartPage.tsx');
    expect(s.includes("storage.from('photos').list(")).toBe(false); // 원시 .list() 제거
    expect(s.includes('cachedStorageList(')).toBe(true);
    expect(s.includes('invalidateStorageList(')).toBe(true);
  });

  test('CheckInDetailSheet: raw storage.list() 미사용 + cachedStorageList/invalidateStorageList 경유', () => {
    const s = read('components/CheckInDetailSheet.tsx');
    expect(s.includes("storage.from('photos').list(")).toBe(false);
    expect(s.includes('cachedStorageList(')).toBe(true);
    expect(s.includes('invalidateStorageList(')).toBe(true);
  });

  test('photoUrl: cachedStorageList/invalidateStorageList export 존재', () => {
    const s = read('lib/photoUrl.ts');
    expect(s.includes('export async function cachedStorageList')).toBe(true);
    expect(s.includes('export function invalidateStorageList')).toBe(true);
  });
});
