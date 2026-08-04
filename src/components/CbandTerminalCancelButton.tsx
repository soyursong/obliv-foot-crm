/**
 * CbandTerminalCancelButton.tsx — 코밴 CAT 직결결제 [단말기 취소] 버튼 (S1 전문 · 플랜A 전용)
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260804-foot-CBAND-TERMINAL-CANCEL-S1-BTN (플랜A 취소 · FE)
 *
 * ★ 대원칙(REDEFINITION_RISK 준수): 취소 전문 로직 재구현 금지.
 *   S1/0430 취소 전송 + refund 행 착지는 이미 구축된 paymentFlow.cancel() + supabaseAttemptStore 를
 *   그대로 재사용한다(PLANA-BUILD §C). 본 컴포넌트는 (1)버튼 분리/게이팅 (2)S1/ORI 필드 주입
 *   (3)멱등 재취소 가드만 담당한다. 취소 성공 = 별도 payment_type='refund' 행 INSERT(canon),
 *   원거래 payments 물리 UPDATE 없음(파생 표시).
 *
 * ── AC 매핑 ──────────────────────────────────────────────────────────────────
 *   AC-2  : [단말기 취소] → cancel() = S1(header.TCODE) + ORI_DATE/ORI_AUTHNO/TAMT(원거래 동일).
 *   AC-3  : 취소 성공 → refund 행 INSERT(external_approval_no=취소AUTHNO=원거래AUTHNO, payment_attempt_id FK).
 *   AC-4  : 원거래 payments 물리 UPDATE 없음 — 취소 상태는 refund 행 존재로 파생 표시(상위 목록).
 *   AC-5  : 재취소 가드 — 원거래 AUTHNO 로 링크된 refund 행이 이미 있으면 전문 미전송(멱등).
 *   AC-8  : 수기 건(플랜A 아님 = MSG_TRACE/AUTHNO 없음)에서는 [단말기 취소] disabled + 툴팁.
 *
 * ※ AC-7(BETA 배지) = 별 티켓 T-20260804-foot-CBAND-TERMINAL-CANCEL-BETA-BADGE 가 canonical 소유.
 *   본 컴포넌트에서 배지 재구현 금지 → 배지 span 없이 버튼만 렌더(go-live 08-05 번들 시 배지 티켓이 부착).
 *
 * 태블릿 UX: teal-emerald · 큰 버튼 · 천단위 콤마 · 한국어. (풋센터 표준)
 */

import { useState } from 'react';
import { RotateCcw, AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatAmount } from '@/lib/format';
import { cancel, isCbandPayEnabled, type PaymentFlowResult } from '@/lib/cband/paymentFlow';
import { supabaseAttemptStore } from '@/lib/cband/supabaseAttemptStore';
import { getTerminalConfig } from '@/lib/cband/config';
import { supabase } from '@/lib/supabase';

/** AC-8 툴팁/안내 문구(티켓 전문) — 수기 건에서 [단말기 취소] 비활성 사유. */
export const TERMINAL_CANCEL_MANUAL_TOOLTIP =
  '단말기 직결로 결제된 건만 취소할 수 있습니다. 이 건은 기존 취소를 사용하세요.';

export interface CbandTerminalCancelPayment {
  id: string;
  amount: number;
  clinic_id?: string | null;
  check_in_id?: string | null;
  /** 원거래 승인번호(AUTHNO) — 취소 전문 ORI_AUTHNO 로 그대로 전송(동일값). */
  external_approval_no?: string | null;
  /** 매출일자 앵커(ISO) — 취소 전문 ORI_DATE(YYMMDD) 파생 근거. */
  accounting_date?: string | null;
  created_at?: string | null;
  /** CAT-origin 판별자(FK). NOT NULL = 플랜A(단말기 직결) 건. */
  payment_attempt_id?: string | null;
}

interface Props {
  payment: CbandTerminalCancelPayment;
  clinicId: string;
  customerId: string | null;
  /** 취소 성공 후 상위 목록 갱신. */
  onDone: () => void;
}

type UiState = 'confirm' | 'sending' | 'done' | 'attention' | 'failed' | 'already';

/** ISO('YYYY-MM-DD' 또는 timestamptz) → YYMMDD. 실패 시 null(ORI_DATE 생략 — buildMsg 는 선택 필드). */
function toYYMMDD(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return `${m[1].slice(2)}${m[2]}${m[3]}`;
}

/**
 * 플랜A(단말기 직결) 결제 건 판별자 = payment_attempt_id IS NOT NULL (3-way canon CAT-origin).
 *   external_approval_no(AUTHNO) 부재 시에도 안전측(수기 취급) — 취소 전문에 ORI_AUTHNO 필수라 승인번호 없으면 불가.
 */
