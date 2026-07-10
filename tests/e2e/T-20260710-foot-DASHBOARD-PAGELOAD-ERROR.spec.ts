/**
 * E2E Spec: T-20260710-foot-DASHBOARD-PAGELOAD-ERROR
 *
 * 현장(김주연 총괄) "CRM 전체/모든 메뉴 오류" — 셸·사이드바·좌측(달력/근무캘린더/인수인계/공지)은
 * 정상 렌더, 우측 대시보드 메인 패널만 "페이지를 불러오는 중 오류가 발생했습니다" + [새로고침].
 *
 * ── RC (진단-우선) ────────────────────────────────────────────────────────────
 * prod-live 를 테스트 계정으로 순회 → 대시보드+전 메뉴 크래시 재현 안 됨(fresh 브라우저 정상,
 *   4xx/5xx·pageerror 없음). prod 자체는 최신 번들 정합(index.html→최신 해시 chunk, version.json
 *   =최신 커밋). ∴ 회귀 로직 커밋(e0636a47 RESVROUTE-VISITCHANNEL) 무관.
 * RC = 현장 브라우저의 stale 번들 — 오늘 다수 재배포로 구 index 가 참조하던 해시 route-chunk 가
 *   CDN 에서 purge → dynamic import 실패(또는 SPA rewrite 로 index.html(HTML,200) 회신 →
 *   "not a valid JavaScript MIME type") → ChunkErrorBoundary fallback 이 모든 route 에서 노출.
 * 재발 취약점 = App.tsx lazyWithRetry 의 재시도 가드가 '영구 단발 플래그(spa_reload_tried)'라,
 *   한 번 세워지고 정상 clear 경로에 도달 못 하면 이후 정당한 복구까지 영구 무력화 → "모든 메뉴 오류" 지속.
 *
 * ── 처방 ──────────────────────────────────────────────────────────────────────
 * 가드를 시간 윈도우(@/lib/chunkReload SSOT)로 교체 — 무한 reload 루프는 막되 윈도우 만료 시
 *   자가치유가 항상 재무장. lazyWithRetry(fetch 실패 경로)와 ChunkErrorBoundary(eval-time throw 경로)가
 *   가드 하나를 공유. chunk 성 에러는 1회 자동 하드리로드(최신 index→최신 chunk), 실제 렌더 throw 는 제외.
 *
 * AC-1: isChunkLoadError 가 chunk-load 시그니처(HTML MIME 포함)는 true, 실제 렌더 throw 는 false 로 분류
 * AC-2: markAndCheckAutoReload 시간 윈도우 가드 — 윈도우 이내 재시도는 false(루프 차단), 만료 후 true(재무장)
 * AC-3: 소스 — lazyWithRetry·ChunkErrorBoundary 가 chunkReload SSOT 가드를 공유하고 영구 플래그 미사용
 * AC-4: 자가치유 UX — chunk 에러 시 '새 버전 적용 중' recovering 경로로 자동 하드리로드, 수동 [새로고침]은 가드 clear
 *
 * ※ 전 케이스 순수 단위/소스 정적(page/auth/webServer 불요) → playwright.config `unit` 프로젝트 편입,
 *   skip 0 결정론(TEST_PASSWORD 부재 QA 워크트리에서도 실행). 실 stale-번들 자가치유는 client 상태
 *   의존이라 fresh 브라우저로 재현 불가 → supervisor 갤탭 field-soak(강제 stale 시나리오)에서 확인.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  isChunkLoadError,
  markAndCheckAutoReload,
  clearAutoReloadGuard,
  CHUNK_RELOAD_GUARD_KEY,
  CHUNK_RELOAD_LOOP_WINDOW_MS,
} from '../../src/lib/chunkReload';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Node 컨텍스트엔 sessionStorage 가 없다 → chunkReload 가드 테스트용 인메모리 스텁 주입.
function installSessionStorageStub() {
  const store = new Map<string, string>();
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
  return store;
}

// ── AC-1: 에러 분류 ────────────────────────────────────────────────────────────
test.describe('AC-1: isChunkLoadError 분류', () => {
  test('AC-1-1: chunk-load 성격 에러는 true', () => {
    const chunkErrs = [
      Object.assign(new Error('boom'), { name: 'ChunkLoadError' }),
      new Error('Failed to fetch dynamically imported module: https://x/assets/Dashboard-abc.js'),
      new Error('error loading dynamically imported module'),
      new Error('Importing a module script failed.'),
      new Error('Loading chunk 42 failed.'),
      new Error('Loading CSS chunk 7 failed.'),
      // SPA rewrite 로 없는 .js 요청에 index.html(HTML) 회신 시의 브라우저 메시지
      new Error("Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of text/html. Strict MIME type checking is enforced for module scripts per HTML spec."),
      new Error("Failed to load module script: The server responded with a non-JavaScript MIME type of \"text/html\"."),
    ];
    for (const e of chunkErrs) {
      expect(isChunkLoadError(e), `should be chunk: ${e.message}`).toBe(true);
    }
  });

  test('AC-1-2: 실제 렌더 throw 는 false (자동 reload 대상 아님 — 루프 방지)', () => {
    const renderErrs = [
      new TypeError("Cannot read properties of undefined (reading 'map')"),
      new Error('Rendered fewer hooks than expected'),
      new Error('some business logic invariant broke'),
      null,
      undefined,
    ];
    for (const e of renderErrs) {
      expect(isChunkLoadError(e)).toBe(false);
    }
  });
});

// ── AC-2: 시간 윈도우 가드 ──────────────────────────────────────────────────────
test.describe('AC-2: markAndCheckAutoReload 시간 윈도우 가드', () => {
  test('AC-2-1: 최초 시도 true → 윈도우 이내 재시도 false(루프 차단) → 윈도우 경과 후 true(재무장)', () => {
    installSessionStorageStub();
    clearAutoReloadGuard();
    const t0 = 1_783_000_000_000; // 고정 epoch (Date.now 비의존)

    // 최초: 가드 없음 → 리로드 허용
    expect(markAndCheckAutoReload(t0)).toBe(true);
    // 윈도우 이내 재발: 리로드해도 여전히 깨짐 → 차단
    expect(markAndCheckAutoReload(t0 + 1_000)).toBe(false);
    expect(markAndCheckAutoReload(t0 + CHUNK_RELOAD_LOOP_WINDOW_MS - 1)).toBe(false);
    // 윈도우 경과: 새 stale 배포 등 → 자가치유 재무장
    expect(markAndCheckAutoReload(t0 + CHUNK_RELOAD_LOOP_WINDOW_MS + 1)).toBe(true);
  });

  test('AC-2-2: 정상 로드 성공 시 clearAutoReloadGuard 로 즉시 재무장', () => {
    const store = installSessionStorageStub();
    const t0 = 1_783_000_000_000;
    expect(markAndCheckAutoReload(t0)).toBe(true);
    expect(store.get(CHUNK_RELOAD_GUARD_KEY)).toBe(String(t0));
    clearAutoReloadGuard();
    expect(store.has(CHUNK_RELOAD_GUARD_KEY)).toBe(false);
    // clear 직후엔 윈도우 이내라도 다시 허용(성공→재무장 의미)
    expect(markAndCheckAutoReload(t0 + 1_000)).toBe(true);
  });
});

// ── AC-3: 소스 정적 검증 (SSOT 가드 공유) ──────────────────────────────────────
test.describe('AC-3: chunkReload SSOT 가드 공유', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf-8');

  test('AC-3-1: App.tsx lazyWithRetry 가 chunkReload SSOT 사용 + 영구 플래그(spa_reload_tried) 미사용', () => {
    const src = read('../../src/App.tsx');
    expect(src).toContain("from '@/lib/chunkReload'");
    expect(src).toContain('markAndCheckAutoReload');
    expect(src).toContain('clearAutoReloadGuard');
    // 영구 단발 플래그의 '실제 사용'은 제거(주석 언급은 허용) — sessionStorage 직접 접근이 없어야 함
    expect(src).not.toContain("sessionStorage.setItem('spa_reload_tried'");
    expect(src).not.toContain("sessionStorage.getItem('spa_reload_tried'");
  });

  test('AC-3-2: AdminLayout ChunkErrorBoundary 가 동일 SSOT 가드 + isChunkLoadError 사용', () => {
    const src = read('../../src/components/AdminLayout.tsx');
    expect(src).toContain("from '@/lib/chunkReload'");
    expect(src).toContain('isChunkLoadError');
    expect(src).toContain('markAndCheckAutoReload');
    // 청크성 에러만 자동 reload (componentDidCatch 게이트)
    expect(src).toContain('componentDidCatch');
    expect(src).toContain('if (!isChunkLoadError(error)) return');
  });
});

// ── AC-4: ChunkErrorBoundary 자가치유 UX (소스 정적) ───────────────────────────
test.describe('AC-4: ChunkErrorBoundary 자가치유 경로', () => {
  const adminSrc = () =>
    fs.readFileSync(path.resolve(__dirname, '../../src/components/AdminLayout.tsx'), 'utf-8');

  test('AC-4-1: chunk 에러는 recovering 경로(자동 하드리로드) + 안내 문구 노출', () => {
    const src = adminSrc();
    // 자동 복구 상태 플래그 + 사용자 안내(무한 대기가 아니라 '적용 중' 노출)
    expect(src).toContain('recovering');
    expect(src).toContain('새 버전을 적용하는 중입니다');
    // recovering 진입 후 window.location.reload() 로 최신 번들 획득
    expect(src).toMatch(/this\.setState\(\{\s*recovering:\s*true\s*\}\);[\s\S]*window\.location\.reload\(\)/);
  });

  test('AC-4-2: 수동 [새로고침] 은 clearAutoReloadGuard 로 가드를 비워 자가치유 재무장', () => {
    const src = adminSrc();
    // 폴백 버튼 라벨 유지 + 클릭 시 가드 clear 후 reload
    expect(src).toContain('새로고침');
    expect(src).toMatch(/clearAutoReloadGuard\(\);[\s\S]*window\.location\.reload\(\)/);
  });

  test('AC-4-3: 실제 렌더 throw 는 자동 reload 대상에서 제외(루프 방지)', () => {
    const src = adminSrc();
    // componentDidCatch 초입에서 비-chunk 에러는 early-return
    expect(src).toContain('if (!isChunkLoadError(error)) return');
  });
});
