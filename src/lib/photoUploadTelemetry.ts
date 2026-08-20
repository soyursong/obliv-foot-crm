/**
 * photoUploadTelemetry — storage.upload 실패 계측 (T-20260820-foot-PHOTOUP-FAILURE-TELEMETRY)
 *
 * RC 판정서 FIX-C: 실패한 storage.upload 는 DB/스토리지에 흔적을 남기지 않아(성공 경로만 INSERT)
 * 원인 규명이 불가능했다. 이 헬퍼는 upload 실패 그 순간을 PHI-free 로 photo_upload_failures 에
 * best-effort 적재한다.
 *
 * ★ 불변식:
 *   1) PHI-free — customer_id·환자명·차트번호·파일명 절대 미적재.
 *      path_prefix 는 full path 의 "1st 세그먼트(버킷/폴더 prefix 수준)"까지만 남기고 절삭한다.
 *      error 의 raw message 는 적재하지 않는다(경로 누수 방어). name/statusCode(분류축)만.
 *   2) NON-FATAL — 이 함수는 절대 throw 하지 않는다. 계측 실패가 실제 업로드 동선을 막으면 안 된다.
 *   3) write=스태프 인증 경로 — 기존 authenticated supabase 클라이언트로 INSERT (anon 봉인·RLS).
 *
 * @see supabase/migrations/20260820140000_foot_photo_upload_failures_telemetry.sql (테이블·RLS)
 */
import { supabase } from '@/lib/supabase';

export interface PhotoUploadFailureInput {
  /** 스토리지 버킷명 (예: 'treatment-photos', 'documents', 'message-images') */
  bucket: string;
  /** full storage path — 헬퍼가 내부에서 PHI-free prefix 로 절삭 (원본은 적재 안 함) */
  path?: string | null;
  /** 파일 크기(바이트) */
  fileSizeBytes?: number | null;
  /** 스토리지 에러 객체 (name/statusCode 만 추출 · raw message 미적재) */
  error?: unknown;
  /** upload 시도 소요시간(ms) */
  durationMs?: number | null;
  /** 재시도 회차 (0=최초) */
  retryAttempt?: number;
  /** 테넌트 anchor(非PHI 지점 UUID). 있으면 전달, 없으면 null */
  clinicId?: string | null;
}

/** full path → PHI-free prefix: 버킷 + 1st 폴더 세그먼트만. 이후(customer_id 등) 세그먼트는 절삭. */
export function derivePathPrefix(bucket: string, path?: string | null): string {
  if (!path) return bucket;
  // 선행 슬래시 제거 후 첫 세그먼트만 취함 (customer_id/파일명 등 하위 세그먼트 절삭)
  const first = path.replace(/^\/+/, '').split('/')[0] ?? '';
  return first ? `${bucket}/${first}` : bucket;
}

/** 스토리지 에러에서 HTTP status 추출 (network 실패 등은 null). */
function extractHttpStatus(error: unknown): number | null {
  const e = error as { status?: unknown; statusCode?: unknown; originalError?: { status?: unknown } } | null;
  const raw = e?.status ?? e?.statusCode ?? e?.originalError?.status;
  const n = typeof raw === 'string' ? parseInt(raw, 10) : (raw as number | undefined);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** 에러 분류축(name/code)만 추출 · raw message 미적재(PHI/경로 누수 방어) · 120자 캡. */
function extractErrorCode(error: unknown): string | null {
  const e = error as { name?: unknown; code?: unknown; error?: unknown; __isStorageError?: unknown } | null;
  const candidate =
    (typeof e?.name === 'string' && e.name && e.name !== 'Error' ? e.name : null) ??
    (typeof e?.code === 'string' ? e.code : null) ??
    (typeof e?.error === 'string' ? e.error : null) ??
    (typeof e?.name === 'string' ? e.name : null) ??
    (e?.__isStorageError ? 'StorageError' : null);
  if (!candidate) return null;
  return candidate.slice(0, 120);
}

/**
 * storage.upload 실패 1건을 best-effort 적재한다. 절대 throw 하지 않음.
 */
export async function logPhotoUploadFailure(input: PhotoUploadFailureInput): Promise<void> {
  try {
    const row = {
      clinic_id: input.clinicId ?? null,
      bucket: input.bucket,
      path_prefix: derivePathPrefix(input.bucket, input.path),
      file_size_bytes:
        typeof input.fileSizeBytes === 'number' && Number.isFinite(input.fileSizeBytes)
          ? Math.trunc(input.fileSizeBytes)
          : null,
      http_status: extractHttpStatus(input.error),
      error_code: extractErrorCode(input.error),
      duration_ms:
        typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)
          ? Math.trunc(input.durationMs)
          : null,
      retry_attempt: Number.isFinite(input.retryAttempt as number) ? Math.trunc(input.retryAttempt as number) : 0,
    };
    await supabase.from('photo_upload_failures').insert(row);
  } catch {
    // NON-FATAL: 계측 실패는 삼킨다 (실제 업로드 동선 보호).
  }
}
