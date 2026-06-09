/**
 * MMS 이미지 첨부 공용 유틸 — T-20260609-foot-MSG-TEMPLATE-MMS Part B
 *
 * 약도/약국지도 등 이미지를 문자에 첨부하면 SMS/LMS → MMS 로 발송된다.
 * solapi MMS 규격(서버 send-notification EF 의 가드와 동일 기준):
 *   - JPG only (image/jpeg)
 *   - ≤ 200KB (권장)
 *   - 권장 해상도 ≤ 1500 × 1440px (초과해도 발송은 되나 화질·용량 경고)
 *
 * 저장 경로 컨벤션 (버킷 message-images, RLS 1st 세그먼트=clinic_id 격리):
 *   message-images/{clinic_id}/{template|manual}/{uuid}.jpg
 */
import { supabase } from '@/lib/supabase';

export const MMS_MAX_BYTES = 200 * 1024; // 200KB
export const MMS_BUCKET = 'message-images';
/** <input type="file" accept> 값 — JPG 한정 */
export const MMS_ACCEPT = 'image/jpeg,.jpg,.jpeg';
/** 권장 최대 해상도(가로/세로) — 초과 시 경고만(차단 아님) */
export const MMS_RECOMMENDED_MAX_W = 1500;
export const MMS_RECOMMENDED_MAX_H = 1440;

/**
 * 첨부 직전 클라이언트 가드 (AC-8). 통과 시 null, 위반 시 사용자 안내 메시지.
 * 확장자/용량은 즉시 차단, 해상도는 별도 함수에서 경고 처리.
 */
export function validateMmsImage(file: File): string | null {
  const name = (file.name ?? '').toLowerCase();
  const isJpg =
    file.type === 'image/jpeg' ||
    file.type === 'image/jpg' ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg');
  if (!isJpg) return 'JPG 이미지만 첨부할 수 있습니다. (MMS 규격)';
  if (file.size > MMS_MAX_BYTES) {
    return `이미지 용량이 큽니다(${Math.round(file.size / 1024)}KB). 200KB 이하 JPG만 첨부할 수 있습니다.`;
  }
  return null;
}

/** 이미지 해상도 경고 검사 — 권장 초과 시 경고 메시지(차단 아님), 정상이면 null */
export function checkMmsResolution(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth > MMS_RECOMMENDED_MAX_W || img.naturalHeight > MMS_RECOMMENDED_MAX_H) {
        resolve(
          `해상도가 큽니다(${img.naturalWidth}×${img.naturalHeight}). 권장 ${MMS_RECOMMENDED_MAX_W}×${MMS_RECOMMENDED_MAX_H} 이하 이미지를 사용하세요.`,
        );
      } else {
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null); // 해상도 판정 실패는 차단하지 않음(용량/확장자 가드로 충분)
    };
    img.src = url;
  });
}

/** 발송/저장용 storage 경로 생성 — 1st 세그먼트=clinic_id (버킷 RLS 격리 규칙) */
export function buildMmsImagePath(clinicId: string, scope: 'template' | 'manual'): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${clinicId}/${scope}/${uuid}.jpg`;
}

/** message-images 버킷에 업로드 → 성공 시 storage 경로 반환, 실패 시 throw */
export async function uploadMmsImage(file: File, clinicId: string, scope: 'template' | 'manual'): Promise<string> {
  const path = buildMmsImagePath(clinicId, scope);
  const { error } = await supabase.storage.from(MMS_BUCKET).upload(path, file, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** 미리보기용 signed URL(1시간) 생성 — 실패 시 null */
export async function signedMmsImageUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(MMS_BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/** 더 이상 참조되지 않는 이미지 best-effort 삭제(실패 무시) */
export async function removeMmsImage(path: string): Promise<void> {
  try {
    await supabase.storage.from(MMS_BUCKET).remove([path]);
  } catch {
    /* best-effort */
  }
}
