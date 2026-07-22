// T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD — 일마감 '영수증 수납' 하위탭
// ──────────────────────────────────────────────────────────────
// [결제내역] → 3번째 하위탭([레드페이] 우측 sibling). OCR 영수증 첨부 수납의
// 5컬럼 대조 그리드 + row-click read-only 「카드 영수증」 뷰 모달.
//
// 데이터 소스: read-only VIEW public.v_receipt_settlement_daily (DA[4] 확정).
//   FE 조인·FE 매칭 재계산 금지 — 이 뷰만 소비(매처 진실원천 이중화 방지).
//   매칭 SSOT = redpay-reconcile EF(4-Tier). 뷰는 매처 산출(matched_payment_id/
//   reconciled_at/recon_log)을 surface only. security_invoker=true → 호출자 clinic RLS.
//
// 5컬럼(LOCKED):
//   ① 날짜/시간   = receipt_datetime(영수증 인쇄값, 95y7 SSOT). uploaded_at(업로드시각) 아님.
//   ② 성함(차트번호) = customer_name (chart_number)
//   ③ 결제금액    = amount (확정 SSOT)
//   ④ 승인번호    = approval_no (매칭 핵심키)
//   ⑤ 원본 영수증 = [이미지 보기] → read-only 뷰 모달(편집필드 無, 인쇄/닫기)
//
// ⚠ 1c-b FUTURE 게이트: graceful-degrade 랜딩 필수(RedpayReconcileTab 선례).
//   go-live(secret flip) 前 DRY_RUN 에선 매칭 데이터 empty 가능 →
//   useQuery 에러 시 []폴백 + 빈상태 정상 렌더(하드쿼리/크래시 금지).
//   ⑤ [이미지 보기] 뷰 모달은 at-capture 검증·보정 팝업(ReceiptUpload)과 별개 표면 —
//   read-only 조회 전용(편집 필드 無, 인쇄/닫기만).
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, Loader2, Printer, X } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { formatAmount } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ── 타입 (v_receipt_settlement_daily surface) ──────────────────
type MatchStatus = 'matched' | 'unmatched';

interface ReceiptRow {
  payment_id: string;
  clinic_id: string;
  close_date: string;
  receipt_datetime: string | null;   // 컬럼① 인쇄시각(표시 SSOT)
  uploaded_at: string | null;        // 시스템 업로드시각(별개 축 — 표시 안 함)
  customer_name: string | null;      // 컬럼②
  chart_number: string | null;       // 컬럼②(차트번호)
  amount: number | null;             // 컬럼③
  approval_no: string | null;        // 컬럼④ 매칭 핵심키
  tid: string | null;
  image_url: string | null;          // 컬럼⑤ 원본 영수증
  reconciled_at: string | null;
  redpay_approved_at: string | null;
  redpay_amount: number | null;
  match_rule: string | null;
  match_status: MatchStatus;
}

// ── 매칭 배지 ───────────────────────────────────────────────────
const MATCH_META: Record<MatchStatus, { label: string; cls: string }> = {
  matched:   { label: '매칭',   cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  unmatched: { label: '미매칭', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
};

function kstDateTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: 'Asia/Seoul',
    });
  } catch { return '-'; }
}

