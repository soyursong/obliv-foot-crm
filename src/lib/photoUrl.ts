/**
 * photoUrl — 사진 서빙 최적화 공용 유틸 (Egress 절감)
 *
 * T-20260718-foot-STORAGE-EGRESS-THUMBNAIL-TRANSFORM
 *   [배경] 조직 전체 Supabase Egress 455% 초과(1,138GB/250GB) 사고의 **최대 원인** =
 *     crm-obliv-foot 의 펜차트·차트 화면이 photos 버킷 원본(장당 평균 780KB, 2,355장/1.8GB)을
 *     그리드·목록 렌더마다 **원본 그대로 반복 다운로드**. Image Transformation 사용량 0/100(미사용).
 *     게다가 signed URL 은 매 발급마다 token 이 달라져 브라우저/CDN 캐시가 무력화됨.
 *
 *   [해결 3축]
 *     (1) 썸네일: 그리드/목록은 transform(width/quality) signed URL 로 서빙 → 원본 픽셀 다운로드 금지.
 *         원본은 확대(라이트박스)·다운로드·편집 시점에만 signedOriginalUrl 로 발급.
 *     (2) URL 안정화: 발급한 signed URL 을 (bucket,path,transform) 키로 메모리 캐시해 만료창 내
 *         **동일 URL 문자열**을 재사용 → 재렌더/재진입 시 브라우저 캐시 HIT(재다운로드 0) + 재서명 round-trip 감축.
 *     (3) cacheControl: 신규 업로드분에 UPLOAD_CACHE_CONTROL(초) 부여 → transform/원본 응답이 CDN·브라우저 캐시를 탐.
 *
 *   private 버킷(PHI: photos / treatment-photos)이라 public URL 은 쓰지 않는다. signed URL + transform 유지.
 *
 * T-20260819-foot-CHARTSAVE-STORM-MORNING-RELIEF (재발 4차)
 *   FIX-2  invalidateStorageList 가 in-flight 를 안 지운다 → epoch(prefix) + stale 재조회 1회 + finally 소유권.
 *   FIX-4-A signStable 에 in-flight dedup(signInflight) + 소유권 확인 + invalidatePhotoPath 가 signInflight 도 지움.
 *   FIX-4-B signedOriginalUrls: 원본 배치 서명(createSignedUrls 1회) — datum.path 매칭 + data:null 가드 + urlCache seeding.
 *   FIX-5  listCache document 간 공유(localStorage) + negative caching(실패 시 직전 성공 유지) + epoch 공유 저장.
 *   FIX-5-b LIST_CACHE_TTL_MS 30초 → 5분 (FIX-5 무효화 계약 완성 후에만 안전).
 */
import { supabase } from '@/lib/supabase';

/** signed URL 만료 (1h). 재사용 캐시 만료창과 동일. */
export const PHOTO_SIGNED_TTL = 3600;

/** 업로드 시 부여하는 cacheControl(초) — 브라우저/CDN 캐시 창. AC-2. */
export const UPLOAD_CACHE_CONTROL = '3600';

/** supabase upload options 표준(신규분 cacheControl 부여). */
export const PHOTO_UPLOAD_OPTS = { cacheControl: UPLOAD_CACHE_CONTROL } as const;

export interface PhotoTransform {
  width?: number;
  height?: number;
  quality?: number;
  resize?: 'cover' | 'contain' | 'fill';
}

/** 그리드/목록 기본 썸네일 (태블릿 3열 그리드 기준 — 원본 780KB → 수십 KB). */
export const PHOTO_THUMB: PhotoTransform = { width: 400, quality: 60, resize: 'contain' };

/** 소형 미리보기(목록 행 아이콘 등). */
export const PHOTO_THUMB_SMALL: PhotoTransform = { width: 200, quality: 55, resize: 'contain' };

// ── PHI 위생: 브라우저 로컬 안전 접근 (private mode/비브라우저 → null 로 degrade) ──
function safeLS(): Storage | null {
  try {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null; // 프라이빗 모드/차단
  }
}

// ── signed URL 재사용 캐시 (URL 문자열 안정화 → 브라우저 캐시 HIT + 재서명 감축) ──
interface CacheEntry { url: string; expiresAt: number }
const urlCache = new Map<string, CacheEntry>();
/** FIX-4-A: 서명 축 in-flight dedup (`.list()` 축 listInflight 와 대칭). */
const signInflight = new Map<string, Promise<string | null>>();
/** 실제 만료 직전에 재발급(약간 만료 여유) — 곧 만료될 URL 을 캐시에서 넘겨주지 않게. */
const REISSUE_MARGIN_MS = 5 * 60 * 1000;

