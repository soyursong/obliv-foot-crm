// T-20260708-foot-REDPAY-CLOSING-TAB — 일마감 '레드페이' 하위탭
// ──────────────────────────────────────────────────────────────
// Phase 1(각자쌓기): 카드단말기 redpay 자동수집 결제를 별도로 표시.
// Phase 2(대조): CRM 수납 ↔ 레드페이 매칭/미매칭 구분 표시.
// Phase 3(통일=통합 표시)은 OUT-OF-SCOPE(AC-5) — read-only 표시까지만.
//
// 데이터 소스: read-only VIEW public.v_redpay_reconciliation_daily (DA 확정, AC-3).
//   FE 조인·FE 매칭 재계산 금지 — 이 뷰만 소비(매처 진실원천 이중화 방지).
//   4-tier 매칭 결과는 PORT 매처(EF, read-only)가 이미 산출 → 뷰가 표면화.
// AC-4: 뷰가 서버-권위로 풋 13 TID 화이트리스트 + clinic RLS 필터(공유 merchant 방어).
// AC-6: API키 미발급/테스트모드에서도 뷰/RPC/UI 정상 렌더(기수집분/빈 목록).
// AC-7: get_redpay_feed_freshness()로 적재 freshness 노출 —
//       "거래 없음"(폴러 정상·raw 0) vs "적재 死"(폴러 stale) 현장 구분.
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { formatAmount } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  type InstallVerifyEvidence,
  isInstallVerifyPresumed,
  countInstallVerifyPresumed,
  describeEvidence,
} from '@/lib/redpayInstallVerify';
import {
  fetchUnassignedInflowMetric,
  formatInflowRate,
  type UnassignedInflowMetric,
} from '@/lib/redpayPlanbInflowMetric';
import { REDPAY_PLANB_TTL } from '@/lib/redpayPlanbTtl';
import PlanbPendingReceiveList from '@/components/PlanbPendingReceiveList';

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
  // T-20260803 INSTALLVERIFY — 서버뷰 파생 분류(설치검증 추정). FE 재판정 금지, 소비만.
  install_verify_presumed?: boolean | null;
  install_verify_evidence?: InstallVerifyEvidence | null;
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

  // ── 미배정 결제함 유입률 (T-20260729-foot-REDPAY-PLANB-UNASSIGNED-INFLOW-METRIC) ──
  //   read-only 운영지표 — pending_payment.status(expired|failed) count only.
  //   ★ payments / 매출 split 무접점(redpayPlanbInflowMetric lib이 JOIN 금지 계약 보유).
  //   일별 grain: [date 00:00 KST, 다음날 00:00 KST) 반개구간(created_at 기준).
  const dayStartIso = `${date}T00:00:00+09:00`;
  const dayEndMs = new Date(dayStartIso).getTime() + 24 * 60 * 60 * 1000;
  const dayEndIso = new Date(dayEndMs).toISOString();
  //   확정 안정 시점 = 대상일 종료 + 보관창(60분) + 유효창(5분) 경과 후(late-match 반영).
  //   그 전이면 expired 과대집계 가능 → '잠정' 표기.
  const settleMs = dayEndMs + REDPAY_PLANB_TTL.retentionMs + REDPAY_PLANB_TTL.autoConnectMs;
  const isProvisional = Date.now() < settleMs;

  const { data: inflow, isLoading: inflowLoading } = useQuery<UnassignedInflowMetric>({
    queryKey: ['redpay-inflow-metric', clinicId, date],
    enabled: !!clinicId,
    queryFn: () => fetchUnassignedInflowMetric(clinicId, dayStartIso, dayEndIso),
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
      // 선점표 상태 전이(open→matched/expired/failed) 시 미배정 유입률 즉시 갱신
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'pending_payment', filter: `clinic_id=eq.${clinicId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['redpay-inflow-metric', clinicId, date] });
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

  // ── 설치검증 추정 분류 (T-20260803 INSTALLVERIFY) ─────────────────────────────
  //   서버뷰(v_redpay_installverify_pairs) 4조건 판정 소비 + 세션 override(되돌림) 반영.
  //   ① 필터 숨기기/펼치기 ② "N건" 요약 ③ 사유 펼치기 ④ '설치검증 아님' 되돌림(비파괴).
  const [hideInstallVerify, setHideInstallVerify] = useState(false);
  const [overridden, setOverridden] = useState<Set<string>>(new Set());
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const installVerifyCount = countInstallVerifyPresumed(sorted, overridden);
  // 표시 목록: 필터 ON 이면 설치검증 추정 건 접기. 원본 데이터 무접촉(재노출 가능).
  const visible = hideInstallVerify
    ? sorted.filter((r) => !isInstallVerifyPresumed(r, overridden))
    : sorted;
  const revertInstallVerify = (rowId: string) =>
    setOverridden((prev) => {
      const next = new Set(prev);
      next.add(rowId);
      return next;
    });

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

      {/* 설치검증 추정 요약 (T-20260803 INSTALLVERIFY) — 아침요약 'N건' 프레임과 동일 단위.
          개별 확인요청 대신 'N건'으로만 표시. 필터로 접기/펼치기(언제든 재노출). */}
      {installVerifyCount > 0 && (
        <div
          data-testid="installverify-summary"
          className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm flex items-center justify-between gap-2"
        >
          <div className="text-teal-800">
            <span className="font-medium">설치검증 추정 {installVerifyCount}건</span>
            <span className="text-xs text-teal-600 ml-2">
              (승인 즉시 취소·순액 0원 소액 = 설치·단말 검증으로 추정 — 개별 확인요청을 이 요약으로 대체)
            </span>
          </div>
          <Button
            data-testid="installverify-filter-toggle"
            variant="outline"
            size="sm"
            className="shrink-0 border-teal-300 text-teal-700 hover:bg-teal-100"
            onClick={() => setHideInstallVerify((v) => !v)}
          >
            {hideInstallVerify ? '설치검증 추정 펼치기' : '설치검증 추정 숨기기'}
          </Button>
        </div>
      )}

      {/* 미배정 결제함 유입률 (T-20260729 UNASSIGNED-INFLOW-METRIC) — read-only 운영지표 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between gap-2">
            <span>
              미배정 결제함 유입률{' '}
              <span className="text-xs font-normal text-muted-foreground">(선점 만료·미매칭으로 자동연결 실패한 비율)</span>
            </span>
            {isProvisional && (
              <Badge variant="outline" className="text-[10px] bg-slate-50 text-slate-500 border-slate-200 shrink-0">
                잠정
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {inflowLoading ? (
            <div className="py-4 text-center text-sm text-muted-foreground">불러오는 중…</div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border bg-card p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1">전체 선점</div>
                  <div className="tabular-nums font-semibold text-lg">{inflow?.totalPreempts ?? 0}건</div>
                </div>
                <div className="rounded-lg border bg-amber-50 border-amber-200 p-3 text-center">
                  <div className="text-xs text-amber-700 mb-1">미배정 유입</div>
                  <div className="tabular-nums font-semibold text-lg text-amber-700">{inflow?.unassignedCount ?? 0}건</div>
                  <div className="text-[10px] text-amber-600/80 mt-0.5">
                    만료 {inflow?.expiredCount ?? 0} · 실패 {inflow?.failedCount ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1">유입률</div>
                  <div className="tabular-nums font-semibold text-lg">{inflow ? formatInflowRate(inflow) : '0.0%'}</div>
                </div>
              </div>
              {isProvisional && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  ※ 오늘·최근 날짜는 <b>잠정치</b>입니다. 만료된 선점도 최대 {REDPAY_PLANB_TTL.retentionMin}분 동안
                  뒤늦게 자동연결될 수 있어, 그 시간이 지난 뒤 확정 수치로 안정됩니다.
                </p>
              )}
              <p className="text-[11px] text-muted-foreground mt-1">
                ※ 결제 대기시간을 {REDPAY_PLANB_TTL.autoConnectMin}분으로 줄이면서 “시간이 짧아 자동연결하지 못하고
                미배정 결제함으로 넘어간 몫”을 추적하는 지표입니다(매출 집계와 무관, 선점표 상태만 집계).
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* 수신 대기 목록 (OPT3 #6) — 기능플래그 ON 시에만 렌더(OFF=null, 기존 화면 무변경) */}
      <PlanbPendingReceiveList clinicId={clinicId} />

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
                {!isLoading && sorted.length > 0 && visible.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      설치검증 추정 {installVerifyCount}건이 접혀 있습니다.
                      <div className="text-xs mt-1 opacity-70">위 “설치검증 추정 펼치기”로 다시 볼 수 있어요.</div>
                    </td>
                  </tr>
                )}
                {visible.map((r) => {
                  const meta = RECON_META[r.recon_status];
                  const presumed = isInstallVerifyPresumed(r, overridden);
                  const evLines = presumed ? describeEvidence(r.install_verify_evidence) : [];
                  const isOpen = expandedRow === r.row_id;
                  return (
                    <tr
                      key={r.row_id}
                      data-testid={presumed ? 'installverify-row' : undefined}
                      className={cn(
                        'border-b transition-colors',
                        presumed ? 'bg-teal-50/50' : !meta?.matched && 'bg-amber-50/40',
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
                        {presumed ? (
                          <div className="flex flex-col items-center gap-1">
                            <button
                              type="button"
                              data-testid="installverify-badge"
                              onClick={() => setExpandedRow(isOpen ? null : r.row_id)}
                              className="inline-flex items-center gap-0.5"
                              title="분류 사유 보기"
                            >
                              <Badge variant="outline" className="text-xs bg-teal-100 text-teal-700 border-teal-300">
                                설치검증 추정
                              </Badge>
                              {isOpen ? <ChevronDown className="h-3 w-3 text-teal-600" /> : <ChevronRight className="h-3 w-3 text-teal-600" />}
                            </button>
                            {isOpen && (
                              <div data-testid="installverify-evidence" className="text-[11px] text-left text-teal-800 bg-white/70 border border-teal-200 rounded p-2 mt-1 max-w-[240px] space-y-0.5">
                                <div className="font-medium">분류 사유(4가지 모두 충족)</div>
                                {evLines.map((line, i) => <div key={i}>{line}</div>)}
                                <Button
                                  data-testid="installverify-revert"
                                  variant="outline"
                                  size="sm"
                                  className="mt-1 h-6 text-[11px] border-slate-300"
                                  onClick={() => revertInstallVerify(r.row_id)}
                                >
                                  설치검증 아님 (되돌리기)
                                </Button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <Badge variant="outline" className={cn('text-xs', meta?.cls)}>
                            {meta?.label ?? r.recon_status}
                          </Badge>
                        )}
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
        ※ 레드페이 탭은 카드단말기 자동수집 결제를 <b>별도로</b> 보여줍니다(각자 쌓기). CRM 수납과의 통합 표시는 추후 별도 기능으로,
        지금은 매칭/미매칭 대조만 표시합니다.
      </p>
    </div>
  );
}
