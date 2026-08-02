/**
 * PenChartAttachPanel — 펜차트(보험차트) 사진 첨부 (Storage-only, DB row 0)
 *
 * T-20260731-foot-PENCHART-PHOTO-ATTACH
 *   DA delta-CONSULT-REPLY 정본 = (b') 순수 co-located Storage 경로 컨벤션. db_change=FALSE.
 *   신규 첨부 DB 테이블(a')은 REJECT(부모 row 부재 → orphan 생성기·권위분열) → 여기엔 어떤 INSERT/DDL 도 없다.
 *
 * AC0(B안, 2026-07-31 김주연 총괄 확정) = **작성 중 첨부**:
 *   '새 펜차트 작성' 창에서 stem 선(先)발번(stem-pre-binding) 후, 작성과 동시에 사진 첨부.
 *   → 이 패널은 stem 만 props 로 받으므로 (a)작성 중(draw, pre-bound stem) (b)저장본 재조회(list, 저장 파일 stem)
 *     양쪽에서 동일하게 재사용된다.
 *
 * 경로 pin (DA 그대로 준수):
 *   photos 버킷 · customer/{customerId}/pen-chart-attach/{stem}/{uuid}.{ext}
 *   · key = 펜차트 **full stem `{ts}_{rand}`**(파일명에서 확장자만 제거, prefix 포함) → 특정 펜차트에 collision-safe 결속
 *   · sibling prefix 'pen-chart-attach/' **필수** — 'pen-chart/' 하위 nesting 금지.
 *     (loadSavedCharts 의 'pen-chart/' 레벨 storage.list() 가 하위폴더를 chart PNG 로 오인·목록오염 방지)
 *   · 재조회 = storage.list('customer/{id}/pen-chart-attach/{stem}') · 확장자 보존 · created_at 정렬(DB sort_order 불요)
 *
 * 버킷/RLS/PHI:
 *   · 버킷 = 'photos'(펜차트 PNG 가 이미 사는 private 버킷, 인증직원 직접 업로드). foot-health-q-photos(anon-write) 재사용 금지.
 *   · RLS = 인증직원·customer/{id} 경로 스코프 → 기존 storage RLS 를 새 pen-chart-attach/ prefix 가 그대로 상속(새 정책 신설 0).
 *   · photos 버킷 public=false (2026-07-31 실측 확인) → read = signed URL(펜차트 PNG 현 렌더 경로와 동일, 신규 EF 0).
 *
 * orphan:
 *   · 첨부는 customer/{id}/ 고객 prefix 하위 co-located → 고객 삭제/보존 sweep 이 자동 커버(새 orphan 클래스 0).
 *   · 펜차트 PNG 삭제 시 첨부 prefix 도 함께 정리 → PenChartTab.handleDelete 의 app-side cascade 로 처리.
 *   · 작성 중 첨부 후 미저장(창 닫기) orphan = 기존 pen-chart orphan TTL sweep 패턴 편입(AC3).
 *
 * 느슨 결합: customerId/stem 만 props 로 받는다(UI 비의존).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Trash2, UploadCloud } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { signedThumbUrls, signedOriginalUrl, PHOTO_UPLOAD_OPTS, invalidatePhotoPath } from '@/lib/photoUrl';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

const BUCKET = 'photos';
/** 펜차트 stem 하위 sibling prefix — pen-chart/ 하위 nesting 금지(목록오염 방지). */
const ATTACH_SUBDIR = 'pen-chart-attach';
/** 첨부 파일 개당 상한(과대 업로드 방지). photos 버킷은 PHI·Egress 관리 대상 → 보수적. */
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

/** 펜차트 첨부 storage prefix 헬퍼 — 소비처(cascade cleanup)에서도 동일 규칙 재사용. */
export function penChartAttachPrefix(customerId: string, stem: string): string {
  return `customer/${customerId}/${ATTACH_SUBDIR}/${stem}`;
}