function cacheKey(bucket: string, path: string, t?: PhotoTransform): string {
  if (!t) return `${bucket}::${path}::orig`;
  return `${bucket}::${path}::w${t.width ?? ''}h${t.height ?? ''}q${t.quality ?? ''}${t.resize ?? ''}`;
}

/** 안정 signed URL 발급 — 캐시 HIT 시 동일 문자열 재사용(재서명·재다운로드 방지). */
async function signStable(bucket: string, path: string, t?: PhotoTransform): Promise<string | null> {
  const key = cacheKey(bucket, path, t);
  const now = Date.now();
  const hit = urlCache.get(key);
  if (hit && hit.expiresAt - REISSUE_MARGIN_MS > now) return hit.url;
  // FIX-4-A: 동일 key 서명이 in-flight 이면 그 Promise 공유(콜드 동시 진입 중복 발사 제거).
  const pending = signInflight.get(key);
  if (pending) return pending;
  const p = (async () => {
    const { data } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, PHOTO_SIGNED_TTL, t ? { transform: t } : undefined);
    const url = data?.signedUrl ?? null;
    if (url) urlCache.set(key, { url, expiresAt: Date.now() + PHOTO_SIGNED_TTL * 1000 });
    return url;
  })().finally(() => {
    // FIX-4-A: 소유권 확인 — invalidatePhotoPath 직후 같은 key 를 점유한 후속 엔트리를 선행이 지우지 않도록.
    if (signInflight.get(key) === p) signInflight.delete(key);
  });
  signInflight.set(key, p);
  return p;
}

/** 썸네일 signed URL (그리드/목록용). */
export function signedThumbUrl(bucket: string, path: string, t: PhotoTransform = PHOTO_THUMB): Promise<string | null> {
  return signStable(bucket, path, t);
}

/**
 * 썸네일 signed URL 배치 (그리드 목록 일괄).
 * ⚠ 구현은 건당 개별 signStable 호출이다(createSignedUrls 배치 아님).
 *   변환(transform) 썸네일은 서버가 토큰에 서명해 넣으므로 클라이언트 배치 URL 로 대체 불가
 *   (storage-js createSignedUrls options 에 transform 없음). 배치화 금지(T-20260718 egress 축 회귀).
 */
export function signedThumbUrls(
  bucket: string,
  paths: string[],
  t: PhotoTransform = PHOTO_THUMB,
): Promise<(string | null)[]> {
  return Promise.all(paths.map((p) => signStable(bucket, p, t)));
}

/** 원본 signed URL (확대·다운로드·편집 시점에만 — AC-3). */
export function signedOriginalUrl(bucket: string, path: string): Promise<string | null> {
  return signStable(bucket, path);
}

/**
 * FIX-4-B: 원본 배치 서명 (createSignedUrls 1회) — 콜드 로드 2N→N+1.
 *   반환 = path→signedUrl Map (⚠ 인덱스 대응 계약 아님 → 반드시 datum.path 로 매칭).
 *   - storage-js 는 서버 배열을 그대로 통과(재정렬 없음). 순서/개수가 틀어져도 path 매칭이면 안전.
 *   - 호출 전체 실패 시 data:null → 가드하고 빈 Map 반환(현행 인덱싱 코드에 그 가드가 없었음).
 *   - urlCache seeding: 이후 signedOriginalUrl(path) 가 캐시 HIT → 목록과 동일 URL 문자열(브라우저 캐시 유지, egress 회귀 방지).
 *   - urlCache HIT 우선 사용해 재서명 자체를 줄인다.
 */
export async function signedOriginalUrls(bucket: string, paths: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;
  const now = Date.now();
  const misses: string[] = [];
  for (const path of paths) {
    const hit = urlCache.get(cacheKey(bucket, path));
    if (hit && hit.expiresAt - REISSUE_MARGIN_MS > now) result.set(path, hit.url);
    else misses.push(path);
  }
  if (misses.length > 0) {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(misses, PHOTO_SIGNED_TTL);
    if (data) {
      const expiresAt = Date.now() + PHOTO_SIGNED_TTL * 1000;
      for (const datum of data) {
        if (datum.error || !datum.signedUrl || !datum.path) continue;
        result.set(datum.path, datum.signedUrl);
        urlCache.set(cacheKey(bucket, datum.path), { url: datum.signedUrl, expiresAt }); // seeding
      }
    }
  }
  return result;
}