export function isPlanACardPayment(p: CbandTerminalCancelPayment): boolean {
  return !!p.payment_attempt_id && !!(p.external_approval_no && p.external_approval_no.trim());
}

export default function CbandTerminalCancelButton({ payment, clinicId, customerId, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [ui, setUi] = useState<UiState>('confirm');
  const [result, setResult] = useState<PaymentFlowResult | null>(null);

  // 기능플래그 OFF PC 는 완전 숨김(결제 진입과 동일 게이트).
  if (!isCbandPayEnabled()) return null;

  const planA = isPlanACardPayment(payment);

  // ── AC-8: 수기 건(플랜A 아님)에서는 [단말기 취소] 비활성 + 마우스오버 툴팁 ──
  if (!planA) {
    return (
      <span
        className="group relative inline-block"
        tabIndex={0}
        title={TERMINAL_CANCEL_MANUAL_TOOLTIP}
        aria-label={TERMINAL_CANCEL_MANUAL_TOOLTIP}
        data-testid={`btn-terminal-cancel-disabled-${payment.id}`}
      >
        <button
          type="button"
          disabled
          className="rounded px-1 py-0.5 text-[10px] text-gray-400 cursor-not-allowed"
        >
          단말기 취소
        </button>
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 w-64 max-w-[80vw] -translate-x-1/2 rounded-md bg-gray-900 px-2.5 py-1.5 text-[11px] leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
          data-testid={`terminal-cancel-tooltip-${payment.id}`}
        >
          {TERMINAL_CANCEL_MANUAL_TOOLTIP}
        </span>
      </span>
    );
  }

  async function onConfirmCancel() {
    setUi('sending');
    setResult(null);
    try {
      // ── AC-5: 재취소 가드(멱등). 원거래 AUTHNO 로 링크된 refund 행이 이미 있으면 전문 미전송. ──
      const authNo = (payment.external_approval_no ?? '').trim();
      const { data: existingRefunds, error: guardErr } = await supabase
        .from('payments')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('payment_type', 'refund')
        .eq('external_approval_no', authNo)
        .limit(1);
      if (guardErr) {
        // 가드 조회 실패 = 안전측 정지(중복취소 위험 배제 못하면 진행하지 않음).
        setUi('failed');
        setResult(null);
        return;
      }
      if ((existingRefunds?.length ?? 0) > 0) {
        setUi('already');
        return;
      }

      // ── 단말 설정 확인 ──
      const cfg = getTerminalConfig();
      if (!cfg) {
        setUi('failed');
        setResult(null);
        return;
      }

      // ── AC-2: 취소(0430·S1) 전송 — 원거래 AUTHNO/ORI_DATE 동봉. 로직 재구현 없이 cancel() 재사용. ──
      const r = await cancel(
        {
          tid: cfg.tid,
          merno: cfg.merno,
          catPort: cfg.catPort,
          amount: payment.amount,
          clinicId,
          customerId,
          checkInId: payment.check_in_id ?? null,
          originalAuthNo: authNo,
          originalAuthDate: toYYMMDD(payment.accounting_date ?? payment.created_at) ?? undefined,
        },
        supabaseAttemptStore,
      );
      setResult(r);
      setUi(r.needsCheck ? 'attention' : r.classification === 'APPROVED' ? 'done' : 'failed');
      // 성공(취소 승인) 시 상위 목록 갱신 → refund 행 파생 표시(AC-4).
      if (!r.needsCheck && r.classification === 'APPROVED') onDone();
    } catch (e) {
      // 예외 = 안전측 정지(취소 성립 가능성 배제 못하면 확인 필요).
      setResult(null);
      setUi('failed');
      console.error('코밴 단말기 취소 오류:', (e as Error)?.message);
    }
  }

  function openDialog() {
    setUi('confirm');
    setResult(null);
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        data-testid={`btn-terminal-cancel-${payment.id}`}
        title="카드 단말기로 실제 결제를 취소합니다"
        onClick={openDialog}
        className="rounded px-1 py-0.5 text-[10px] font-medium text-rose-600 hover:bg-rose-50 transition"
      >
        단말기 취소
      </button>

      <Dialog open={open} onOpenChange={(v) => { if (ui !== 'sending') setOpen(v); }}>
        <DialogContent className="sm:max-w-md" data-testid="terminal-cancel-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-rose-600" /> 카드 단말기 취소
            </DialogTitle>
          </DialogHeader>

          {ui === 'confirm' && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-gray-700">
                이 건은 카드 단말기로 <b>실제 결제를 취소</b>합니다. 취소하면 되돌릴 수 없습니다.
              </p>
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">취소 금액</span><span className="font-bold tabular-nums text-rose-700">{formatAmount(payment.amount)}원</span></div>
                <div className="flex justify-between"><span className="text-gray-500">원거래 승인번호</span><span className="font-mono">{payment.external_approval_no}</span></div>
              </div>
            </div>
          )}

          {ui === 'sending' && (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-rose-50 py-6 text-rose-700">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">카드 단말에서 취소를 진행해 주세요…</span>
            </div>
          )}

          {ui === 'already' && (
            <div className="space-y-2 rounded-lg border-2 border-amber-300 bg-amber-50 p-4" data-testid="terminal-cancel-already">
              <div className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-6 w-6" />
                <span className="text-lg font-bold">이미 취소된 결제</span>
              </div>
              <p className="text-sm text-amber-900">이 결제는 이미 단말기 취소가 완료되었습니다. 중복 취소를 막기 위해 요청을 보내지 않았습니다.</p>
            </div>
          )}

          {ui === 'done' && result && (
            <div className="space-y-2 rounded-lg border-2 border-emerald-300 bg-emerald-50 p-4" data-testid="terminal-cancel-done">
              <div className="flex items-center gap-2 text-emerald-800">
                <CheckCircle2 className="h-6 w-6" />
                <span className="text-lg font-bold">취소 완료</span>
              </div>
              <p className="text-sm text-emerald-900">{result.userMessage}</p>
              {result.authNo && <p className="text-xs text-gray-600">취소 승인번호: {result.authNo}</p>}
            </div>
          )}

          {ui === 'attention' && result && (
            <div className="space-y-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-4" data-testid="terminal-cancel-attention">
              <div className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-6 w-6" />
                <span className="text-lg font-bold">확인 필요</span>
              </div>
              <p className="text-sm text-amber-900">{result.userMessage}</p>
              {/* ★T-20260804-foot-CBAND-BLOCKED-SEND-PHANTOM-MSGTRACE-SUPPRESS AC-3/AC-7 —
                  번호가 있을 때만 표시. 차단 시 msgTrace='차단 원인 시도의 실 번호'(AC-7) 또는 ''(원인 미특정).
                  새 phantom 번호는 결코 표시되지 않는다(AC-1). */}
              {result.msgTrace && (
                <div className="rounded bg-white/70 p-2 text-center">
                  <p className="text-xs text-gray-500">단말기 승인내역조회 번호(거래추적)</p>
                  <p className="text-lg font-mono font-bold tracking-wider text-gray-800" data-testid="terminal-cancel-msgtrace">{result.msgTrace}</p>
                </div>
              )}
              <p className="text-xs text-amber-700">※ 다시 취소하지 마세요. 취소가 이미 처리되었을 수 있습니다.</p>
            </div>
          )}

          {ui === 'failed' && (
            <div className="space-y-2 rounded-lg border-2 border-rose-300 bg-rose-50 p-4" data-testid="terminal-cancel-failed">
              <div className="flex items-center gap-2 text-rose-800">
                <XCircle className="h-6 w-6" />
                <span className="text-lg font-bold">취소 실패</span>
              </div>
              <p className="text-sm text-rose-900">{result?.userMessage ?? '취소가 처리되지 않았습니다. 단말기 연결을 확인해 주세요.'}</p>
            </div>
          )}

          <DialogFooter className="gap-2">
            {ui === 'confirm' && (
              <>
                <Button variant="outline" className="h-12 flex-1" onClick={() => setOpen(false)} data-testid="btn-terminal-cancel-abort">닫기</Button>
                <Button className="h-12 flex-1 bg-rose-600 text-base hover:bg-rose-700" onClick={onConfirmCancel} data-testid="btn-terminal-cancel-confirm">단말기 취소</Button>
              </>
            )}
            {ui === 'sending' && (
              <Button className="h-12 flex-1" disabled>진행 중…</Button>
            )}
            {(ui === 'done' || ui === 'already') && (
              <Button variant="outline" className="h-12 flex-1" onClick={() => setOpen(false)}>완료</Button>
            )}
            {ui === 'attention' && (
              <Button variant="outline" className="h-12 flex-1" onClick={() => setOpen(false)} data-testid="btn-terminal-cancel-close-attention">닫기 (확인 후 처리)</Button>
            )}
            {ui === 'failed' && (
              <>
                <Button variant="ghost" className="h-12" onClick={() => setOpen(false)}>닫기</Button>
                <Button className="h-12 flex-1 bg-rose-600 hover:bg-rose-700" onClick={() => setUi('confirm')} data-testid="btn-terminal-cancel-retry">다시 시도</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