/** 저장 파일명 → full stem (마지막 확장자만 제거, prefix hq_/rc_/pc_ 등 보존). */
export function stemFromChartName(name: string): string {
  return (name ?? '').replace(/\.[^./]+$/, '');
}

/** RFC4122 uuid (crypto.randomUUID 폴백 — 구형 태블릿 웹뷰 방어; useTreatmentPhotos 와 동일 규약). */
function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor((c?.getRandomValues?.(new Uint8Array(1))?.[0] ?? 0) / 16) || 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 확장자 추출(보존). 파일명 우선, 없으면 MIME 폴백. 소문자 정규화. */
function extOf(file: File): string {
  const m = file.name.match(/\.([a-zA-Z0-9]+)$/);
  if (m) return m[1].toLowerCase();
  const sub = file.type.split('/')[1];
  if (sub) return (sub === 'jpeg' ? 'jpg' : sub).toLowerCase();
  return 'jpg';
}

interface Attachment {
  name: string;
  path: string;
  thumbUrl: string;
  url: string;
  createdAt: string;
}

export function PenChartAttachPanel({
  customerId,
  stem,
}: {
  customerId: string;
  stem: string;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const aliveRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // AC1: 갤러리(파일) 선택 + 카메라 직접 촬영 둘 다 지원 → 카메라 전용 input 분리(capture).
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const prefix = penChartAttachPrefix(customerId, stem);

  const load = useCallback(async () => {
    if (!customerId || !stem) { setItems([]); return; }
    setLoading(true);
    try {
      const { data: files } = await supabase.storage
        .from(BUCKET)
        // created_at 정렬(오래된→최신). DB sort_order 불요.
        .list(prefix, { limit: 100, sortBy: { column: 'created_at', order: 'asc' } });
      // 폴더/placeholder 제외 — 실제 객체만(확장자 보존된 파일).
      const objs = (files ?? []).filter((f) => f.name && !f.name.endsWith('/') && f.id);
      if (objs.length === 0) { if (aliveRef.current) setItems([]); return; }
      const paths = objs.map((f) => `${prefix}/${f.name}`);
      const [thumbs, originals] = await Promise.all([
        signedThumbUrls(BUCKET, paths, { width: 320, quality: 60, resize: 'contain' }),
        Promise.all(paths.map((p) => signedOriginalUrl(BUCKET, p))),
      ]);
      const next: Attachment[] = objs.map((f, i) => ({
        name: f.name,
        path: paths[i],
        thumbUrl: thumbs[i] ?? originals[i] ?? '',
        url: originals[i] ?? '',
        createdAt: (f.created_at as string | undefined) ?? '',
      }));
      if (aliveRef.current) setItems(next.filter((a) => a.thumbUrl || a.url));
    } catch (e) {
      if (aliveRef.current) toast.error(`첨부 사진을 불러오지 못했습니다: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [customerId, stem, prefix]);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => { aliveRef.current = false; };
  }, [load]);

  const uploadFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    if (!stem) { toast.error('첨부 대상을 확인할 수 없습니다. 창을 새로고침 후 다시 시도해주세요.'); return; }
    // 이미지만 허용(확장자/MIME). PHI 버킷에 임의 파일 유입 차단.
    const images = files.filter((f) => f.type.startsWith('image/'));
    const rejectedType = files.length - images.length;
    const tooBig = images.filter((f) => f.size > MAX_FILE_BYTES);
    const ok = images.filter((f) => f.size <= MAX_FILE_BYTES);
    if (rejectedType > 0) toast.warning(`이미지 파일만 첨부할 수 있어요 (${rejectedType}개 제외).`);
    if (tooBig.length > 0) toast.warning(`20MB 초과 파일은 제외했어요 (${tooBig.length}개).`);
    if (ok.length === 0) return;

    setUploading(true);
    let success = 0;
    try {
      for (const file of ok) {
        const ext = extOf(file);
        // 경로 pin: customer/{id}/pen-chart-attach/{stem}/{uuid}.{ext} · 확장자 보존.
        const path = `${prefix}/${uuid()}.${ext}`;
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, {
            contentType: file.type || 'application/octet-stream',
            upsert: false, // uuid 파일명 → 충돌 없음
            ...PHOTO_UPLOAD_OPTS,
          });
        if (error) {
          toast.error(`"${file.name}" 첨부 실패: ${error.message}`);
        } else {
          success += 1;
        }
      }
      if (success > 0) await load();
    } finally {
      if (aliveRef.current) setUploading(false);
    }
  }, [prefix, stem, load]);

  const handleDelete = useCallback(async (att: Attachment) => {
    if (!window.confirm('첨부한 사진을 삭제하시겠습니까?')) return;
    const { error } = await supabase.storage.from(BUCKET).remove([att.path]);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    invalidatePhotoPath(BUCKET, att.path);
    setItems((prev) => prev.filter((a) => a.path !== att.path));
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) void uploadFiles(e.dataTransfer.files);
  }, [uploadFiles]);

  return (
    <div className="mt-3 border-t pt-3" data-testid="penchart-attach-panel">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-neutral-700">
        <ImagePlus className="h-3.5 w-3.5" />
        사진 첨부
        {items.length > 0 && (
          <span className="rounded-full bg-neutral-100 px-1.5 text-[10px] text-neutral-600">{items.length}</span>
        )}
      </div>

      {/* AC1: 업로드 영역 — 파일 선택(갤러리) + 드래그&드롭 (foot 태블릿 '큰 버튼' 원칙) */}
      <div
        data-testid="penchart-attach-dropzone"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-5 text-center cursor-pointer transition-colors',
          dragOver ? 'border-teal-400 bg-teal-50' : 'border-neutral-300 bg-neutral-50 hover:border-teal-300',
          uploading && 'pointer-events-none opacity-60',
        )}
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
        ) : (
          <UploadCloud className="h-5 w-5 text-neutral-400" />
        )}
        <span className="text-[11px] text-neutral-600">
          {uploading ? '업로드 중…' : '사진을 여기로 끌어다 놓거나 눌러서 선택'}
        </span>
        <span className="text-[10px] text-neutral-400">이미지 파일 · 개당 최대 20MB · 장수 제한 없음</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          data-testid="penchart-attach-input"
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
            e.target.value = ''; // 동일 파일 재선택 허용
          }}
        />
      </div>

      {/* AC1: 카메라 직접 촬영 — 갤러리와 별도 입력(capture=environment). 태블릿/모바일 촬영 동선. */}
      <button
        type="button"
        data-testid="penchart-attach-camera-btn"
        onClick={() => cameraInputRef.current?.click()}
        disabled={uploading}
        className={cn(
          'mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-teal-300 bg-white px-3 py-2.5 text-[12px] font-medium text-teal-700 transition-colors hover:bg-teal-50',
          uploading && 'pointer-events-none opacity-60',
        )}
      >
        <Camera className="h-4 w-4" />
        카메라로 촬영
      </button>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="penchart-attach-camera-input"
        onChange={(e) => {
          if (e.target.files?.length) void uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* 첨부 목록 (썸네일 그리드) */}
      {loading ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-neutral-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 불러오는 중…
        </div>
      ) : items.length > 0 ? (
        <div className="mt-2 grid grid-cols-3 gap-2" data-testid="penchart-attach-grid">
          {items.map((att) => (
            <div key={att.path} className="relative rounded border border-neutral-200 overflow-hidden group">
              <a href={att.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                <img
                  crossOrigin="anonymous"
                  src={att.thumbUrl}
                  alt="첨부 사진"
                  loading="lazy"
                  className="w-full object-cover"
                  style={{ height: 90 }}
                />
              </a>
              <button
                onClick={(e) => { e.stopPropagation(); void handleDelete(att); }}
                className="absolute top-1 right-1 rounded-full bg-black/55 p-1 text-red-200 hover:text-red-100"
                title="사진 삭제"
                data-testid={`penchart-attach-delete-${att.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
