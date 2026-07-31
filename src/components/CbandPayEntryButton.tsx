/**
 * CbandPayEntryButton.tsx — 코밴 CAT 직결 결제 진입 버튼 + 결제 다이얼로그 (기능플래그·단말감지 게이트)
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD (플랜A · FE)
 *
 * ★ 대원칙: 기존 결제 화면 무접촉. 이 버튼은 아래 3중 게이트가 모두 통과할 때만 렌더:
 *   ① 기능플래그 VITE_CBAND_PAY ON (기본 OFF — DDL 적용 전 프로덕션 노출 0)
 *   ② 로컬 단말 설정(TID/MERNO/CAT_PORT) 존재 (실측#1: 없으면 결제 불가)
 *   ③ probeTerminal() 성공 = 단말 데몬 구동중 (없는 PC 는 버튼 숨김, 티켓 시나리오2/§3-2)
 *
 * 태블릿 UX: teal-emerald · 큰 버튼 · 천단위 콤마 · 한국어. (풋센터 표준)
 *
 * ── ★ 이중결제 방지 UX(D) ──────────────────────────────────────────────────
 *   결과가 '확인 필요'(ATTENTION)면 자동 재시도 버튼을 주지 않고 정지 화면만 노출한다.
 *   화면에 MSG_TRACE 를 크게 띄워 단말 [승인내역조회]로 확인하도록 안내.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CreditCard, AlertTriangle, CheckCircle2, Loader2, XCircle, ShieldQuestion, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { AmountInput, parseAmountRaw } from '@/components/ui/AmountInput';
import { formatAmount } from '@/lib/format';
import { isCbandPayEnabled, approve, type PaymentFlowResult } from '@/lib/cband/paymentFlow';
import { supabaseAttemptStore } from '@/lib/cband/supabaseAttemptStore';
import { probeTerminal, cancelProbe, type ProbeResult } from '@/lib/cband/catClient';
import { getTerminalConfig } from '@/lib/cband/config';

interface Props {
  checkInId: string;
  clinicId: string;
  customerId: string | null;
}

type UiState = 'idle' | 'sending' | 'approved' | 'failed' | 'attention';

export default function CbandPayEntryButton({ checkInId, clinicId, customerId }: Props) {
  // ★U3: probe 결과 3분기 (null=탐지중 / 'ok' / 'awaiting' / 'blocked').
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [ui, setUi] = useState<UiState>('idle');
  const [result, setResult] = useState<PaymentFlowResult | null>(null);
  const mounted = useRef(true);

  const cfg = getTerminalConfig();
  const enabled = isCbandPayEnabled() && cfg != null;

  // ③ 단말 감지 — probeTerminal(열고 닫기만). ★U3 3분기 결과를 그대로 반영.
  const runProbe = useCallback(() => {
    setProbe(null); // 탐지중
    probeTerminal().then((r) => { if (mounted.current) setProbe(r); });
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) return;
    runProbe();
    // ★U2: 언마운트 시 잔여 탐침 소켓 정리(동시 1개 보장).
    return () => { mounted.current = false; cancelProbe(); };
  }, [enabled, runProbe]);

  // 게이트 ①②: 플래그 OFF / 단말 미설정 PC → 미노출(시나리오2 "단말 없는 PC → 버튼 숨김" 유지).
  // ★U3: 단말 설정이 있는 PC 는 probe 상태(awaiting/blocked)에서도 숨기지 않고 안내를 노출한다.
  if (!enabled) return null;

  const amountNum = parseInt(parseAmountRaw(amount) || '0', 10);
  const canPay = amountNum > 0 && ui !== 'sending';

  async function onApprove() {
    if (!cfg || !(amountNum > 0)) return;
    setUi('sending');
    setResult(null);
    cancelProbe(); // ★U2: 결제 소켓 열기 전 탐침 소켓 확실히 종료(동시 1개). send 내부에서도 재호출됨.
    try {
      const r = await approve(
        { tid: cfg.tid, merno: cfg.merno, catPort: cfg.catPort, amount: amountNum, clinicId, customerId, checkInId },
        supabaseAttemptStore,
      );
      if (!mounted.current) return;
      setResult(r);
      // ★ 분류에 따른 정지/성공/실패. ATTENTION 은 절대 자동 재시도하지 않음.
      setUi(r.needsCheck ? 'attention' : r.classification === 'APPROVED' ? 'approved' : 'failed');
    } catch (e) {
      if (!mounted.current) return;
      // 예외(조립 실패 등)는 안전측(정지)로. 승인 성립 가능성 배제 못하면 확인필요.
      setResult(null);
      setUi('failed');
      console.error('코밴 결제 오류:', (e as Error)?.message);
    }
  }

  function reset() {
    setUi('idle');
    setResult(null);
    setAmount('');
  }

  // ★U3: probe 3분기 — 결제 버튼은 'ok' 에서만 노출. 그 외에는 숨기지 않고 상태 안내를 보인다.
  //  · null(탐지중): 확인 중 표시(버튼 유지·비활성).
  //  · 'awaiting'(권한창 대기): 버튼 유지 + 브라우저 [허용] 안내 + [다시 확인].  ★숨김 대상 아님.
  //  · 'blocked'([차단] 또는 데몬 꺼짐): 안내 메시지(두 원인 함께) + [다시 확인].
  if (probe === null) {
    return (
      <div
        className="flex w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-gray-50 py-2 text-sm text-gray-500"
        data-testid="cband-probing"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 카드 단말 확인 중…
      </div>
    );
  }

  if (probe === 'awaiting') {
    return (
      <div
        className="w-full space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"
        data-testid="cband-awaiting"
      >
        <div className="flex items-center gap-2 font-semibold text-amber-800">
          <ShieldQuestion className="h-4 w-4" /> 카드 단말 접속 허용이 필요합니다
        </div>
        <p className="text-amber-900">
          브라우저에 <b>“이 사이트가 로컬 기기(카드 단말)에 접속하도록 허용하시겠습니까?”</b> 창이 뜨면
          <b> [허용]</b>을 눌러 주세요. 한 번 허용하면 이 PC에서는 계속 카드결제를 쓸 수 있습니다.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-full border-amber-300 text-amber-800 hover:bg-amber-100"
          data-testid="btn-cband-reprobe"
          onClick={runProbe}
        >
          허용한 뒤 다시 확인
        </Button>
      </div>
    );
  }

  if (probe === 'blocked') {
    return (
      <div
        className="w-full space-y-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm"
        data-testid="cband-blocked"
      >
        <div className="flex items-center gap-2 font-semibold text-rose-800">
          <PlugZap className="h-4 w-4" /> 카드 단말에 연결하지 못했습니다
        </div>
        <p className="text-rose-900">
          다음 중 하나입니다: ① 브라우저에서 로컬 기기 접속을 <b>[차단]</b>했거나, ② 카드 단말
          프로그램이 <b>꺼져 있습니다</b>. 주소창의 자물쇠 → 사이트 설정에서 차단을 해제하거나,
          단말 프로그램을 켠 뒤 아래 <b>[다시 확인]</b>을 눌러 주세요.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-full border-rose-300 text-rose-800 hover:bg-rose-100"
          data-testid="btn-cband-reprobe"
          onClick={runProbe}
        >
          다시 확인
        </Button>
      </div>
    );
  }

  // probe === 'ok' → 결제 버튼 + 다이얼로그
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
        disabled={!customerId}
        data-testid="btn-cband-pay-entry"
        onClick={() => { reset(); setOpen(true); }}
      >
        <CreditCard className="h-3.5 w-3.5" /> 카드 단말 결제(코밴)
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (ui !== 'sending') setOpen(v); }}>
        <DialogContent className="sm:max-w-md" data-testid="cband-pay-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-emerald-600" /> 카드 단말 결제(코밴)
            </DialogTitle>
          </DialogHeader>

          {/* 입력/전송 */}
          {(ui === 'idle' || ui === 'sending') && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">결제 금액</label>
                <AmountInput
                  value={amount}
                  onChange={setAmount}
                  disabled={ui === 'sending'}
                  className="h-14 text-2xl text-right"
                  data-testid="cband-amount-input"
                  inputMode="numeric"
                  placeholder="0"
                />
                {amountNum > 0 && (
                  <p className="text-right text-sm text-emerald-700">{formatAmount(amountNum)}원</p>
                )}
              </div>
              {ui === 'sending' && (
                <div className="flex items-center justify-center gap-2 rounded-lg bg-emerald-50 py-4 text-emerald-700">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">카드 단말에서 결제를 진행해 주세요…</span>
                </div>
              )}
            </div>
          )}

          {/* ★ 확인 필요(ATTENTION) — 자동 재시도 없음, MSG_TRACE 안내 */}
          {ui === 'attention' && result && (
            <div className="space-y-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-4" data-testid="cband-attention">
              <div className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-6 w-6" />
                <span className="text-lg font-bold">확인 필요</span>
              </div>
              <p className="text-sm text-amber-900">{result.userMessage}</p>
              <div className="rounded bg-white/70 p-2 text-center">
                <p className="text-xs text-gray-500">단말기 승인내역조회 번호(거래추적)</p>
                <p className="text-xl font-mono font-bold tracking-wider text-gray-800" data-testid="cband-msgtrace">
                  {result.msgTrace}
                </p>
              </div>
              <p className="text-xs text-amber-700">※ 다시 결제하지 마세요. 카드가 이미 승인되었을 수 있습니다.</p>
            </div>
          )}

          {/* 승인 성공 */}
          {ui === 'approved' && result && (
            <div className="space-y-2 rounded-lg border-2 border-emerald-300 bg-emerald-50 p-4" data-testid="cband-approved">
              <div className="flex items-center gap-2 text-emerald-800">
                <CheckCircle2 className="h-6 w-6" />
                <span className="text-lg font-bold">결제 완료</span>
              </div>
              <p className="text-sm text-emerald-900">{result.userMessage}</p>
              {result.authNo && <p className="text-xs text-gray-600">승인번호: {result.authNo}</p>}
            </div>
          )}

          {/* 실패 */}
          {ui === 'failed' && (
            <div className="space-y-2 rounded-lg border-2 border-rose-300 bg-rose-50 p-4" data-testid="cband-failed">
              <div className="flex items-center gap-2 text-rose-800">
                <XCircle className="h-6 w-6" />
                <span className="text-lg font-bold">결제 실패</span>
              </div>
              <p className="text-sm text-rose-900">{result?.userMessage ?? '결제가 처리되지 않았습니다. 다시 시도해 주세요.'}</p>
            </div>
          )}

          <DialogFooter className="gap-2">
            {(ui === 'idle' || ui === 'sending') && (
              <Button
                className="h-14 flex-1 bg-emerald-600 text-lg hover:bg-emerald-700"
                disabled={!canPay}
                data-testid="btn-cband-approve"
                onClick={onApprove}
              >
                {ui === 'sending' ? '진행 중…' : '결제 요청'}
              </Button>
            )}
            {/* ★ attention 은 '다시 시도' 버튼을 주지 않는다(자동/수동 재시도 정지). 닫기만. */}
            {ui === 'attention' && (
              <Button variant="outline" className="h-12 flex-1" onClick={() => setOpen(false)} data-testid="btn-cband-close-attention">
                닫기 (확인 후 처리)
              </Button>
            )}
            {ui === 'approved' && (
              <Button variant="outline" className="h-12 flex-1" onClick={() => setOpen(false)}>완료</Button>
            )}
            {ui === 'failed' && (
              <>
                <Button variant="ghost" className="h-12" onClick={() => setOpen(false)}>닫기</Button>
                <Button className="h-12 flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={reset} data-testid="btn-cband-retry">
                  다시 시도
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