/**
 * 동일 path 객체가 교체(예: 회전 편집 재업로드)되면 stale URL 이 캐시에서 반환되어
 * 옛 이미지가 브라우저 캐시로 재표시될 수 있으므로 해당 path 캐시를 무효화한다.
 * FIX-4-A: signInflight 의 같은 prefix 도 함께 지운다(안 지우면 회전·삭제 직후 in-flight 였던 구 URL 이 대기자에게 반환).
 */
export function invalidatePhotoPath(bucket: string, path: string): void {
  const prefix = `${bucket}::${path}::`;
  for (const k of urlCache.keys()) {
    if (k.startsWith(prefix)) urlCache.delete(k);
  }
  for (const k of signInflight.keys()) {
    if (k.startsWith(prefix)) signInflight.delete(k);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// storage.list() 세션 캐시 + in-flight dedup (compute 포화 relief)
//
// T-20260818-foot-STORAGELIST-EMERGENCY-COMPUTE-RELIEF-HOTFIX
//   [배경] DB compute 포화의 진짜 드라이버 = photos 버킷 storage.list() 폭주
//     (storage.search 3.5M calls · pg_stat_statements 1위). 원인 = 차트/체크인 화면의
//     StorageImageSection 컴포넌트가 mount/remount 마다 .list() 재호출:
//       (a) 한 차트에 여러 섹션 동시 mount, (b) 탭 전환·시트 재오픈·태블릿 카메라앱 복귀 시 remount,
//       (c) 동일 폴더를 여러 화면(고객차트 ↔ 체크인상세)이 각자 재조회.
//   [조치] READ 경로에 (1) 짧은 TTL 세션 캐시 + (2) 동일 key in-flight Promise 병합(dedup).
//     동일 폴더의 반복/동시 .list() 를 창(window) 내 1회로 collapse → storage.search 호출 급감.
//   WRITE(업로드/삭제) 후에는 invalidateStorageList() 로 해당 폴더 캐시를 비워 신규분 즉시 반영.
//   구조적 DB manifest 전환(부모 P1 STORAGE-LIST-CALLREDUCE-CACHE)이 아닌 FE-only relief (db_change=false).
//
// T-20260819-foot-CHARTSAVE-STORM-MORNING-RELIEF (FIX-5)
//   listCache 를 document 단위(모듈 스코프)에서 localStorage 로 승격해 팝업 새 document·탭 3개가 공유한다.
//   epoch(세대)도 공유 저장 → 다른 realm 의 invalidate 가 나의 in-flight resolve 를 stale 로 판정한다.
//   실패 시 negative(직전 성공 목록 유지) — 빈 배열로 화면을 지우지 않는다.
//   PHI 위생: 경로에 customerId 포함 → 버전 prefix + 로그아웃 시 clearAllStorageListCache().

/** list 결과 캐시 창(ms). FIX-5-b: 30초 → 5분 (FIX-5 공유/무효화 계약 완성 후에만 상향 가능). */
const LIST_CACHE_TTL_MS = 5 * 60 * 1000;
/** list 실패 시 재폭주 방지용 짧은 negative 창(ms). */
const LIST_NEG_TTL_MS = 3 * 1000;

export interface StorageListItem {
  name: string;
  id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface StorageListOpts {
  limit?: number;
  offset?: number;
  sortBy?: { column: string; order: string };
  search?: string;
}

export interface StorageListResult {
  files: StorageListItem[];
  error: Error | null;
}

interface ListCacheEntry { at: number; files: StorageListItem[] }
const listCache = new Map<string, ListCacheEntry>();
const listInflight = new Map<string, Promise<StorageListResult>>();
/** negative 창: 실패 key → 마지막 실패 시각. */
const listNegAt = new Map<string, number>();

// ── FIX-5: 공유 저장소(localStorage) 백업 — 버전 prefix + TTL + 로그아웃 폐기 ──
const PLIST_PREFIX = 'foot:storagelist-cache:v1';
const EPOCH_PREFIX = 'foot:storagelist-epoch:v1';
/** epoch in-memory 미러(공유 저장소 부재 시 폴백). */
const inMemEpoch = new Map<string, number>();

function listPrefix(bucket: string, path: string): string {
  return `${bucket}::${path}::`;
}

/** FIX-5: prefix 세대 조회 — 메모리·공유 저장소 중 큰 값(다른 realm 의 bump 반영). */
function readEpoch(prefix: string): number {
  const mem = inMemEpoch.get(prefix) ?? 0;
  const ls = safeLS();
  if (!ls) return mem;
  try {
    const raw = ls.getItem(`${EPOCH_PREFIX}:${prefix}`);
    const persisted = raw ? parseInt(raw, 10) : 0;
    return Math.max(mem, Number.isFinite(persisted) ? persisted : 0);
  } catch {
    return mem;
  }
}

/** FIX-5: prefix 세대 증가 — 메모리·공유 저장소 함께(다른 realm 도 stale 판정 가능하게). */
function bumpEpoch(prefix: string): void {
  const next = readEpoch(prefix) + 1;
  inMemEpoch.set(prefix, next);
  const ls = safeLS();
  if (!ls) return;
  try {
    ls.setItem(`${EPOCH_PREFIX}:${prefix}`, String(next));
  } catch {
    /* quota — 메모리 미러로 degrade */
  }
}

function readPersistentList(key: string): ListCacheEntry | null {
  const ls = safeLS();
  if (!ls) return null;
  try {
    const raw = ls.getItem(`${PLIST_PREFIX}:${key}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed && typeof parsed === 'object' &&
      typeof (parsed as ListCacheEntry).at === 'number' &&
      Array.isArray((parsed as ListCacheEntry).files)
    ) {
      return parsed as ListCacheEntry;
    }
    return null;
  } catch {
    return null; // 파싱/용량 실패 → 캐시 미스 폴백(throw 없음)
  }
}

function writePersistentList(key: string, entry: ListCacheEntry): void {
  const ls = safeLS();
  if (!ls) return;
  try {
    ls.setItem(`${PLIST_PREFIX}:${key}`, JSON.stringify(entry));
  } catch {
    /* quota 등 — 메모리 캐시만으로 degrade */
  }
}

function invalidatePersistentList(prefix: string): void {
  const ls = safeLS();
  if (!ls) return;
  try {
    const full = `${PLIST_PREFIX}:${prefix}`;
    const toRemove: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(full)) toRemove.push(k);
    }
    toRemove.forEach((k) => ls.removeItem(k));
  } catch {
    /* noop */
  }
}

/** FIX-5(PHI 위생): 로그아웃 시 list 캐시 + epoch 를 메모리·공유 저장소 모두 폐기. auth.signOut 에서 호출. */
export function clearAllStorageListCache(): void {
  listCache.clear();
  listInflight.clear();
  listNegAt.clear();
  inMemEpoch.clear();
  const ls = safeLS();
  if (!ls) return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && (k.startsWith(PLIST_PREFIX) || k.startsWith(EPOCH_PREFIX))) toRemove.push(k);
    }
    toRemove.forEach((k) => ls.removeItem(k));
  } catch {
    /* noop */
  }
}

function listCacheKey(bucket: string, path: string, opts?: StorageListOpts): string {
  const o = opts ?? {};
  const sort = o.sortBy ? `${o.sortBy.column}:${o.sortBy.order}` : '';
  return `${bucket}::${path}::l${o.limit ?? ''}o${o.offset ?? ''}s${sort}q${o.search ?? ''}`;
}

/**
 * 캐시·dedup 적용 storage.list() — 에러를 호출자에게 표면화하는 result 변형.
 *   - TTL 창 내 동일 key → 메모리(또는 공유 저장소) 캐시 반환.
 *   - 창 밖이라도 in-flight 이면 그 Promise 공유(동시 mount collapse).
 *   - FIX-2: 요청 시작 시 prefix epoch 캡처 → resolve 시 세대가 바뀌었으면(다른 realm invalidate)
 *     캐시하지 않고 재조회 1회(_depth<1)로 stale 을 호출자에게도 넘기지 않는다.
 *   - FIX-5: 실패 시 직전 성공 목록 유지(negative), 짧은 negative 창으로 재폭주 방지.
 *   - 에러 시엔 캐시하지 않고 error 를 함께 반환(FIX-6: DocumentViewer 토스트 유지용).
 */
export async function cachedStorageListResult(
  bucket: string,
  path: string,
  opts?: StorageListOpts,
  _depth = 0,
): Promise<StorageListResult> {
  const key = listCacheKey(bucket, path, opts);
  const prefix = listPrefix(bucket, path);
  const now = Date.now();

  // 1) 메모리 캐시 HIT
  const hit = listCache.get(key);
  if (hit && now - hit.at < LIST_CACHE_TTL_MS) return { files: hit.files, error: null };

  // 2) 공유 저장소 HIT (팝업 새 document·탭 3개 공유) → 메모리 seed 후 반환
  const persisted = readPersistentList(key);
  if (persisted && now - persisted.at < LIST_CACHE_TTL_MS) {
    listCache.set(key, persisted);
    return { files: persisted.files, error: null };
  }

  // 3) in-flight 공유
  const pending = listInflight.get(key);
  if (pending) return pending;

  // 4) FIX-5 negative 창: 최근 실패 직후 짧은 창에서는 재조회 폭주(origin 포화 가속)를 막고
  //    직전 성공 목록(없으면 빈 목록)을 준다. 창을 지나면 정상 재조회로 복구된다.
  const negAt = listNegAt.get(key);
  if (negAt && now - negAt < LIST_NEG_TTL_MS) {
    const prevNeg = listCache.get(key) ?? readPersistentList(key);
    return { files: prevNeg ? prevNeg.files : [], error: null };
  }

  const startEpoch = readEpoch(prefix);
  // holder 로 자기 promise 참조(자기참조 TS2454 회피 + 소유권 확인용). 런타임엔 await 뒤 항상 assigned.
  const holder: { p?: Promise<StorageListResult> } = {};
  holder.p = (async (): Promise<StorageListResult> => {
    const { data, error } = await supabase.storage.from(bucket).list(path, opts);
    const curEpoch = readEpoch(prefix);
    const stale = curEpoch !== startEpoch;
    // FIX-2: 세대 변경 → stale. 재조회 1회로 호출자에게도 최신본을 준다.
    //   ⚠ 재귀 전에 나(holder.p)를 in-flight 에서 먼저 뺀다 — 안 그러면 재귀가 3)에서 나 자신을 pending 으로
    //     되받아 promise 자기참조(Chaining cycle) 가 된다. 합류한 호출자도 holder.p 를 공유해 함께 최신본을 받는다.
    if (stale && _depth < 1) {
      if (listInflight.get(key) === holder.p) listInflight.delete(key);
      return cachedStorageListResult(bucket, path, opts, _depth + 1);
    }
    if (error) {
      // FIX-5 negative: 직전 성공 목록 유지(화면에서 사진이 사라지지 않게). 캐시에 쓰지 않음.
      listNegAt.set(key, Date.now());
      const prev = listCache.get(key) ?? readPersistentList(key);
      return { files: prev ? prev.files : [], error: error as Error };
    }
    const files = (data ?? []) as StorageListItem[];
    if (!stale) {
      const entry: ListCacheEntry = { at: Date.now(), files };
      listCache.set(key, entry);
      writePersistentList(key, entry);
    }
    return { files, error: null };
  })().finally(() => {
    // FIX-2: 소유권 확인 — invalidate 후 후속 요청이 같은 key 를 점유했으면 선행이 지우지 않는다.
    if (listInflight.get(key) === holder.p) listInflight.delete(key);
  });
  listInflight.set(key, holder.p);
  return holder.p;
}

/**
 * 캐시·dedup 적용 storage.list().
 *   기존 시맨틱 보존 — 실패 시 [] 반환(throw 없음). 에러 표면이 필요하면 cachedStorageListResult 사용.
 */
export async function cachedStorageList(
  bucket: string,
  path: string,
  opts?: StorageListOpts,
): Promise<StorageListItem[]> {
  return (await cachedStorageListResult(bucket, path, opts)).files;
}

/**
 * 업로드/삭제 후 해당 폴더(path)의 모든 opts 변형 list 캐시를 무효화 → 다음 load 즉시 재조회.
 * FIX-2/FIX-5: 메모리 Map · in-flight · negative · epoch(+bump) · 공유 저장소를 하나의 계약으로 함께 무효화한다.
 *   (하나라도 빠지면 다음 load 가 영속 stale 을 다시 읽어 30초→5분 stale 창이 발생한다.)
 */
export function invalidateStorageList(bucket: string, path: string): void {
  const prefix = listPrefix(bucket, path);
  for (const k of listCache.keys()) {
    if (k.startsWith(prefix)) listCache.delete(k);
  }
  for (const k of listInflight.keys()) {
    if (k.startsWith(prefix)) listInflight.delete(k);
  }
  for (const k of listNegAt.keys()) {
    if (k.startsWith(prefix)) listNegAt.delete(k);
  }
  bumpEpoch(prefix);
  invalidatePersistentList(prefix);
}
