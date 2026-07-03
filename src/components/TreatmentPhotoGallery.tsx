/**
 * TreatmentPhotoGallery — 직원촬영 임상사진 모아보기 + 촬영/삭제 (태블릿 UX).
 *
 * T-20260703-foot-STAFFPHOTO-CHART-LINK.
 *
 * 느슨 결합(placement_pending): 진료차트 '사진' 탭 기본 배치이나, customerId/clinicId/checkInId
 *   props 만 받으므로 총괄 배치 컨펌 후 어느 위치에도 드롭인 가능. 부모(진료차트 drawer) 미수정.
 *
 * 원칙:
 *   · private 'treatment-photos' 버킷 → signed URL 로만 렌더(useTreatmentPhotos 내부 처리).
 *   · 날짜별 그룹 + 최신순.
 *   · 삭제 = soft-delete (deleted_at). 물리 삭제 안 함.
 *   · teal-emerald / 한국어 / 큰 버튼(갤탭).
 */
import { useMemo, useRef, useState } from 'react';
import { Camera, Trash2, ImageOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { useTreatmentPhotos, type TreatmentPhotoWithUrl } from '@/hooks/useTreatmentPhotos';

interface Props {
  customerId: string | null;
  clinicId: string | null;
  /** 현재 접수(방문)와 결속. 없으면 사진은 고객에만 결속(check_in_id NULL). */
  checkInId?: string | null;
  /** 읽기전용 모드(예: 원장 조회 뷰) — 촬영/삭제 버튼 숨김 */
  readOnly?: boolean;
}

function fmtDateKey(iso: string): string {
  // Asia/Seoul 기준 날짜 그룹 키
  return new Date(iso).toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TreatmentPhotoGallery({ customerId, clinicId, checkInId = null, readOnly = false }: Props) {
  const { photos, loading, error, busy, capture, softDelete } = useTreatmentPhotos(customerId, clinicId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<TreatmentPhotoWithUrl | null>(null);

  // 날짜별 그룹(최신순 — photos 자체가 created_at DESC)
  const groups = useMemo(() => {
    const map = new Map<string, TreatmentPhotoWithUrl[]>();
    for (const p of photos) {
      const key = fmtDateKey(p.created_at);
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [photos]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 같은 파일 재선택 허용
    if (!files.length) return;
    let ok = 0;
    for (const f of files) {
      const extRaw = (f.name.split('.').pop() ?? 'jpg').toLowerCase();
      const ext = (['jpg', 'jpeg', 'png', 'webp'].includes(extRaw) ? extRaw : 'jpg') as
        'jpg' | 'jpeg' | 'png' | 'webp';
      const done = await capture({
        body: f,
        ext,
        contentType: f.type || undefined,
        originalFilename: f.name,
        checkInId,
      });
      if (done) ok += 1;
    }
    if (ok > 0) toast.confirm(`사진 ${ok}장을 저장했습니다.`);
    else toast.error('사진 저장에 실패했습니다.');
  };

  const onDelete = async (p: TreatmentPhotoWithUrl) => {
    if (!window.confirm('이 사진을 삭제할까요? (기록은 보존됩니다)')) return;
    const done = await softDelete(p.id);
    if (done) { toast.confirm('사진을 삭제했습니다.'); if (preview?.id === p.id) setPreview(null); }
    else toast.error('삭제에 실패했습니다.');
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 헤더 / 촬영 버튼 */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-700">
          임상사진
          {photos.length > 0 && (
            <span className="ml-1 font-normal text-teal-600">{photos.length}장</span>
          )}
        </div>
        {!readOnly && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={onPick}
            />
            <Button
              type="button"
              size="lg"
              className="gap-2 bg-teal-600 hover:bg-teal-700"
              disabled={busy || !customerId || !clinicId}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Camera />}
              사진 촬영
            </Button>
          </>
        )}
      </div>

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
          <Loader2 className="animate-spin" /> 불러오는 중…
        </div>
      ) : photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-400">
          <ImageOff className="size-8" />
          <span className="text-sm">등록된 임상사진이 없습니다.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(([dateKey, items]) => (
            <div key={dateKey} className="flex flex-col gap-2">
              <div className="text-xs font-medium text-slate-500">{dateKey}</div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {items.map((p) => (
                  <div
                    key={p.id}
                    className="group/photo relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                  >
                    {p.signedUrl ? (
                      <img
                        src={p.signedUrl}
                        alt={p.original_filename ?? '임상사진'}
                        className="size-full cursor-pointer object-cover"
                        onClick={() => setPreview(p)}
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-slate-300">
                        <ImageOff />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-black/40 px-1.5 py-0.5 text-[10px] text-white">
                      {fmtTime(p.created_at)}
                    </div>
                    {!readOnly && (
                      <Button
                        type="button"
                        size="icon"
                        variant="destructive"
                        className="absolute right-1 top-1 opacity-0 transition-opacity group-hover/photo:opacity-100"
                        disabled={busy}
                        onClick={() => onDelete(p)}
                        aria-label="사진 삭제"
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 확대 미리보기 */}
      {preview?.signedUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreview(null)}
        >
          <img
            src={preview.signedUrl}
            alt={preview.original_filename ?? '임상사진'}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}

export default TreatmentPhotoGallery;
