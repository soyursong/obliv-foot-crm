/**
 * FirstVisitFootPhotoSlots — 초진 관리기록지 작성 화면 발 사진 2슬롯(오른발/왼발).
 *
 * T-20260731-foot-FIRSTVISIT-MGMTRECORD-PHOTO-2SLOT-LR.
 *
 * 설계 근거(DA CONSULT-REPLY MSG-20260731-175752-j08x — Option A GO):
 *   · 저장 = canonical treatment_photos 테이블 재사용(신규 테이블 금지). 진짜 부모 grain = check_in.
 *   · 판별자 source='first_visit_mgmt_record' (형제폼 격리) + foot_side(오른발=R/왼발=L, 대문자 canonical).
 *   · 버킷 'treatment-photos'(private) 상속. 경로 {clinic_id}/{customer_id}/{uuid}.{ext}. 서빙=RLS-gated signed URL.
 *   · 재조회 = treatment_photos WHERE check_in_id=? AND source='first_visit_mgmt_record' AND deleted_at IS NULL.
 *   · 슬롯당 1장(DB partial unique 강제). 교체 = 기존 soft-delete 후 신규 insert. 삭제 = soft-delete(의료법 §22).
 *
 * DA pin(swap 금지): 오른발=Right='R' / 왼발=Left='L'. 대문자 L/R 고정.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Trash2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';

const BUCKET = 'treatment-photos';
const SOURCE = 'first_visit_mgmt_record';
const SIGNED_URL_TTL = 60 * 30; // 30분
const MAX_BYTES = 15 * 1024 * 1024; // 15MB

// DA pin: 오른발=Right=R / 왼발=Left=L (swap 금지, 대문자 canonical)
type FootSide = 'R' | 'L';
const FOOT_SLOTS: ReadonlyArray<{ side: FootSide; ko: string }> = [
  { side: 'R', ko: '오른발' },
  { side: 'L', ko: '왼발' },
];

const EXT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function extFromType(type: string): string {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor((c?.getRandomValues?.(new Uint8Array(1))?.[0] ?? 0) / 16) || 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface SlotRow {
  id: string;
  photo_url: string;
  storage_bucket: string | null;
  signedUrl: string | null;
}

interface Props {
  checkInId: string;
  customerId: string;
  clinicId: string;
}

export function FirstVisitFootPhotoSlots({ checkInId, customerId, clinicId }: Props) {
  // slot 상태: foot_side → 저장된 행(+signed URL)
  const [slots, setSlots] = useState<Record<FootSide, SlotRow | null>>({ R: null, L: null });
  const [loading, setLoading] = useState(false);
  const [busySide, setBusySide] = useState<FootSide | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    if (!checkInId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('treatment_photos')
        .select('id, photo_url, storage_bucket, foot_side')
        .eq('check_in_id', checkInId)
        .eq('source', SOURCE)
        .is('deleted_at', null)
        .in('foot_side', ['R', 'L'])
        .order('created_at', { ascending: false });
      if (error) throw error;

      const next: Record<FootSide, SlotRow | null> = { R: null, L: null };
      for (const r of (data ?? []) as Array<{
        id: string; photo_url: string; storage_bucket: string | null; foot_side: FootSide;
      }>) {
        // partial unique(check_in_id, source, foot_side) 로 슬롯당 1장 보장 — 방어적으로 첫 행만 채택
        if (r.foot_side === 'R' || r.foot_side === 'L') {
          if (!next[r.foot_side]) {
            const { data: signed } = await supabase.storage
              .from(r.storage_bucket ?? BUCKET)
              .createSignedUrl(r.photo_url, SIGNED_URL_TTL);
            next[r.foot_side] = {
              id: r.id, photo_url: r.photo_url, storage_bucket: r.storage_bucket,
              signedUrl: signed?.signedUrl ?? null,
            };
          }
        }
      }
      if (aliveRef.current) setSlots(next);
    } catch {
      if (aliveRef.current) toast.error('발 사진을 불러오지 못했습니다.');
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [checkInId]);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => { aliveRef.current = false; };
  }, [load]);

  const upload = useCallback(async (side: FootSide, files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 첨부할 수 있습니다.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('사진 용량이 너무 큽니다. (최대 15MB)');
      return;
    }
    if (!customerId || !clinicId || !checkInId) {
      toast.error('고객/방문 정보가 없어 저장할 수 없습니다.');
      return;
    }

    setBusySide(side);
    const ext = extFromType(file.type);
    const contentType = EXT_TYPE[ext] ?? 'image/jpeg';
    const path = `${clinicId}/${customerId}/${uuid()}.${ext}`;
    const prev = slots[side];

    try {
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType, upsert: false });
      if (upErr) throw upErr;

      const { data: userData } = await supabase.auth.getUser();
      const uploadedBy = userData?.user?.id ?? null;

      // 교체(같은 슬롯 기존 사진): 신규 insert 전 기존 행 soft-delete → partial unique 충돌 방지.
      if (prev) {
        const { error: delErr } = await supabase
          .from('treatment_photos')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', prev.id)
          .is('deleted_at', null);
        if (delErr) throw delErr;
      }

      const { error: insErr } = await supabase.from('treatment_photos').insert({
        customer_id: customerId,
        check_in_id: checkInId,
        clinic_id: clinicId,
        photo_url: path,
        photo_type: 'progress',
        source: SOURCE,
        foot_side: side,
        file_size_bytes: file.size,
        original_filename: file.name,
        uploaded_by: uploadedBy,
      });
      if (insErr) {
        // 롤백: 방금 올린 미확정 object 정리(고아 방지). soft-delete 한 prev 는 복원 시도 안 함(다음 load 로 정합).
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        throw insErr;
      }
      await load();
      toast.success(`${side === 'R' ? '오른발' : '왼발'} 사진이 저장되었습니다.`);
    } catch {
      toast.error('사진 저장에 실패했습니다.');
    } finally {
      if (aliveRef.current) setBusySide(null);
    }
  }, [slots, customerId, clinicId, checkInId, load]);

  const remove = useCallback(async (side: FootSide) => {
    const row = slots[side];
    if (!row) return;
    setBusySide(side);
    try {
      const { error } = await supabase
        .from('treatment_photos')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', row.id)
        .is('deleted_at', null);
      if (error) throw error;
      setSlots((s) => ({ ...s, [side]: null }));
    } catch {
      toast.error('사진 삭제에 실패했습니다.');
    } finally {
      if (aliveRef.current) setBusySide(null);
    }
  }, [slots]);

  return (
    <div className="space-y-2" data-testid="fvmr-foot-photo-section">
      <p className="text-xs font-semibold text-sky-800">발 사진 첨부</p>
      <p className="text-[11px] text-gray-400">오른발 · 왼발을 각각 한 장씩 첨부할 수 있습니다.</p>
      <div className="grid grid-cols-2 gap-3">
        {FOOT_SLOTS.map((slot) => {
          const row = slots[slot.side];
          const busy = busySide === slot.side;
          return (
            <div key={slot.side} className="space-y-1.5" data-testid={`fvmr-foot-slot-${slot.side}`}>
              <div className="text-xs font-medium text-gray-600">{slot.ko}</div>
              {row?.signedUrl ? (
                <div className="relative overflow-hidden rounded-lg border border-teal-100">
                  <img
                    src={row.signedUrl}
                    alt={slot.ko}
                    className="aspect-square w-full object-cover"
                    data-testid={`fvmr-foot-thumb-${slot.side}`}
                  />
                  <button
                    type="button"
                    onClick={() => remove(slot.side)}
                    disabled={busy}
                    aria-label={`${slot.ko} 사진 삭제`}
                    data-testid={`fvmr-foot-remove-${slot.side}`}
                    className="absolute right-1 top-1 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  {/* 교체 업로드 (썸네일 위 재선택) */}
                  <label className="absolute bottom-1 right-1 cursor-pointer rounded-md bg-teal-600/90 px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-700">
                    변경
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={busy}
                      data-testid={`fvmr-foot-input-${slot.side}`}
                      onChange={(e) => { upload(slot.side, e.target.files); e.currentTarget.value = ''; }}
                    />
                  </label>
                </div>
              ) : (
                <label
                  className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-teal-200 bg-teal-50/40 text-teal-600 hover:bg-teal-50 min-h-[96px]"
                  data-testid={`fvmr-foot-drop-${slot.side}`}
                >
                  {busy || (loading && !row) ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <>
                      <Camera className="h-6 w-6" />
                      <span className="text-xs font-medium">사진 추가</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={busy}
                    data-testid={`fvmr-foot-input-${slot.side}`}
                    onChange={(e) => { upload(slot.side, e.target.files); e.currentTarget.value = ''; }}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default FirstVisitFootPhotoSlots;
