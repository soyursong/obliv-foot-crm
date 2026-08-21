// CustomerProgressResultImages.tsx — 고객차트 > 경과분석 섹션: 연결된 결과 이미지 표시(§4 step 3)
// Ticket: T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE (Phase-2 §4)
//   경과분석 배치 업로드(ProgressResultBulkUploadDialog)로 첨부·슬립 결속된 결과 이미지를
//   해당 환자의 고객차트 경과분석 섹션에서 조회(read-only). 활성행(deleted_at IS NULL)만 노출.
//   버킷 = progress-results(private) → createSignedUrl(TTL). RLS = clinic-gate + admin/manager.
//   §6 노쇼 자동폐기(soft-delete)된 이미지는 RLS(pri_deleted_rows_admin_only) + deleted_at 필터로 미노출.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, ImageOff } from 'lucide-react';

interface ResultImageRow {
  id: string;
  image_url: string; // storage path
  file_name: string | null;
  visit_date: string | null;
  match_status: string | null;
  signedUrl?: string | null;
}

const SIGNED_TTL = 60 * 30; // 30분

interface Props {
  customerId: string;
}

export default function CustomerProgressResultImages({ customerId }: Props) {
  const [rows, setRows] = useState<ResultImageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      // 활성행만(deleted_at IS NULL) — 노쇼 자동폐기(§6) soft-delete 이미지는 belt 로 제외.
      const { data, error } = await supabase
        .from('progress_result_images')
        .select('id, image_url, file_name, visit_date, match_status, deleted_at')
        .eq('customer_id', customerId)
        .is('deleted_at', null)
        .order('visit_date', { ascending: false });
      if (error) throw error;
      const base = ((data ?? []) as Array<ResultImageRow & { deleted_at: string | null }>).map((r) => ({
        id: r.id,
        image_url: r.image_url,
        file_name: r.file_name,
        visit_date: r.visit_date,
        match_status: r.match_status,
      }));
      // 서명 URL 발급(private 버킷).
      const withUrls = await Promise.all(
        base.map(async (r) => {
          try {
            const { data: sig } = await supabase.storage
              .from('progress-results')
              .createSignedUrl(r.image_url, SIGNED_TTL);
            return { ...r, signedUrl: sig?.signedUrl ?? null };
          } catch {
            return { ...r, signedUrl: null };
          }
        }),
      );
      setRows(withUrls);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 py-2 text-[11px] text-muted-foreground" data-testid="progress-result-images-loading">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 경과분석 결과 불러오는 중…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-1.5 py-2 text-[11px] text-muted-foreground" data-testid="progress-result-images-empty">
        <ImageOff className="h-3.5 w-3.5" /> 연결된 경과분석 결과 이미지가 없습니다.
      </div>
    );
  }

  return (
    <div data-testid="progress-result-images">
      <div className="mb-2 text-[11px] font-semibold text-slate-700">경과분석 결과 이미지 ({rows.length}장)</div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {rows.map((r) => (
          <div key={r.id} className="overflow-hidden rounded-md border" data-testid="progress-result-image-item">
            {r.signedUrl ? (
              <a href={r.signedUrl} target="_blank" rel="noreferrer">
                <img
                  src={r.signedUrl}
                  alt={r.file_name ?? '경과분석 결과'}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              </a>
            ) : (
              <div className="flex aspect-square w-full items-center justify-center bg-neutral-100 text-[11px] text-muted-foreground">
                미리보기 불가
              </div>
            )}
            <div className="truncate px-1 py-0.5 text-[10px] text-muted-foreground" title={r.file_name ?? ''}>
              {r.visit_date ?? '-'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
