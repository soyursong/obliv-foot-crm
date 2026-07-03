/**
 * useTreatmentPhotos — 직원촬영 임상사진(canonical treatment_photos 테이블) 조회/촬영/삭제 훅.
 *
 * T-20260703-foot-STAFFPHOTO-CHART-LINK.
 *
 * 설계 원칙(DA CONSULT MSG-20260703-103153-y6ez 반영):
 *   · private 'treatment-photos' 버킷. 서빙 = RLS-gated signed URL 만 (public URL 절대 미사용).
 *   · storage 경로 = {clinic_id}/{customer_id}/{uuid}.{ext}  (clinic-path RLS 미러).
 *   · 삭제 = soft-delete (deleted_at set). 물리 DELETE / Storage object 영구삭제 금지(의료법 §22 보존).
 *   · 조회 = deleted_at IS NULL, created_at DESC (최신순).
 *
 * 느슨 결합: customerId/clinicId 를 props 로만 받는다. 진료차트 '사진' 탭 배치는 placement_pending
 *   (총괄 배치 컨펌 대기) — 소비 컴포넌트에서 위치만 바꿔 재사용 가능하도록 UI 비의존.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { TreatmentPhoto, TreatmentPhotoType } from '@/lib/types';

const BUCKET = 'treatment-photos';
const SIGNED_URL_TTL = 3600; // 1h

export interface TreatmentPhotoWithUrl extends TreatmentPhoto {
  /** 조회용 signed URL (private 버킷 — 만료 후 재발급) */
  signedUrl: string | null;
}

export interface CaptureInput {
  /** Blob(카메라/파일) 또는 dataURL 문자열 */
  body: Blob | string;
  ext?: 'jpg' | 'jpeg' | 'png' | 'webp';
  contentType?: string;
  photoType?: TreatmentPhotoType;
  bodyPart?: string | null;
  photoCategory?: string | null;
  treatmentName?: string | null;
  sessionNo?: number | null;
  note?: string | null;
  checkInId?: string | null;
  originalFilename?: string | null;
}

const EXT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

async function toBlob(body: Blob | string): Promise<Blob> {
  if (typeof body !== 'string') return body;
  const res = await fetch(body); // dataURL / objectURL 모두 처리
  return res.blob();
}

// RFC4122 uuid (crypto.randomUUID 폴백 포함 — 구형 태블릿 웹뷰 방어)
function uuid(): string {
  const c = (globalThis.crypto as Crypto | undefined);
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor((c?.getRandomValues?.(new Uint8Array(1))?.[0] ?? 0) / 16) || 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function useTreatmentPhotos(customerId: string | null, clinicId: string | null) {
  const [photos, setPhotos] = useState<TreatmentPhotoWithUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    if (!customerId) { setPhotos([]); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from('treatment_photos')
        .select('*')
        .eq('customer_id', customerId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (qErr) throw qErr;

      const rows = (data ?? []) as TreatmentPhoto[];
      // private 버킷 → signed URL 일괄 발급 (per-row 버킷: 신규=treatment-photos, 레거시 backfill=photos)
      const withUrls: TreatmentPhotoWithUrl[] = await Promise.all(
        rows.map(async (r) => {
          const { data: signed } = await supabase.storage
            .from(r.storage_bucket ?? BUCKET)
            .createSignedUrl(r.photo_url, SIGNED_URL_TTL);
          return { ...r, signedUrl: signed?.signedUrl ?? null };
        }),
      );
      if (aliveRef.current) setPhotos(withUrls);
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : '사진을 불러오지 못했습니다.');
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => { aliveRef.current = false; };
  }, [load]);

  /** 촬영/업로드 → storage put + treatment_photos insert */
  const capture = useCallback(async (input: CaptureInput): Promise<boolean> => {
    if (!customerId || !clinicId) {
      setError('고객/클리닉 정보가 없어 저장할 수 없습니다.');
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const ext = input.ext ?? 'jpg';
      const contentType = input.contentType ?? EXT_TYPE[ext] ?? 'image/jpeg';
      const blob = await toBlob(input.body);
      // 경로 = {clinic_id}/{customer_id}/{uuid}.{ext} (clinic-path RLS 미러)
      const path = `${clinicId}/${customerId}/${uuid()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType, upsert: false });
      if (upErr) throw upErr;

      const { data: userData } = await supabase.auth.getUser();
      const uploadedBy = userData?.user?.id ?? null;

      const { error: insErr } = await supabase.from('treatment_photos').insert({
        customer_id: customerId,
        check_in_id: input.checkInId ?? null,
        clinic_id: clinicId,
        photo_url: path,
        photo_type: input.photoType ?? 'progress',
        body_part: input.bodyPart ?? null,
        treatment_name: input.treatmentName ?? null,
        session_no: input.sessionNo ?? null,
        note: input.note ?? null,
        file_size_bytes: blob.size,
        original_filename: input.originalFilename ?? null,
        uploaded_by: uploadedBy,
        source: 'staff_capture',
        photo_category: input.photoCategory ?? null,
      });
      if (insErr) {
        // 롤백: insert 실패 시 방금 올린 object 정리(고아 방지). 이건 아직 미확정 신규 object 라 물리제거 허용.
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        throw insErr;
      }
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '사진 저장에 실패했습니다.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [customerId, clinicId, load]);

  /**
   * soft-delete — deleted_at 만 set. Storage object 는 보존(의료법 §22).
   * 물리 DELETE / storage.remove() 를 여기서 절대 호출하지 않는다.
   */
  const softDelete = useCallback(async (photoId: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const { error: upErr } = await supabase
        .from('treatment_photos')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', photoId)
        .is('deleted_at', null);
      if (upErr) throw upErr;
      // 낙관적 갱신
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '사진 삭제에 실패했습니다.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { photos, loading, error, busy, reload: load, capture, softDelete };
}
