/**
 * InsuranceDocPanel — 풋센터 서류 업로드 패널
 *
 * T-20260506-foot-CHART-SIMPLE-REVAMP: 5/4 22:04 요청 반영
 * T-20260510-foot-C21-IMG-PROGRESS: 경과내역 사진 (2번차트 연동) 섹션 추가
 * T-20260509-foot-CHART1-LAYOUT-REAPPLY: 경과분석지 전폭, 진료비 영수증 → DocumentPrintPanel 이동
 *
 * T-20260517-foot-C2-TAB-SYNC: 연동 재정비
 * - 경과분석지: Storage `customer/{id}/progress` SSOT (2번차트 경과내역 탭과 동일 원천)
 * - KOH 균검사: Storage `customer/{id}/koh-results` SSOT (2번차트 검사결과 탭과 동일 원천)
 * - 경과내역 사진 섹션 제거 (경과분석지로 통합)
 *
 * 섹션 구성:
 * 1) 경과분석지   — Storage 'customer/{id}/progress' (2번차트 경과내역 탭과 SSOT 공유)
 * 2) KOH 균검사   — Storage 'customer/{id}/koh-results' (2번차트 검사결과 탭과 SSOT 공유)
 */

import { useCallback, useEffect, useState } from 'react';
import { FileText, FlaskConical, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { CheckIn } from '@/lib/types';

// ─── 타입 ───

interface StorageItem {
  path: string;
  signedUrl: string;
  name: string;
}

interface Props {
  checkIn: CheckIn;
  onUpdated: () => void;
}

// ─── 내부 Storage 섹션 컴포넌트 ───

function InsDocStorageSection({
  customerId,
  prefix,
  label,
  accentColor,
}: {
  customerId: string;
  prefix: string;
  label: string;
  accentColor: 'teal' | 'orange' | 'purple';
}) {
  const [images, setImages] = useState<StorageItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const storagePath = `customer/${customerId}/${prefix}`;

  const accentMap = {
    teal:   { icon: 'text-teal-600',   btn: 'text-teal-700 border-teal-200 hover:bg-teal-50',   empty: 'text-muted-foreground' },
    orange: { icon: 'text-orange-600', btn: 'text-orange-700 border-orange-200 hover:bg-orange-50', empty: 'text-muted-foreground' },
    purple: { icon: 'text-purple-600', btn: 'text-purple-700 border-purple-200 hover:bg-purple-50', empty: 'text-muted-foreground' },
  };
  const ac = accentMap[accentColor];

  const load = useCallback(async () => {
    const { data: files } = await supabase.storage.from('photos').list(storagePath, {
      limit: 50,
      sortBy: { column: 'name', order: 'desc' },
    });
    if (!files || files.length === 0) { setImages([]); return; }
    const withUrls = await Promise.all(
      files
        .filter((f) => f.name && !f.id?.endsWith('/'))
        .map(async (file) => {
          const path = `${storagePath}/${file.name}`;
          const { data } = await supabase.storage.from('photos').createSignedUrl(path, 3600);
          return { path, signedUrl: data?.signedUrl ?? '', name: file.name };
        }),
    );
    setImages(withUrls.filter((i) => i.signedUrl));
  }, [storagePath]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${storagePath}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const { error } = await supabase.storage.from('photos').upload(path, file, { contentType: file.type });
      if (error) toast.error(`업로드 실패: ${error.message}`);
    }
    setUploading(false);
    e.target.value = '';
    await load();
  };

  const remove = async (item: StorageItem) => {
    if (!window.confirm('삭제하시겠습니까?')) return;
    await supabase.storage.from('photos').remove([item.path]);
    await load();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
          {accentColor === 'purple'
            ? <FlaskConical className={`h-3 w-3 ${ac.icon}`} />
            : <FileText className={`h-3 w-3 ${ac.icon}`} />}
          {label}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] text-teal-600">1번↔2번차트 쌍방연동</span>
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".pdf,image/*"
              multiple
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
            <span className={`inline-flex items-center gap-1 text-xs border rounded px-2 py-0.5 bg-white cursor-pointer transition ${ac.btn}`}>
              <Upload className="h-3 w-3" />
              {uploading ? '중…' : '업로드'}
            </span>
          </label>
        </span>
      </div>

      {images.length === 0 ? (
        <div className="rounded-lg border border-dashed py-3 text-center text-xs text-muted-foreground">
          등록된 {label} 없음
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {images.map((img) => (
            <div key={img.path} className="relative group aspect-square">
              <img
                src={img.signedUrl}
                alt={img.name}
                className="w-full h-full object-cover rounded-lg border cursor-pointer"
                onClick={() => window.open(img.signedUrl, '_blank')}
              />
              <button
                onClick={() => remove(img)}
                className="absolute top-1 right-1 hidden group-hover:flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow"
                title="삭제"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 메인 컴포넌트 ───

export function InsuranceDocPanel({ checkIn }: Props) {
  if (!checkIn.customer_id) return null;

  return (
    <div className="space-y-4">

      {/* ── 1. 경과분석지 — T-20260517-foot-C2-TAB-SYNC: Storage 'progress' SSOT (2번차트 경과내역 탭 연동) ── */}
      <InsDocStorageSection
        customerId={checkIn.customer_id}
        prefix="progress"
        label="경과분석지"
        accentColor="teal"
      />

      {/* ── 2. KOH 균검사 — T-20260517-foot-C2-TAB-SYNC: Storage 'koh-results' SSOT (2번차트 검사결과 탭 연동) ── */}
      <InsDocStorageSection
        customerId={checkIn.customer_id}
        prefix="koh-results"
        label="KOH 균검사"
        accentColor="purple"
      />

    </div>
  );
}
