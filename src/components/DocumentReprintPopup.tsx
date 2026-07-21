/**
 * DocumentReprintPopup — 우클릭 [서류] 전용 별도 팝업창(모달)
 *
 * T-20260722-foot-CTXMENU-SERYU-POPUP-OVERRIDE (김주연 총괄 firm 확정)
 *   예약/체크인 우클릭 컨텍스트메뉴 [서류] 클릭 시 — 기존엔 차트(서류 탭) deep-link 이동이었으나
 *   (T-20260617-foot-CTXMENU-DOC-ENTRY) → 차트 이동 없이 이 별도 팝업창을 연다.
 *
 * ── 구성 (2섹션) ──
 *   ① 방문이력별 결제내역 및 발행 서류 (+ 서류 재출력 버튼)
 *      - 해당 고객 방문(체크인) 회차별 목록
 *      - 각 방문 건의 결제 내역(금액·방법·날짜)
 *      - 각 방문 건 발행 서류 목록 + [서류 재출력] 버튼
 *   ② 당일 서류 발행 — 최근 접수(latestCheckIn) 기준 신규 발행 (기존 서류 탭 당일 발행과 동일 동작)
 *
 * 재출력/당일발행은 모두 기존 DocumentPrintPanel(L-006 단일 렌더)을 스코프된 체크인으로 재사용한다.
 * 기존 차트 내 [서류] 탭(T-20260719-foot-DOCTAB-NEW-CREATE)은 무접촉 — 이 팝업은 우클릭 진입 전용 별도 뷰(병존).
 *
 * ⚠ 서류는 접수(체크인) 단위 발급물 → 방문(체크인) 기준으로 결제·발행서류·재출력을 귀속한다(추정 매칭 금지).
 */

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { FileText, Printer, X, Receipt } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatAmount, formatDateDots, formatDateTimeDots, chartNoDisplay } from '@/lib/format';
import { METHOD_KO } from '@/lib/status';
import { FORM_META } from '@/lib/formTemplates';
import { DocumentPrintPanel } from '@/components/DocumentPrintPanel';
import { cn } from '@/lib/utils';
import type { CheckIn } from '@/lib/types';

interface PaymentRow {
  id: string;
  check_in_id: string | null;
  amount: number;
  method: string;
  payment_type: 'payment' | 'refund';
  created_at: string;
  status?: 'active' | 'cancelled' | 'deleted' | null;
}

interface SubRow {
  check_in_id: string;
  template_key?: string;
  printed_at: string | null;
  signed_at: string | null;
}

interface Props {
  /** 우클릭한 그 고객 식별자. null이면 팝업 미표시. */
  customerId: string | null;
  /** 헤더 표기용 고객명(우클릭한 행/카드에서 전달). */
  customerName?: string | null;
  onClose: () => void;
}

/**
 * 우클릭 [서류] 전용 팝업. 우클릭한 고객 컨텍스트(customerId)를 물고 방문이력·결제·발행서류를 조회한다.
 * customerId가 바뀌면 스스로 재조회 → 다른 고객 데이터가 열리지 않도록 보장(AC-5).
 */
