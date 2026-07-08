// T-20260708-foot-REDPAY-CLOSING-TAB — 일마감 '레드페이' 하위탭
// ──────────────────────────────────────────────────────────────
// Phase 1(각자쌓기): 카드단말기 redpay 자동수집 결제를 별도로 표시.
// Phase 2(대조): CRM 수납 ↔ 레드페이 매칭/미매칭 구분 표시.
// Phase 3(통일=합침/자동반영)은 OUT-OF-SCOPE(AC-5) — read-only 표시까지만.
//
// 데이터 소스: read-only VIEW public.v_redpay_reconciliation_daily (DA 확정, AC-3).
//   FE 조인·FE 매칭 재계산 금지 — 이 뷰만 소비(매처 진실원천 이중화 방지).
//   4-tier 매칭 결과는 PORT 매처(EF, read-only)가 이미 산출 → 뷰가 표면화.
// AC-4: 뷰가 서버-권위로 풋 13 TID 화이트리스트 + clinic RLS 필터(공유 merchant 방어).
// AC-6: API키 미발급/테스트모드에서도 뷰/RPC/UI 정상 렌더(기수집분/빈 목록).
// AC-7: get_redpay_feed_freshness()로 적재 freshness 노출 —
//       "거래 없음"(폴러 정상·raw 0) vs "적재 死"(폴러 stale) 현장 구분.
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { formatAmount } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ── 타입 ──────────────────────────────────────────────────────
type ReconStatus =
  | 'matched'
  | 'missing_in_crm'
  | 'missing_at_van'
  | 'amount_mismatch'
  | 'refund_not_in_crm';

interface ReconRow {
  row_id: string;
  anchor: 'redpay' | 'crm';
  clinic_id: string;
  close_date: string;
  approved_at: string | null;
  external_trxid: string | null;
  external_status: string | null;
  tid: string | null;
  van_amount: number | null;
  approval_no: string | null;
  matched_payment_id: string | null;
  crm_amount: number | null;
  crm_method: string | null;
  crm_created_at: string | null;
  recon_status: ReconStatus;
}

interface Freshness {
  last_approved_at: string | null;
  last_raw_updated_at: string | null;
  last_incremental_to: string | null;
  raw_count_today: number;
}

// ── 라벨/색 ────────────────────────────────────────────────────
const RECON_META: Record<ReconStatus, { label: string; cls: string; matched: boolean }> = {
  matched:            { label: '매칭',          cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', matched: true },
  missing_in_crm:     { label: '미매칭·CRM누락', cls: 'bg-red-100 text-red-700 border-red-200',            matched: false },
  missing_at_van:     { label: '미매칭·단말없음', cls: 'bg-amber-100 text-amber-700 border-amber-200',      matched: false },
  amount_mismatch:    { label: '금액불일치',      cls: 'bg-red-100 text-red-700 border-red-200',            matched: false },
  refund_not_in_crm:  { label: '취소·확인필요',    cls: 'bg-orange-100 text-orange-700 border-orange-200',   matched: false },
};

function kstTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleTimeString('ko-KR', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
    });
  } catch { return '-'; }
}

function kstDateTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: 'Asia/Seoul',
    });
  } catch { return '-'; }
}

