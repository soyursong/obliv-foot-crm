/**
 * T-20260819-foot-CHARTSAVE-STORM-MORNING-RELIEF — 배치 3 회귀 락(종결 조건)
 *
 * 본 증상은 재발 4차다. 1·2·3차는 급한 축만 고치고 계열을 닫지 않아 실패했다.
 * 이 spec 은 계열을 닫는 회귀 락이다 — 두 층으로 구성한다:
 *
 *   [A] 기능 계측(실 export 함수 + counting fake, 네트워크 0·결정론):
 *       - FIX-2  invalidate 세대(epoch) 변경 시 in-flight 호출자에게도 stale 안 주고 재조회 1회
 *       - FIX-4-A signStable in-flight dedup(콜드 동시 진입 중복 서명 0) + invalidatePhotoPath 반영
 *       - FIX-4-B signedOriginalUrls 배치 서명이 datum.path 로 매칭(순서/누락 내성) + data:null 가드
 *       - FIX-5  cachedStorageListResult negative(실패 시 직전 성공 목록 유지, 화면 미소실)
 *       - dedup / cache-HIT / invalidate 재조회 / key-separation(선례 c4d44423 계승)
 *
 *   [B] 소스 정적 가드(회귀 락 — §11 축 4, c4d44423 "소스 정적 가드" 선례 형식):
 *       - G-1 FIX-1 : 무한 렌더루프 정지 — onUrlsLoaded 에 인라인 화살표 재유입 금지 + 참조안정 콜백 배선
 *       - G-3 FIX-3 : PenChartTab 크로스-realm 수신부(handleUpdate)가 invalidateStorageList 선행
 *       - G-4 FIX-7 : 치료메모 저장 핸들러(saveNewTreatmentMemo/saveTreatmentMemoEdit) useCallback 고정
 *       - G-5 클래스 락 : 확정된 루프 클래스(자식 deps 포함 prop 을 fresh 인자로 호출)의 유일 실체
 *                        (onUrlsLoaded) 가 인라인 화살표로 다시 호출되지 않는다 — 전 src 스윕.
 *
 * ⚠ project=unit 전용(순수 로직·fs-grep). desktop-chrome testIgnore 로 브라우저/auth 유입 차단
 *   (무-project 실행도 setup 미유입). ⚠ '--project=unit' 은 CI 독립 job 편입 대상(§11 축 4).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { supabase } from '@/lib/supabase';
import {
  cachedStorageList,
  cachedStorageListResult,
  invalidateStorageList,
  signedOriginalUrl,
  signedOriginalUrls,
  invalidatePhotoPath,
} from '@/lib/photoUrl';

// ── counting fake: supabase.storage.from(bucket) ─────────────────────────────
let listCalls = 0;
let signOneCalls = 0;
let signBatchCalls = 0;

interface FakeCfg {
  files?: { name: string; id?: string }[];
  listError?: { message: string } | null;
  /** list resolve 를 수동 제어(FIX-2 세대변경 시나리오용). null 이면 즉시 resolve. */
  listGate?: Promise<void> | null;
  /** createSignedUrls 반환 — data:null 가드/순서 무관 매칭 검증용. */
  batch?: { path: string; signedUrl: string | null; error?: unknown }[] | null;
}

function installFake(cfg: FakeCfg = {}) {
  const files = cfg.files ?? [{ name: 'a.jpg' }, { name: 'b.jpg' }];
  (supabase.storage as unknown as { from: (b: string) => unknown }).from = (_bucket: string) => ({
    list: async (_p: string, _opts: unknown) => {
      listCalls++;
      if (cfg.listGate) await cfg.listGate;
      if (cfg.listError) return { data: null, error: cfg.listError };
      return { data: files, error: null };
    },
    createSignedUrl: async (p: string, _ttl: number, _opts?: unknown) => {
      signOneCalls++;
      return { data: { signedUrl: `signed://${p}#${signOneCalls}` }, error: null };
    },
    createSignedUrls: async (paths: string[], _ttl: number) => {
      signBatchCalls++;
      if (cfg.batch === null) return { data: null, error: { message: 'batch failed' } };
      const data =
        cfg.batch ?? paths.map((pp) => ({ path: pp, signedUrl: `batch://${pp}`, error: null }));
      return { data, error: null };
    },
  });
}