export function DocumentReprintPopup({ customerId, customerName, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [chartNumber, setChartNumber] = useState<string | number | null>(null);
  const [altStatus, setAltStatus] = useState(false);
  const [custName, setCustName] = useState<string | null>(customerName ?? null);
  // 재출력/당일발행 대상 체크인 — 설정 시 DocumentPrintPanel 중첩 모달 오픈(차트 docReissueCheckIn 패턴 동일).
  const [reissueCheckIn, setReissueCheckIn] = useState<CheckIn | null>(null);

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const [custRes, ciRes, payRes, subRes] = await Promise.all([
        supabase.from('customers').select('name, chart_number, alt_status').eq('id', customerId).maybeSingle(),
        // 방문(체크인) 회차 — 취소건 제외(차트 서류 탭 재출력 대상 정합)
        supabase.from('check_ins').select('*').eq('customer_id', customerId)
          .neq('status', 'cancelled').order('checked_in_at', { ascending: false }).limit(100),
        // 결제 내역 — active-only(fail-closed, CHARTPAGE-SOFTVOID-PAYMENT-PHANTOM 정합)
        supabase.from('payments').select('id, check_in_id, amount, method, payment_type, created_at, status')
          .eq('customer_id', customerId).eq('status', 'active').order('created_at', { ascending: false }).limit(200),
        // 발행 서류 — check_in 단위 귀속
        supabase.from('form_submissions')
          .select('check_in_id, printed_at, signed_at, field_data, form_templates!template_id(form_key)')
          .eq('customer_id', customerId).order('printed_at', { ascending: false, nullsFirst: false }).limit(200),
      ]);

      const cust = custRes.data as { name: string | null; chart_number: string | number | null; alt_status: boolean | null } | null;
      if (cust) {
        setCustName(cust.name ?? customerName ?? null);
        setChartNumber(cust.chart_number ?? null);
        setAltStatus(cust.alt_status ?? false);
      }
      setCheckIns((ciRes.data ?? []) as CheckIn[]);
      setPayments((payRes.data ?? []) as PaymentRow[]);
      setSubs(
        (subRes.data ?? []).map((s: Record<string, unknown>) => ({
          check_in_id: s.check_in_id as string,
          template_key: (s.form_templates as { form_key: string } | null)?.form_key
            ?? ((s.field_data as Record<string, unknown> | null)?.form_key as string | undefined),
          printed_at: (s.printed_at as string | null) ?? null,
          signed_at: (s.signed_at as string | null) ?? null,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [customerId, customerName]);

  useEffect(() => {
    if (!customerId) return;
    // customerId 변경 시 이전 고객 데이터 잔상 제거 후 재조회(AC-5: 다른 고객 데이터 방지)
    setCheckIns([]);
    setPayments([]);
    setSubs([]);
    setChartNumber(null);
    setReissueCheckIn(null);
    setCustName(customerName ?? null);
    void load();
  }, [customerId, customerName, load]);

  // ESC 닫기
  useEffect(() => {
    if (!customerId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !reissueCheckIn) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [customerId, reissueCheckIn, onClose]);

  if (!customerId) return null;

  const latestCheckIn = checkIns[0] ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      data-testid="doc-reprint-popup"
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 — 우클릭한 그 고객 명시(AC-5) */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-teal-600 shrink-0" />
            <span className="text-sm font-semibold text-gray-900" data-testid="doc-reprint-title">서류</span>
            {custName && (
              <span className="text-sm font-medium text-gray-700" data-testid="doc-reprint-customer">{custName}</span>
            )}
            {chartNumber != null && (
              <span className="text-[11px] text-muted-foreground">고객번호 {chartNoDisplay(chartNumber)}</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-gray-100"
            data-testid="doc-reprint-close"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-auto p-4">
          {/* ① 당일 서류 발행 — 별도 발행창(DocumentPrintPanel 재사용) */}
          <div className="rounded-lg border bg-white p-3 text-xs" data-testid="doc-reprint-issue-today">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold text-[#51585D]">당일 서류 발행</div>
              <button
                type="button"
                disabled={!latestCheckIn}
                onClick={() => { if (latestCheckIn) setReissueCheckIn(latestCheckIn); }}
                data-testid="btn-doc-reprint-issue-today"
                className={cn(
                  'inline-flex items-center gap-1 rounded border px-2.5 py-1 text-[11px] font-medium transition',
                  latestCheckIn
                    ? 'border-sage-300 bg-sage-50 text-sage-700 hover:bg-sage-100'
                    : 'border-muted text-muted-foreground cursor-not-allowed',
                )}
              >
                <FileText className="h-3 w-3" /> 당일 서류 발행
              </button>
            </div>
            {!latestCheckIn && !loading && (
              <p className="mt-1.5 text-[11px] text-muted-foreground" data-testid="doc-reprint-issue-nocheckin">
                접수 기록이 없어 당일 서류 발행을 사용할 수 없습니다
              </p>
            )}
          </div>

          {/* ② 방문이력별 결제내역 · 발행서류 · 재출력 */}
          <div className="rounded-lg border bg-white p-3 text-xs" data-testid="doc-reprint-visit-list">
            <div className="mb-2 text-[11px] font-semibold text-[#51585D]">방문이력별 결제내역 · 서류 재출력</div>
            {loading ? (
              <div className="py-4 text-center text-[11px] text-muted-foreground" data-testid="doc-reprint-loading">불러오는 중…</div>
            ) : checkIns.length === 0 ? (
              <div className="py-2 text-[11px] text-muted-foreground" data-testid="doc-reprint-visit-empty">방문 기록 없음</div>
            ) : (
              <div className="space-y-1.5">
                {checkIns.map((ci) => {
                  const ciPayments = payments.filter((p) => p.check_in_id === ci.id);
                  const ciSubs = subs.filter((s) => s.check_in_id === ci.id);
                  const dateStr = formatDateDots(ci.checked_in_at);
                  const timeStr = format(new Date(ci.checked_in_at), 'HH:mm');
                  return (
                    <div
                      key={ci.id}
                      className="rounded border border-gray-100 px-2.5 py-1.5"
                      data-testid="doc-reprint-visit-row"
                    >
                      {/* 방문 헤더 — 방문일시 + 재출력 버튼 */}
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 tabular-nums font-medium text-gray-800">{dateStr}</span>
                        <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{timeStr}</span>
                        <span className="flex-1" />
                        <button
                          type="button"
                          onClick={() => setReissueCheckIn(ci)}
                          data-testid="btn-doc-reprint-reissue"
                          className="inline-flex shrink-0 items-center gap-1 rounded border border-sage-300 bg-sage-50 px-1.5 py-0.5 text-[10px] font-medium text-sage-700 transition hover:bg-sage-100"
                        >
                          <FileText className="h-3 w-3" /> 서류 재출력
                        </button>
                      </div>

                      {/* 결제 내역 (금액·방법·날짜) */}
                      {ciPayments.length > 0 && (
                        <div className="mt-1 space-y-0.5" data-testid="doc-reprint-payments">
                          {ciPayments.map((p) => (
                            <div key={p.id} className="flex items-center gap-1.5 text-[10px] text-gray-600">
                              <Receipt className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                              <span className={cn('tabular-nums font-medium', p.payment_type === 'refund' ? 'text-rose-600' : 'text-gray-800')}>
                                {p.payment_type === 'refund' ? '-' : ''}{formatAmount(p.amount)}원
                              </span>
                              <span className="text-muted-foreground">{METHOD_KO[p.method as keyof typeof METHOD_KO] ?? p.method}</span>
                              <span className="text-muted-foreground/70">{formatDateDots(p.created_at)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 발행 서류 목록 */}
                      {ciSubs.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1" data-testid="doc-reprint-docs">
                          {ciSubs.map((s, i) => {
                            const meta = s.template_key ? FORM_META[s.template_key] : undefined;
                            const label = meta?.description ?? s.template_key ?? '서류';
                            return (
                              <span
                                key={i}
                                className="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-600"
                                title={`발급: ${s.printed_at || s.signed_at ? formatDateTimeDots((s.printed_at ?? s.signed_at)!) : '-'}`}
                              >
                                <Printer className="h-2.5 w-2.5 shrink-0" />
                                {label}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {ciPayments.length === 0 && ciSubs.length === 0 && (
                        <div className="mt-0.5 text-[10px] text-muted-foreground/70">결제·발행 서류 없음</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 재출력 / 당일발행 — 스코프된 체크인으로 DocumentPrintPanel 중첩 모달(차트 docReissueCheckIn 패턴 동일) */}
      {reissueCheckIn && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setReissueCheckIn(null)}
          data-testid="doc-reprint-panel-modal"
        >
          <div
            className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-sm font-semibold">
                서류 발행 — {formatDateTimeDots(reissueCheckIn.checked_in_at)}
              </div>
              <button
                onClick={() => setReissueCheckIn(null)}
                className="rounded p-1 hover:bg-gray-100"
                aria-label="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4">
              <DocumentPrintPanel
                checkIn={reissueCheckIn}
                onUpdated={() => { void load(); }}
                altStatus={altStatus}
                historyAtTop
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DocumentReprintPopup;
