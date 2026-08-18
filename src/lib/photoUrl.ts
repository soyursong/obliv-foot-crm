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

// ── signed URL 재사용 캐시 (URL 문자열 안정화 → 브라우저 캐시 HIT + 재서명 감축) ──
interface CacheEntry { url: string; expiresAt: number }
const urlCache = new Map<string, CacheEntry>();
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
  const { data } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, PHOTO_SIGNED_TTL, t ? { transform: t } : undefined);
  const url = data?.signedUrl ?? null;
  if (url) urlCache.set(key, { url, expiresAt: now + PHOTO_SIGNED_TTL * 1000 });
  return url;
}

/** 썸네일 signed URL (그리드/목록용). */
export function signedThumbUrl(bucket: string, path: string, t: PhotoTransform = PHOTO_THUMB): Promise<string | null> {
  return signStable(bucket, path, t);
}

/** 썸네일 signed URL 배치 (그리드 목록 일괄). */
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
 * 동일 path 객체가 교체(예: 회전 편집 재업로드)되면 stale URL 이 캐시에서 반환되어
 * 옛 이미지가 브라우저 캐시로 재표시될 수 있으므로 해당 path 캐시를 무효화한다.
 */
export function invalidatePhotoPath(bucket: string, path: string): void {
  const prefix = `${bucket}::${path}::`;
  for (const k of urlCache.keys()) {
    if (k.startsWith(prefix)) urlCache.delete(k);
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

/** list 결과 세션 캐시 창(ms). 반복 mount/remount 를 이 창 내 1회로 collapse. */
const LIST_CACHE_TTL_MS = 30 * 1000;

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

interface ListCacheEntry { at: number; files: StorageListItem[] }
const listCache = new Map<string, ListCacheEntry>();
const listInflight = new Map<string, Promise<StorageListItem[]>>();

function listCacheKey(bucket: string, path: string, opts?: StorageListOpts): string {
  const o = opts ?? {};
  const sort = o.sortBy ? `${o.sortBy.column}:${o.sortBy.order}` : '';
  return `${bucket}::${path}::l${o.limit ?? ''}o${o.offset ?? ''}s${sort}q${o.search ?? ''}`;
}

/**
 * 캐시·dedup 적용 storage.list().
 *   - TTL 창 내 동일 (bucket,path,opts) 재호출 → 네트워크/​storage.search 호출 없이 캐시 반환.
 *   - 창 밖이라도 동일 key 요청이 in-flight 이면 그 Promise 를 공유(동시 mount collapse).
 *   - 에러 시엔 캐시하지 않고 [] 반환(기존 `const { data: files } = ...; if (!files) []` 시맨틱 보존 — throw 없음).
 */
export async function cachedStorageList(
  bucket: string,
  path: string,
  opts?: StorageListOpts,
): Promise<StorageListItem[]> {
  const key = listCacheKey(bucket, path, opts);
  const now = Date.now();
  const hit = listCache.get(key);
  if (hit && now - hit.at < LIST_CACHE_TTL_MS) return hit.files;
  const pending = listInflight.get(key);
  if (pending) return pending;
  const p = (async () => {
    const { data, error } = await supabase.storage.from(bucket).list(path, opts);
    const files = (data ?? []) as StorageListItem[];
    if (!error) listCache.set(key, { at: Date.now(), files });
    return files;
  })().finally(() => { listInflight.delete(key); });
  listInflight.set(key, p);
  return p;
}

/** 업로드/삭제 후 해당 폴더(path)의 모든 opts 변형 list 캐시를 무효화 → 다음 load 즉시 재조회. */
export function invalidateStorageList(bucket: string, path: string): void {
  const prefix = `${bucket}::${path}::`;
  for (const k of listCache.keys()) {
    if (k.startsWith(prefix)) listCache.delete(k);
  }
}