let seq = 0;
const uniq = (tag: string) => `customer/UNIT-CHARTSAVE-${tag}-${seq++}/before-after`;

test.beforeEach(() => {
  listCalls = 0;
  signOneCalls = 0;
  signBatchCalls = 0;
});

// ─────────────────────────────────────────────────────────────────────────────
// [A] 기능 계측
// ─────────────────────────────────────────────────────────────────────────────
test.describe('CHARTSAVE-STORM 회귀 락 [A] 기능 계측', () => {
  test('dedup: 동시 mount N회 → underlying .list() 1회로 collapse', async () => {
    installFake();
    const p = uniq('dedup');
    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, () => cachedStorageList('photos', p, { limit: 50 })),
    );
    expect(listCalls).toBe(1);
    for (const r of results) expect(r.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);
  });

  test('cache-HIT: TTL 창 내 반복 → 첫 1회만 실호출', async () => {
    installFake();
    const p = uniq('hit');
    await cachedStorageList('photos', p, { limit: 50 });
    await cachedStorageList('photos', p, { limit: 50 });
    await cachedStorageList('photos', p, { limit: 50 });
    expect(listCalls).toBe(1);
  });

  test('invalidate: 무효화 후 다음 load 재조회(즉시 반영)', async () => {
    installFake();
    const p = uniq('inval');
    await cachedStorageList('photos', p, { limit: 50 });
    await cachedStorageList('photos', p, { limit: 50 });
    expect(listCalls).toBe(1);
    invalidateStorageList('photos', p);
    await cachedStorageList('photos', p, { limit: 50 });
    expect(listCalls).toBe(2);
  });

  test('key-separation: 다른 opts/path 는 별개 캐시 키(오염 없음)', async () => {
    installFake();
    const p = uniq('keysep');
    await cachedStorageList('photos', p, { limit: 50 });
    await cachedStorageList('photos', p, { limit: 100 });
    await cachedStorageList('photos', `${p}/x`, { limit: 50 });
    expect(listCalls).toBe(3);
  });

  test('FIX-2: in-flight 도중 invalidate(세대 변경) → 호출자에게도 stale 안 주고 재조회 1회', async () => {
    // 선행 list 를 gate 로 붙잡은 채 invalidate(epoch bump) → resolve 시 stale 판정 → _depth<1 재조회.
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    installFake({ listGate: gate });
    const p = uniq('fix2');
    const pending = cachedStorageListResult('photos', p, { limit: 50 });
    await Promise.resolve(); // list() 진입(startEpoch 캡처) 보장
    invalidateStorageList('photos', p); // 세대 변경 — 첫 응답은 stale 로 판정돼야 함
    release();
    const res = await pending;
    // 재조회가 1회 발생(총 2회) + 최종 결과는 에러 없는 최신본.
    expect(listCalls).toBe(2);
    expect(res.error).toBeNull();
    expect(res.files.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);
  });

  test('FIX-5/FIX-6: list 실패는 error 를 표면화(토스트 유지) + 이후 짧은 창에서 재조회 폭주 억제', async () => {
    installFake({ listError: { message: 'boom' } });
    const p = uniq('neg');
    const r1 = await cachedStorageListResult('photos', p, { limit: 50 });
    expect(r1.error).not.toBeNull(); // FIX-6: 에러 표면 유지(DocumentViewer 토스트)
    expect(listCalls).toBe(1);
    // negative 창 내 재조회 → origin 포화 가속 방지(실호출 미증가). 직전 성공이 없으면 빈 목록.
    const r2 = await cachedStorageListResult('photos', p, { limit: 50 });
    expect(listCalls).toBe(1);
    expect(r2.error).toBeNull();
    // 무효화하면 negative 창도 해제 → 정상 재조회 복구.
    invalidateStorageList('photos', p);
    installFake(); // origin 복구
    const r3 = await cachedStorageListResult('photos', p, { limit: 50 });
    expect(r3.files.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);
  });

  test('FIX-4-A: signStable in-flight dedup — 콜드 동시 진입 중복 서명 0 + invalidatePhotoPath 반영', async () => {
    installFake();
    const target = `customer/UNIT-CHARTSAVE-sign-${seq++}/pen-chart/1.png`;
    const [u1, u2] = await Promise.all([
      signedOriginalUrl('photos', target),
      signedOriginalUrl('photos', target),
    ]);
    expect(signOneCalls).toBe(1); // 동시 2요청 → in-flight 병합 → 실서명 1
    expect(u1).toBe(u2);
    // 회전/삭제 후 무효화 → 다음 서명은 신규 URL(캐시·in-flight 모두 비움).
    invalidatePhotoPath('photos', target);
    const u3 = await signedOriginalUrl('photos', target);
    expect(signOneCalls).toBe(2);
    expect(u3).not.toBe(u1);
  });

  test('FIX-4-B: signedOriginalUrls 배치가 datum.path 로 매칭(순서 뒤바뀜 내성) + 누락/에러 제외', async () => {
    const p0 = `customer/UNIT-CHARTSAVE-b4b-${seq++}/pen-chart/0.png`;
    const p1 = `customer/UNIT-CHARTSAVE-b4b-${seq++}/pen-chart/1.png`;
    const p2 = `customer/UNIT-CHARTSAVE-b4b-${seq++}/pen-chart/2.png`;
    // 서버가 순서를 뒤집고(p2,p0,p1) p1 을 에러로 반환 — 위치 인덱싱이면 이름이 밀린다.
    installFake({
      batch: [
        { path: p2, signedUrl: 'batch://p2' },
        { path: p0, signedUrl: 'batch://p0' },
        { path: p1, signedUrl: null, error: { message: 'nope' } },
      ],
    });
    const map = await signedOriginalUrls('photos', [p0, p1, p2]);
    expect(map.get(p0)).toBe('batch://p0'); // 위치가 아니라 path 로 정확히 매칭
    expect(map.get(p2)).toBe('batch://p2');
    expect(map.has(p1)).toBe(false); // 에러/누락은 제외(밀림 없음)
    expect(signBatchCalls).toBe(1);
  });

  test('FIX-4-B: 배치 전체 실패(data:null) → 빈 Map(throw 없음, 인덱싱 크래시 방지)', async () => {
    const p0 = `customer/UNIT-CHARTSAVE-b4bnull-${seq++}/pen-chart/0.png`;
    installFake({ batch: null });
    const map = await signedOriginalUrls('photos', [p0]);
    expect(map.size).toBe(0);
    expect(signBatchCalls).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [B] 소스 정적 가드(회귀 락 — §11 축 4)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('CHARTSAVE-STORM 회귀 락 [B] 소스 정적 가드', () => {
  const SRC = path.resolve(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

  test('G-1 (FIX-1): onUrlsLoaded 인라인 화살표 재유입 금지 + 참조안정 콜백 배선', () => {
    const s = read('pages/CustomerChartPage.tsx');
    // 참조안정 콜백 존재 + 배선.
    expect(/const handleTreatmentUrlsLoaded = useCallback\(/.test(s)).toBe(true);
    expect(s.includes('onUrlsLoaded={handleTreatmentUrlsLoaded}')).toBe(true);
    // 인라인 화살표(부모 렌더마다 새 identity) 재유입 금지 — 루프 재점화 벡터.
    expect(/onUrlsLoaded=\{\s*\(/.test(s)).toBe(false);
  });

  test('G-3 (FIX-3): PenChartTab 크로스-realm 수신부가 invalidateStorageList 선행', () => {
    const s = read('components/PenChartTab.tsx');
    expect(s.includes('invalidateStorageList')).toBe(true);
    // handleUpdate 블록 안에서 invalidate 후 loadSavedCharts 를 부른다.
    const m = s.match(/const handleUpdate = \([\s\S]*?loadSavedCharts\(\);/);
    expect(m).not.toBeNull();
    expect(m![0].includes("invalidateStorageList('photos', storagePath)")).toBe(true);
  });

  test('G-4 (FIX-7): 치료메모 저장 핸들러 useCallback 고정', () => {
    const s = read('pages/CustomerChartPage.tsx');
    expect(/const saveNewTreatmentMemo = useCallback\(/.test(s)).toBe(true);
    expect(/const saveTreatmentMemoEdit = useCallback\(/.test(s)).toBe(true);
    // onCancel 참조 안정화(인라인 화살표 무력화 방지)도 잠근다.
    expect(/const handleCancelMemoEdit = useCallback\(/.test(s)).toBe(true);
    expect(s.includes('onCancel={handleCancelMemoEdit}')).toBe(true);
  });

  test('G-5 (클래스 락): 확정된 루프 클래스(onUrlsLoaded) 가 전 src 어디서도 인라인 화살표로 호출되지 않는다', () => {
    // §11 축 1 전수 스윕에서 이 루프 클래스(자식 deps 포함 prop + fresh 인자 호출 + 부모 setState)의
    //   유일 실체로 확정된 onUrlsLoaded. 전 src 에서 인라인 화살표 재유입을 봉인한다.
    const files = ['pages/CustomerChartPage.tsx', 'components/PenChartTab.tsx', 'components/MedicalChartPanel.tsx'];
    for (const rel of files) {
      const s = read(rel);
      expect(/onUrlsLoaded=\{\s*\(/.test(s)).toBe(false);
    }
  });

  test('G-8 (FIX-8): isTableMissing 자유텍스트 message.includes 절 소거(code 판정만)', () => {
    const s = read('pages/CustomerChartPage.tsx');
    // 테이블명/schema cache 자유텍스트 매칭은 오분류 벡터 → 재유입 금지.
    expect(s.includes("error.message?.includes('customer_treatment_memos')")).toBe(false);
    expect(s.includes("error.message?.includes('schema cache')")).toBe(false);
    // 고객 전환 시 입력창 복귀 경로.
    expect(s.includes('setTreatmentMemoUnavailable(false)')).toBe(true);
  });

  test('G-12 (FIX-12): receipt 다운스케일은 receipt 진입점에만 배선(임상 화질 무접촉)', () => {
    const s = read('pages/CustomerChartPage.tsx');
    expect(s.includes('downscaleReceiptImage(')).toBe(true);
    const lib = read('lib/formImageDownscale.ts');
    // 장축 1600·q0.80 확정값 + 부풀림 방지 가드.
    expect(lib.includes('RECEIPT_MAX_LONG_EDGE = 1600')).toBe(true);
    expect(lib.includes('RECEIPT_JPEG_QUALITY = 0.80')).toBe(true);
    expect(lib.includes('blob.size >= file.size')).toBe(true);
  });

  test('MEDCHART-GATE 유지: MedicalChartPanel raw .list() 는 무접촉(캐시 전환 대상 아님)', () => {
    const s = read('components/MedicalChartPanel.tsx');
    // §6-A 는 정합성만 고쳤고 .list() 호출부는 게이트로 잠겨 있어야 한다.
    expect(/\.from\('photos'\)\s*\.list\(/.test(s)).toBe(true);
    expect(s.includes('cachedStorageList(')).toBe(false);
  });

  test('photoUrl: 신규 export 계약 존재(회귀 락 앵커)', () => {
    const s = read('lib/photoUrl.ts');
    expect(s.includes('export async function cachedStorageListResult')).toBe(true);
    expect(s.includes('export async function signedOriginalUrls')).toBe(true);
    expect(s.includes('export function clearAllStorageListCache')).toBe(true);
  });
});