// ── 영수증 이미지 URL 해석 (receipts 버킷 storage path → signed URL) ──
async function resolveReceiptUrl(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl) return null;
  // 이미 절대 URL 이면 그대로 사용
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  // storage path → signed URL (1h). 'receipts/' prefix 중복 제거.
  const path = imageUrl.replace(/^receipts\//, '');
  try {
    const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 3600);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

// ── read-only 「카드 영수증」 뷰 모달 (col⑤) ──────────────────────
//   at-capture 검증·보정 팝업(ReceiptUpload)과 별개 표면 — 조회 전용.
function ReceiptViewModal({ row, onClose }: { row: ReceiptRow; onClose: () => void }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgState, setImgState] = useState<'loading' | 'ok' | 'none'>('loading');

  useEffect(() => {
    let alive = true;
    setImgState('loading');
    resolveReceiptUrl(row.image_url).then((url) => {
      if (!alive) return;
      setImgUrl(url);
      setImgState(url ? 'ok' : 'none');
    });
    return () => { alive = false; };
  }, [row.image_url]);

  const handlePrint = () => {
    if (!imgUrl) { window.print(); return; }
    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w) return;
    w.document.write(
      `<html><head><title>카드 영수증</title></head>` +
      `<body style="margin:0;text-align:center;">` +
      `<img src="${imgUrl}" style="max-width:100%;" onload="window.print()" />` +
      `</body></html>`,
    );
    w.document.close();
  };

  const meta = MATCH_META[row.match_status];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="receipt-view-modal">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">카드 영수증</h2>
            <Badge variant="outline" className={cn('text-xs', meta.cls)}>{meta.label}</Badge>
          </div>

          {/* 조회 필드 (read-only — 편집 input 없음) */}
          <dl className="grid grid-cols-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">결제금액</dt>
            <dd className="col-span-2 text-right tabular-nums font-medium">
              {row.amount != null ? formatAmount(row.amount) : '-'}
            </dd>
            <dt className="text-muted-foreground">승인번호</dt>
            <dd className="col-span-2 text-right tabular-nums">{row.approval_no ?? '-'}</dd>
            <dt className="text-muted-foreground">결제일자</dt>
            <dd className="col-span-2 text-right tabular-nums">{kstDateTime(row.receipt_datetime)}</dd>
            <dt className="text-muted-foreground">성함</dt>
            <dd className="col-span-2 text-right">
              {row.customer_name ?? '-'}
              {row.chart_number ? <span className="text-muted-foreground"> ({row.chart_number})</span> : null}
            </dd>
          </dl>

          {/* 원본 영수증 이미지 */}
          <div className="rounded-lg border bg-muted/30 overflow-hidden min-h-[160px] flex items-center justify-center">
            {imgState === 'loading' && (
              <div className="py-10 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> 영수증 불러오는 중…
              </div>
            )}
            {imgState === 'none' && (
              <div className="py-10 text-sm text-muted-foreground text-center px-4">
                영수증 이미지를 불러올 수 없습니다.
                <div className="text-xs mt-1 opacity-70">원본 파일이 없거나 접근 권한이 없습니다.</div>
              </div>
            )}
            {imgState === 'ok' && imgUrl && (
              <img src={imgUrl} alt="카드 영수증" className="w-full object-contain max-h-[420px]" />
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={imgState !== 'ok'}>
              <Printer className="mr-1 h-4 w-4" /> 인쇄하기
            </Button>
            <Button variant="secondary" size="sm" onClick={onClose}>
              <X className="mr-1 h-4 w-4" /> 닫기
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── 컴포넌트 ───────────────────────────────────────────────────
export function ReceiptSettlementTab({ date, clinicId }: { date: string; clinicId: string }) {
  const qc = useQueryClient();
  const [viewRow, setViewRow] = useState<ReceiptRow | null>(null);

  // [영수증 수납] 뷰 (read-only) — FE 는 이 뷰만 소비.
  // ⚠ graceful-degrade(1c-b): 뷰 부재/DRY_RUN empty/에러 시 []폴백 → 빈상태 정상 렌더(무크래시).
  const { data: rows = [], isLoading } = useQuery<ReceiptRow[]>({
    queryKey: ['receipt-settlement', clinicId, date],
    enabled: !!clinicId,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('v_receipt_settlement_daily')
          .select('*')
          .eq('clinic_id', clinicId)
          .eq('close_date', date);
        if (error) {
          // 뷰 미존재/권한/DRY_RUN → 하드쿼리·크래시 금지, []폴백
          console.warn('[ReceiptSettlementTab] view query failed (graceful []):', error.message);
          return [];
        }
        return (data ?? []) as ReceiptRow[];
      } catch (e) {
        console.warn('[ReceiptSettlementTab] view query threw (graceful []):', e);
        return [];
      }
    },
  });

  // Realtime: OCR 영수증 수납 write 시 즉시 갱신 (payments)
  useEffect(() => {
    if (!clinicId) return;
    const channel = supabase.channel(`receipt-settlement-${clinicId}-${date}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'payments', filter: `clinic_id=eq.${clinicId}` },
        () => qc.invalidateQueries({ queryKey: ['receipt-settlement', clinicId, date] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clinicId, date, qc]);

  // 정렬: 인쇄시각 오름차순 (없으면 업로드시각)
  const sorted = [...rows].sort((a, b) => {
    const ta = a.receipt_datetime ?? a.uploaded_at ?? '';
    const tb = b.receipt_datetime ?? b.uploaded_at ?? '';
    return ta.localeCompare(tb);
  });

  const matchedCount = sorted.filter(r => r.match_status === 'matched').length;
  const unmatchedCount = sorted.length - matchedCount;

  return (
    <div className="space-y-4">
      {/* 요약 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">영수증 수납</div>
          <div className="tabular-nums font-semibold text-lg">{sorted.length}건</div>
        </div>
        <div className="rounded-lg border bg-emerald-50 border-emerald-200 p-3 text-center">
          <div className="text-xs text-emerald-700 mb-1">매칭</div>
          <div className="tabular-nums font-semibold text-lg text-emerald-700">{matchedCount}건</div>
        </div>
        <div className="rounded-lg border bg-amber-50 border-amber-200 p-3 text-center">
          <div className="text-xs text-amber-700 mb-1">미매칭</div>
          <div className="tabular-nums font-semibold text-lg text-amber-700">{unmatchedCount}건</div>
        </div>
      </div>

      {/* 5컬럼 대조 그리드 — read-only */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">영수증 수납 · 카드단말기 대조</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm" data-testid="receipt-settlement-grid">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 px-3 text-left font-medium w-32">날짜/시간</th>
                  <th className="py-2 px-2 text-left font-medium">성함(차트번호)</th>
                  <th className="py-2 px-2 text-right font-medium w-28">결제금액</th>
                  <th className="py-2 px-2 text-left font-medium w-28">승인번호</th>
                  <th className="py-2 px-2 text-center font-medium w-28">대조</th>
                  <th className="py-2 px-3 text-center font-medium w-28">원본 영수증</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">불러오는 중…</td></tr>
                )}
                {!isLoading && sorted.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      영수증 수납 내역이 없습니다.
                      <div className="text-xs mt-1 opacity-70">
                        영수증을 촬영·업로드하면 이 목록에 자동으로 쌓이고, 카드단말기 승인과 대조됩니다.
                      </div>
                    </td>
                  </tr>
                )}
                {sorted.map((r) => {
                  const meta = MATCH_META[r.match_status];
                  return (
                    <tr
                      key={r.payment_id}
                      className={cn(
                        'border-b transition-colors hover:bg-muted/40 cursor-pointer',
                        r.match_status !== 'matched' && 'bg-amber-50/40',
                      )}
                      onClick={() => setViewRow(r)}
                      title="클릭하면 원본 영수증 보기"
                    >
                      {/* ① 날짜/시간 = 인쇄시각(SSOT) */}
                      <td className="py-2 px-3 tabular-nums text-xs">{kstDateTime(r.receipt_datetime)}</td>
                      {/* ② 성함(차트번호) */}
                      <td className="py-2 px-2">
                        {r.customer_name ?? '-'}
                        {r.chart_number ? <span className="text-xs text-muted-foreground"> ({r.chart_number})</span> : null}
                      </td>
                      {/* ③ 결제금액 */}
                      <td className="py-2 px-2 text-right tabular-nums font-medium">
                        {r.amount != null ? formatAmount(r.amount) : '-'}
                      </td>
                      {/* ④ 승인번호 */}
                      <td className="py-2 px-2 tabular-nums text-xs text-muted-foreground">{r.approval_no ?? '-'}</td>
                      {/* 대조 배지 */}
                      <td className="py-2 px-2 text-center">
                        <Badge variant="outline" className={cn('text-xs', meta.cls)}>{meta.label}</Badge>
                      </td>
                      {/* ⑤ 원본 영수증 [이미지 보기] */}
                      <td className="py-2 px-3 text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          disabled={!r.image_url}
                          onClick={(e) => { e.stopPropagation(); setViewRow(r); }}
                        >
                          <ImageIcon className="mr-1 h-4 w-4" /> 이미지 보기
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground px-1">
        ※ [영수증 수납] 탭은 촬영·업로드한 <b>영수증 첨부 수납</b>을 카드단말기 자동수집 승인과 <b>대조</b>해 보여줍니다.
        날짜/시간은 <b>영수증에 인쇄된 결제일시</b> 기준입니다(업로드 시각이 아님). 매칭은 자동으로 계산됩니다.
      </p>

      {/* col⑤ read-only 뷰 모달 */}
      {viewRow && <ReceiptViewModal row={viewRow} onClose={() => setViewRow(null)} />}
    </div>
  );
}
