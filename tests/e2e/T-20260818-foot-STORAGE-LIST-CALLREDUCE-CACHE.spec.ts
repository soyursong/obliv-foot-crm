/**
 * T-20260818-foot-STORAGE-LIST-CALLREDUCE-CACHE
 *
 * [배경] storage.list() 폭주(=DB compute 포화 드라이버, storage.search pg_stat 1위) 완화의
 *   클라캐시 래퍼(cachedStorageList/invalidateStorageList)는 이미 도입(선행 HOTFIX 티켓).
 *   그 래퍼 배선이 CustomerChartPage/CheckInDetailSheet 2 site 에만 걸려 있어 **잔여 6 site** 존재.
 *
 * [본 티켓 scope — planner 게이트결정 MSG-20260818-170710-pmfu]
 *   비의료(non-medical) 4 site 배선 완결:
 *     · InsuranceDocPanel (실손서류 패널)
 *     · PenChartAttachPanel (펜차트 첨부 패널)
 *     · PenChartTab ×2 (loadSavedCharts 목록 + cleanupAttachPrefix cascade)
 *   의료영역 2 site(MedicalChartPanel #5·#6 = 진료차트, 의사 전용)는 **scope 제외**
 *     → 별도 게이트 티켓 T-...-MEDCHART-GATE(문원장 confirm) 로 분리. 본 spec 이 그 격리를 락한다.
 *
 * db_change=false · READ 경로 캐시/dedup + WRITE 후 invalidate. FE-only relief.
 *
 * 본 spec:
 *   (1) 실제 export 래퍼를 counting fake 로 구동 → dedup/cache-HIT/invalidate 호출축소 재확인
 *   (2) 소스 정적 가드 — 4 non-medical site cachedStorageList 경유 + WRITE-후 invalidate 배선
 *   (3) 격리 락 — MedicalChartPanel 은 raw .list() 유지(캐시 미배선) = 게이트 분리 evidence
 *
 * project=unit (순수 로직·counting fake) — 네트워크/auth/webServer 불요·결정론.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { supabase } from '@/lib/supabase';
import { cachedStorageList, invalidateStorageList } from '@/lib/photoUrl';

// ── supabase.storage.from(bucket).list(path,opts) counting fake ──────────────
let listCalls = 0;
function installCountingFake(files: { name: string; id?: string }[] = [{ name: 'a.jpg', id: 'x' }, { name: 'b.jpg', id: 'y' }]) {
  listCalls = 0;
  (supabase.storage as unknown as { from: (b: string) => unknown }).from = (_bucket: string) => ({
    list: async (_p: string, _opts: unknown) => {
      listCalls++;
      return { data: files, error: null };
    },
  });
}

let seq = 0;
const uniqPath = (tag: string) => `customer/UNIT-CALLREDUCE-${tag}-${seq++}/panel`;

test.describe('CALLREDUCE — cachedStorageList 배선 site 호출축소 재확인', () => {
  test('dedup: 동시 mount 8회 → underlying .list() 1회', async () => {
    installCountingFake();
    const p = uniqPath('dedup');
    await Promise.all(Array.from({ length: 8 }, () => cachedStorageList('photos', p, { limit: 100 })));
    expect(listCalls).toBe(1);
  });

  test('cache-HIT: TTL 창 내 반복 → 첫 1회만 실호출', async () => {
    installCountingFake();
    const p = uniqPath('hit');
    await cachedStorageList('photos', p, { limit: 50, sortBy: { column: 'name', order: 'desc' } });
    await cachedStorageList('photos', p, { limit: 50, sortBy: { column: 'name', order: 'desc' } });
    expect(listCalls).toBe(1);
  });

  test('invalidate: WRITE(업로드/삭제) 후 무효화 → 다음 load 재조회', async () => {
    installCountingFake();
    const p = uniqPath('inval');
    await cachedStorageList('photos', p, { limit: 50 }); // 1
    await cachedStorageList('photos', p, { limit: 50 }); // HIT
    expect(listCalls).toBe(1);
    invalidateStorageList('photos', p);
    await cachedStorageList('photos', p, { limit: 50 }); // 재조회 → 2
    expect(listCalls).toBe(2);
  });
});

test.describe('CALLREDUCE — 소스 정적 가드(4 non-medical site 배선 락)', () => {
  const SRC = path.resolve(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

  test('InsuranceDocPanel: cachedStorageList 경유 + raw .list() 제거 + WRITE-후 invalidate', () => {
    const s = read('components/InsuranceDocPanel.tsx');
    expect(s.includes("storage.from('photos').list(")).toBe(false); // 원시 .list() 제거
    expect(s.includes("cachedStorageList('photos'")).toBe(true);
    expect(s.includes("invalidateStorageList('photos'")).toBe(true);
  });

  test('PenChartAttachPanel: cachedStorageList 경유 + raw .list(prefix) 제거 + WRITE-후 invalidate', () => {
    const s = read('components/PenChartAttachPanel.tsx');
    expect(/\.from\(BUCKET\)\s*[\s\S]{0,80}?\.list\(prefix/.test(s)).toBe(false); // 원시 .list(prefix) 제거
    expect(s.includes('cachedStorageList(BUCKET, prefix')).toBe(true);
    expect(s.includes('invalidateStorageList(BUCKET, prefix)')).toBe(true);
  });

  test('PenChartTab: 목록+cascade 2 site cachedStorageList 경유 + raw .list() 제거 + WRITE-후 invalidate', () => {
    const s = read('components/PenChartTab.tsx');
    expect(s.includes('.list(storagePath,')).toBe(false); // loadSavedCharts 원시 제거
    expect(s.includes(".from('photos').list(attachPrefix")).toBe(false); // cleanup 원시 제거
    expect(s.includes("cachedStorageList('photos', storagePath")).toBe(true);
    expect(s.includes("cachedStorageList('photos', attachPrefix")).toBe(true);
    expect(s.includes("invalidateStorageList('photos', storagePath)")).toBe(true);
    expect(s.includes("invalidateStorageList('photos', attachPrefix)")).toBe(true);
  });
});

test.describe('CALLREDUCE — 의료영역 격리 락(scope 제외 evidence)', () => {
  const SRC = path.resolve(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

  test('MedicalChartPanel: raw .list() 유지 + 캐시 미배선 = 게이트 티켓으로 분리(scope 제외)', () => {
    const s = read('components/MedicalChartPanel.tsx');
    // 진료차트(의사 전용)는 본 티켓 scope 아님 — 문원장 confirm 게이트 통과 후 별도 진행.
    expect(s.includes('.list(storagePath,')).toBe(true); // 여전히 raw (미변경 확인)
    expect(s.includes('cachedStorageList(')).toBe(false); // 캐시 래퍼 미배선(격리 유지)
  });
});