// ── 컴포넌트 ───────────────────────────────────────────────────
export function RedpayReconcileTab({ date, clinicId }: { date: string; clinicId: string }) {
  const qc = useQueryClient();

  // 대조 뷰 (read-only) — FE 는 이 뷰만 소비
  const { data: rows = [], isLoading } = useQuery<ReconRow[]>({
    queryKey: ['redpay-recon', clinicId, date],
    enabled: !!clinicId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_redpay_reconciliation_daily')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('close_date', date);
      if (error) throw error;
      return (data ?? []) as ReconRow[];
    },
  });

  // 적재 freshness (AC-7)
  const { data: freshness } = useQuery<Freshness | null>({
    queryKey: ['redpay-freshness', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_redpay_feed_freshness');
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as Freshness | null;
    },
  });

  // Realtime: redpay raw 적재 시 즉시 갱신
  useEffect(() => {
    if (!clinicId) return;
    const channel = supabase.channel(`redpay-recon-${clinicId}-${date}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'redpay_raw_transactions', filter: `clinic_id=eq.${clinicId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['redpay-recon', clinicId, date] });
          qc.invalidateQueries({ queryKey: ['redpay-freshness', clinicId] });
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clinicId, date, qc]);

  // 정렬: 시각(레드페이 승인시각 우선, 없으면 CRM 입력시각) 오름차순
  const sorted = [...rows].sort((a, b) => {
    const ta = a.approved_at ?? a.crm_created_at ?? '';
    const tb = b.approved_at ?? b.crm_created_at ?? '';
    return ta.localeCompare(tb);
  });

  const matchedCount = sorted.filter(r => RECON_META[r.recon_status]?.matched).length;
  const mismatchCount = sorted.length - matchedCount;

  // ── freshness 판정 (거래 없음 vs 적재 死 vs 활성화 전) ──────────
  const now = Date.now();
  const lastPoll = freshness?.last_incremental_to ? new Date(freshness.last_incremental_to).getTime() : null;
  const STALE_MS = 6 * 60 * 60 * 1000; // 6h — 5분 폴러 기준 넉넉한 임계
  let feedState: { tone: 'idle' | 'ok' | 'stale'; msg: string };
  if (lastPoll === null) {
    feedState = { tone: 'idle', msg: '레드페이 자동수집이 아직 활성화되지 않았습니다 (API 키 발급 전/테스트모드). 활성화 후 카드단말기 결제가 자동으로 쌓입니다.' };
  } else if (now - lastPoll > STALE_MS) {
    feedState = { tone: 'stale', msg: `⚠ 자동수집이 지연되고 있습니다. 마지막 수집: ${kstDateTime(freshness!.last_incremental_to)} — 적재가 멈췄을 수 있어요(“거래 없음”이 아닐 수 있음).` };
  } else {
    feedState = { tone: 'ok', msg: `자동수집 정상 · 마지막 수집 ${kstDateTime(freshness!.last_incremental_to)}` };
  }

  const feedToneCls =
    feedState.tone === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
    : feedState.tone === 'stale' ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-slate-50 border-slate-200 text-slate-600';

  return (
    <div className="space-y-4">
      {/* 적재 freshness 배너 (AC-7) */}
      <div className={cn('rounded-lg border px-4 py-3 text-sm flex items-start gap-2', feedToneCls)}>
        <RefreshCw className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <div className="font-medium">{feedState.msg}</div>
          <div className="text-xs opacity-80 mt-0.5">
            마지막 단말기 승인: {freshness?.last_approved_at ? kstDateTime(freshness.last_approved_at) : '없음'}
            {' · '}오늘 수집 {freshness?.raw_count_today ?? 0}건
          </div>
        </div>
      </div>

      {/* 대조 요약 (Phase 2) */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">레드페이 수집</div>
          <div className="tabular-nums font-semibold text-lg">{sorted.length}건</div>
        </div>
        <div className="rounded-lg border bg-emerald-50 border-emerald-200 p-3 text-center">
          <div className="text-xs text-emerald-700 mb-1">매칭</div>
          <div className="tabular-nums font-semibold text-lg text-emerald-700">{matchedCount}건</div>
        </div>
        <div className="rounded-lg border bg-amber-50 border-amber-200 p-3 text-center">
          <div className="text-xs text-amber-700 mb-1">미매칭</div>
          <div className="tabular-nums font-semibold text-lg text-amber-700">{mismatchCount}건</div>
        </div>
      </div>

      {/* 대조 목록 (CRM 수납 ↔ 레드페이) — read-only */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">레드페이 · CRM 수납 대조</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 px-3 text-left font-medium w-16">시간</th>
                  <th className="py-2 px-2 text-left font-medium w-16">출처</th>
                  <th className="py-2 px-2 text-left font-medium w-28">단말기 TID</th>
                  <th className="py-2 px-2 text-left font-medium w-24">승인번호</th>
                  <th className="py-2 px-2 text-right font-medium w-24">단말기 금액</th>
                  <th className="py-2 px-2 text-right font-medium w-24">CRM 수납 금액</th>
                  <th className="py-2 px-2 text-center font-medium w-28">대조</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">불러오는 중…</td></tr>
                )}
                {!isLoading && sorted.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                      레드페이 자동수집 결제가 없습니다.
                      <div className="text-xs mt-1 opacity-70">카드단말기 결제가 발생하면 이 목록에 자동으로 쌓입니다.</div>
                    </td>
                  </tr>
                )}
                {sorted.map((r) => {
                  const meta = RECON_META[r.recon_status];
                  return (
                    <tr
                      key={r.row_id}
                      className={cn(
                        'border-b transition-colors',
                        !meta?.matched && 'bg-amber-50/40',
                      )}
                    >
                      <td className="py-2 px-3 tabular-nums text-xs">
                        {kstTime(r.approved_at ?? r.crm_created_at)}
                      </td>
                      <td className="py-2 px-2">
                        <Badge variant={r.anchor === 'redpay' ? 'secondary' : 'outline'} className="text-xs">
                          {r.anchor === 'redpay' ? '레드페이' : 'CRM'}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-xs text-muted-foreground tabular-nums">{r.tid ?? '-'}</td>
                      <td className="py-2 px-2 text-xs text-muted-foreground tabular-nums">{r.approval_no ?? '-'}</td>
                      <td className="py-2 px-2 text-right tabular-nums font-medium">
                        {r.van_amount != null ? formatAmount(r.van_amount) : '-'}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums font-medium">
                        {r.crm_amount != null ? formatAmount(r.crm_amount) : '-'}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <Badge variant="outline" className={cn('text-xs', meta?.cls)}>
                          {meta?.label ?? r.recon_status}
                        </Badge>
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
        ※ 레드페이 탭은 카드단말기 자동수집 결제를 <b>별도로</b> 보여줍니다(각자 쌓기). CRM 수납과의 합침·자동반영은 추후 별도 기능으로,
        지금은 매칭/미매칭 대조만 표시합니다.
      </p>
    </div>
  );
}
