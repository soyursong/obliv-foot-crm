/**
 * CbandSplitPayDialog.tsx — 코밴 CAT 분할결제(한 수납 N개 카드 레그) 오케스트레이션 다이얼로그
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260806-foot-PLANA-SPLIT-MULTIPAY (플랜A ② · UI 배선 증분)
 *
 * 한 수납을 여러 카드 레그로 나눠 **순차** 전송(코밴 규격: 한 전문=한 결제)하고,
 * 승인분을 한 수납(check_in_id)으로 자동 묶는다. 순수 상태머신 = src/lib/cband/splitPayment.ts,
 * 각 레그 실 전송/취소 = paymentFlow.approve()/cancel()(각 승인 = payments 1행, external_approval_no per leg).
 *
 * ── ★ 3대 불변식 (설계 docs/PLANA-SPLIT-MULTIPAY-DESIGN.md) ─────────────────────
 *   1. 🔴 자동취소 절대 금지(AC-2): 중간 실패/확인필요 발생 시 전송을 **정지(halt)만** 한다.
 *      승인분 취소는 오직 사람이 [승인분 취소]를 눌러 per-leg confirm 후에만 일어난다.
 *   2. 하드락 유지(AC-3): 2번째 이후 레그 precheck 에 splitContext=true → 소프트(patient_completed)만
 *      억제. 진짜 동시성 하드락(patient_in_progress·terminal_busy)은 그대로 차단.
 *   3. 스키마 무접촉(AC-4): 승인번호 묶음 = 기존 check_in_id 링크(approve() 가 payments 에 착지).
 *
 * ── ★ 렌더 결정 SSOT ──────────────────────────────────────────────────────────
 *   deriveSplitView(session) 결과만 보고 렌더한다. 자동진행/자동취소 분기는 코드에 없다.
 *
 * ── ★ 게이트 계승(CbandPayEntryButton 무접촉 재사용) ───────────────────────────
 *   기능플래그(isCbandPayEnabled)·단말설정(getTerminalConfig)·단말탐지(probeTerminal)를 동일하게 소비.
 *   설정 미완/미연결 시 결제 진입 비활성(사유 노출). 단말 TID/COM 설정은 단일결제 팝업에서 이미 완료된
 *   PC 를 전제(분할=고급 동선). 미설정이면 안내만 노출(설정 창 중복 창안 금지).
 *
 * 태블릿 UX: teal-emerald · 큰 버튼 · 천단위 콤마 · 한국어. (풋센터 표준)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CreditCard, AlertTriangle, CheckCircle2, Loader2, XCircle, Users, RotateCcw, Ban, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatAmount } from '@/lib/format';
import {
  isCbandPayEnabled, approve, cancel, precheckConcurrentPayment,
  type ConcurrencyDecision,
} from '@/lib/cband/paymentFlow';
import { supabaseAttemptStore } from '@/lib/cband/supabaseAttemptStore';
import { probeTerminal, cancelProbe, type ProbeResult } from '@/lib/cband/catClient';
import { getTerminalConfig } from '@/lib/cband/config';
import {
  createSplitSession, applyLegResult, resetLegForRetry, markLegCancelled,
  deriveSplitView, type SplitSession, type SplitSessionStatus,
} from '@/lib/cband/splitPayment';

interface Props {
  checkInId: string;
  clinicId: string;
  customerId: string | null;
  /** 분할 카드 레그 금액들(PMW splitRows 중 method==='card' && amount>0). 순서 = 전송 순서. */
  cardAmounts: number[];
  /**
   * 세션 종결(완료/부분유지/전체취소) 시 상위(PMW) 통지(선택).
   *   ★상위가 별도 payments write 를 하지 않아도 됨 — approve() 가 이미 승인분을 payments 로 착지시킴.
   *   묶음 요약(승인번호·승인총액·잔액)만 표시/기록 목적으로 전달.
   */
  onSettled?: (summary: {
    status: SplitSessionStatus;
    approvalNumbers: string[];
    approvedTotal: number;
    outstanding: number;
  }) => void;
}

/** 다이얼로그 페이즈. */
type Phase = 'idle' | 'sending' | 'cancelling' | 'review';

export default function CbandSplitPayDialog({ checkInId, clinicId, customerId, cardAmounts, onSettled }: Props) {
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [session, setSession] = useState<SplitSession | null>(null);
  // 팝업 open 직전 서버 재확인(동시결제) — 하드락이면 차단 화면.
  const [concurrency, setConcurrency] = useState<ConcurrencyDecision | null>(null);
  const [prechecking, setPrechecking] = useState(false);
  const [payBlock, setPayBlock] = useState<string | null>(null);
  const mounted = useRef(true);

  const enabled = isCbandPayEnabled();
  const cfg = getTerminalConfig();
  const hasCfg = cfg != null;
  const totalAmount = cardAmounts.reduce((s, a) => s + (a > 0 ? a : 0), 0);

  const runProbe = useCallback(() => {
    setProbe(null);
    probeTerminal().then((r) => { if (mounted.current) setProbe(r); });
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!enabled || !hasCfg) return;
    runProbe();
    return () => { mounted.current = false; cancelProbe(); };
  }, [enabled, hasCfg, runProbe]);

  // 기능플래그 OFF PC 는 완전 무노출(회귀 0).
  if (!enabled) return null;

  const view = session ? deriveSplitView(session) : null;

  function resetSession() {
    setSession(createSplitSession({ checkInId, clinicId, customerId }, cardAmounts.map((amount) => ({ method: 'card', amount }))));
    setPhase('idle');
    setPayBlock(null);
    setConcurrency(null);
  }

  // 팝업 진입 — 첫 레그 서버 재확인(하드락 차단·소프트는 splitContext 로 통과 안 함: 첫 레그는 일반 동선).
  async function onEntryClick() {
    resetSession();
    setPrechecking(true);
    let decision: ConcurrencyDecision = { blocked: false, reason: null, allowOverride: false, userMessage: '' };
    try {
      decision = await precheckConcurrentPayment({ clinicId, checkInId, merno: cfg?.merno ?? null }, supabaseAttemptStore);
    } catch (e) {
      console.error('분할결제 동시결제 재확인 실패(degrade-open):', (e as Error)?.message);
    }
    if (!mounted.current) return;
    setPrechecking(false);
    if (decision.blocked) { setConcurrency(decision); }
    setOpen(true);
  }

  // 다음 pending 레그 1건 전송(사람 클릭). ★자동으로 다음 레그를 잇지 않는다 — 매 레그 사람 확인.
  async function sendNextLeg() {
    if (!session || !view || view.nextLegIndex == null) return;
    const legIndex = view.nextLegIndex;
    const leg = session.legs.find((l) => l.index === legIndex);
    if (!leg) return;
    const activeCfg = getTerminalConfig();
    if (!activeCfg) { setPayBlock('단말기 설정이 완료되지 않았습니다. 카드 단일 결제 창에서 단말기(TID/COM)를 먼저 설정해 주세요.'); return; }
    setPayBlock(null);
    setPhase('sending');
    // ★AC-3: 2번째 이후 레그는 splitContext=true — 완료건 소프트 confirm(patient_completed) 억제(하드락은 유지).
    const isFollowLeg = session.legs.some((l) => l.outcome === 'approved' || l.outcome === 'cancelled');
    try {
      const pre = await precheckConcurrentPayment(
        { clinicId, checkInId, merno: activeCfg.merno ?? null },
        supabaseAttemptStore,
        { splitContext: isFollowLeg },
      );
      if (!mounted.current) return;
      if (pre.blocked) { setConcurrency(pre); setPhase('idle'); return; }
    } catch (e) {
      console.error('분할 레그 precheck 실패(degrade-open, 하드백스톱 유효):', (e as Error)?.message);
    }
    cancelProbe();
    try {
      const r = await approve(
        { tid: activeCfg.tid, merno: activeCfg.merno, catPort: activeCfg.catPort, amount: leg.amount, clinicId, customerId, checkInId },
        supabaseAttemptStore,
      );
      if (!mounted.current) return;
      setSession((s) => (s ? applyLegResult(s, legIndex, r) : s));
      setPhase('review');
    } catch (e) {
      if (!mounted.current) return;
      // 예외(조립/통신) → 안전측: attention 성 정지(자동 재시도 금지). failed 로 반영하지 않는다(승인 성립 배제 불가).
      setSession((s) => (s ? applyLegResult(s, legIndex, {
        classification: 'ATTENTION', msgTrace: '', response: null, userMessage: '통신 오류로 결과를 확인하지 못했습니다. 단말기 [승인내역조회]로 확인해 주세요.',
        needsCheck: true, authNo: null, approvalDate: null, approvalTime: null,
      }) : s));
      setPhase('review');
      console.error('분할 레그 결제 오류:', (e as Error)?.message);
    }
  }

  // [재시도] — 실패(failed) 레그만 pending 으로 되돌린다(승인분·attention 불변). 이후 사람이 다시 [결제 요청].
  function retryFailedLegs() {
    if (!session || !view) return;
    let s = session;
    for (const idx of view.options.retryableLegs) s = resetLegForRetry(s, idx);
    setSession(s);
    setPhase('idle');
  }

  // [승인분 취소] — 사람이 명시적으로 고른 승인 레그 1건을 0430 취소(원거래 AUTHNO). per-leg confirm.
  async function cancelApprovedLeg(legIndex: number) {
    if (!session) return;
    const leg = session.legs.find((l) => l.index === legIndex && l.outcome === 'approved');
    if (!leg || !leg.authNo) return;
    const activeCfg = getTerminalConfig();
    if (!activeCfg) { setPayBlock('단말기 설정이 완료되지 않아 취소를 진행할 수 없습니다.'); return; }
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && !window.confirm(`승인번호 ${leg.authNo} (${formatAmount(leg.amount)}원) 결제를 취소할까요? 카드사 취소 전문이 단말기로 전송됩니다.`)) return;
    setPayBlock(null);
    setPhase('cancelling');
    try {
      const r = await cancel(
        { tid: activeCfg.tid, merno: activeCfg.merno, catPort: activeCfg.catPort, amount: leg.amount, clinicId, customerId, checkInId, originalAuthNo: leg.authNo, originalAuthDate: leg.approvalDate ?? undefined },
        supabaseAttemptStore,
      );
      if (!mounted.current) return;
      if (r.classification === 'APPROVED' && !r.needsCheck) {
        setSession((s) => (s ? markLegCancelled(s, legIndex) : s));
      } else {
        // 취소 응답 불명/실패 → 승인분 그대로 유지(자동 재시도 금지). 사람이 단말기로 확인.
        setPayBlock(r.userMessage || '취소 결과를 확인하지 못했습니다. 단말기 [승인내역조회]로 확인해 주세요.');
      }
      setPhase('review');
    } catch (e) {
      if (!mounted.current) return;
      setPayBlock('취소 통신 오류. 단말기 [승인내역조회]로 확인해 주세요.');
      setPhase('review');
      console.error('분할 레그 취소 오류:', (e as Error)?.message);
    }
  }

  // [유지] / [완료] — 현재 상태(승인분 확정, 잔액=미수)로 세션 종결. 상위 통지 후 닫기.
  function settleAndClose() {
    if (view) {
      onSettled?.({
        status: view.status,
        approvalNumbers: view.approvals.approvalNumbers,
        approvedTotal: view.options.approvedTotal,
        outstanding: view.options.outstanding,
      });
    }
    setOpen(false);
  }

  const busy = phase === 'sending' || phase === 'cancelling';
  const opt = view?.options;

  const entry = (
    <>
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
        disabled={!customerId || prechecking || totalAmount <= 0}
        data-testid="btn-cband-split-entry"
        onClick={onEntryClick}
      >
        {prechecking ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> 확인 중…</>) : (
          <>
            <CreditCard className="h-3.5 w-3.5" /> 카드 단말 분할결제(코밴)
            <span className="ml-1 rounded-sm bg-amber-100 px-1 py-px text-[10px] font-bold uppercase leading-none tracking-wide text-amber-700" data-testid="cband-split-beta-badge">
              BETA
            </span>
          </>
        )}
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
        <DialogContent className="sm:max-w-md" data-testid="cband-split-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-emerald-600" /> 카드 단말 분할결제(코밴)
            </DialogTitle>
          </DialogHeader>

          {/* 동시결제 하드락 차단(첫 진입) — 자동 진행 금지, 닫기만 */}
          {concurrency && (
            <div className="space-y-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-4" data-testid="cband-split-concurrency">
              <div className="flex items-center gap-2 text-amber-800">
                <Users className="h-6 w-6" />
                <span className="text-lg font-bold">
                  {concurrency.reason === 'patient_completed' ? '이미 결제된 환자' : '결제 진행 중'}
                </span>
              </div>
              <p className="text-sm text-amber-900" data-testid="cband-split-concurrency-msg">{concurrency.userMessage}</p>
              <p className="text-xs text-amber-700">※ 중복 결제를 막기 위해 분할결제를 시작하지 않았습니다.</p>
            </div>
          )}

          {!concurrency && view && opt && (
            <div className="space-y-3 py-1">
              {/* 진행 요약 */}
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="text-gray-600">총 예정</span>
                <span className="font-bold tabular-nums text-gray-800" data-testid="cband-split-total">{formatAmount(totalAmount)}원</span>
              </div>

              {/* 레그별 상태 */}
              <div className="space-y-1.5" data-testid="cband-split-legs">
                {session!.legs.map((leg) => (
                  <div key={leg.index} className="flex items-center gap-2 rounded border px-2.5 py-2 text-sm" data-testid={`cband-split-leg-${leg.index}`}>
                    <span className="w-6 shrink-0 text-center text-xs font-medium text-gray-400">{leg.index + 1}</span>
                    <span className="flex-1 tabular-nums">{formatAmount(leg.amount)}원</span>
                    {leg.outcome === 'approved' && (
                      <span className="flex items-center gap-1 text-xs font-medium text-emerald-700" data-testid={`cband-split-leg-approved-${leg.index}`}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> 승인 {leg.authNo}
                      </span>
                    )}
                    {leg.outcome === 'pending' && <span className="text-xs text-gray-400">대기</span>}
                    {leg.outcome === 'failed' && <span className="flex items-center gap-1 text-xs font-medium text-rose-700"><XCircle className="h-3.5 w-3.5" /> 실패</span>}
                    {leg.outcome === 'attention' && <span className="flex items-center gap-1 text-xs font-medium text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> 확인 필요</span>}
                    {leg.outcome === 'cancelled' && <span className="flex items-center gap-1 text-xs font-medium text-gray-500"><Ban className="h-3.5 w-3.5" /> 취소됨</span>}
                  </div>
                ))}
              </div>

              {phase === 'sending' && (
                <div className="flex items-center justify-center gap-2 rounded-lg bg-emerald-50 py-3 text-emerald-700">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">카드 단말에서 결제를 진행해 주세요…</span>
                </div>
              )}
              {phase === 'cancelling' && (
                <div className="flex items-center justify-center gap-2 rounded-lg bg-amber-50 py-3 text-amber-700">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">카드 단말에서 취소를 진행해 주세요…</span>
                </div>
              )}

              {/* 🔴 부분결제 정지 — 사람 판단 3옵션 (자동취소 금지 명시) */}
              {opt.isPartial && !busy && (
                <div className="space-y-2.5 rounded-lg border-2 border-amber-300 bg-amber-50 p-3" data-testid="cband-split-partial">
                  <div className="flex items-start gap-2 text-amber-800">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <p className="text-sm" data-testid="cband-split-partial-msg">{opt.userMessage}</p>
                  </div>
                  <div className="flex items-center justify-between rounded bg-white/70 px-2.5 py-1.5 text-xs">
                    <span className="text-gray-500">이미 승인 {formatAmount(opt.approvedTotal)}원 · 남은 잔액 {formatAmount(opt.outstanding)}원</span>
                  </div>
                  {opt.attentionLegs.length > 0 && (
                    <p className="text-xs text-amber-700">※ 확인 필요 건은 다시 결제하지 마세요. 단말기 [승인내역조회]로 먼저 확인해 주세요.</p>
                  )}
                  <div className="grid grid-cols-1 gap-1.5">
                    {opt.retryableLegs.length > 0 && (
                      <Button variant="outline" className="h-11 justify-start gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={retryFailedLegs} data-testid="btn-cband-split-retry">
                        <RotateCcw className="h-4 w-4" /> 재시도 — 실패한 결제만 다시 보내기
                      </Button>
                    )}
                    {opt.cancellableApprovedLegs.map((idx) => {
                      const l = session!.legs.find((x) => x.index === idx);
                      return (
                        <Button key={idx} variant="outline" className="h-11 justify-start gap-2 border-rose-300 text-rose-700 hover:bg-rose-50" onClick={() => cancelApprovedLeg(idx)} data-testid={`btn-cband-split-cancel-${idx}`}>
                          <Ban className="h-4 w-4" /> 승인분 취소 — {formatAmount(l?.amount ?? 0)}원 (승인 {l?.authNo})
                        </Button>
                      );
                    })}
                    <Button variant="outline" className="h-11 justify-start gap-2 border-slate-300 text-slate-700 hover:bg-slate-100" onClick={settleAndClose} data-testid="btn-cband-split-keep">
                      <Save className="h-4 w-4" /> 이대로 유지 — 잔액 {formatAmount(opt.outstanding)}원은 별도 수납
                    </Button>
                  </div>
                </div>
              )}

              {view.status === 'completed' && !busy && (
                <div className="space-y-1 rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3" data-testid="cband-split-completed">
                  <div className="flex items-center gap-2 text-emerald-800">
                    <CheckCircle2 className="h-5 w-5" /> <span className="font-bold">분할결제 완료</span>
                  </div>
                  <p className="text-xs text-emerald-900">승인번호 {view.approvals.approvalNumbers.join(', ')} · 합계 {formatAmount(view.approvals.total)}원</p>
                </div>
              )}

              {payBlock && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800" data-testid="cband-split-payblock">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <span>{payBlock}</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            {concurrency && (
              <Button variant="outline" className="h-12 flex-1" onClick={() => setOpen(false)} data-testid="btn-cband-split-concurrency-close">닫기</Button>
            )}
            {!concurrency && view && (
              <>
                {/* 다음 레그 전송(정지 상태·완료 아닐 때만 활성) */}
                {view.canSendNext && (
                  <Button className="h-14 flex-1 bg-emerald-600 text-lg hover:bg-emerald-700" disabled={busy} onClick={sendNextLeg} data-testid="btn-cband-split-send">
                    {busy ? '진행 중…' : `${(view.nextLegIndex ?? 0) + 1}번 결제 요청`}
                  </Button>
                )}
                {view.status === 'completed' && (
                  <Button variant="outline" className="h-12 flex-1" onClick={settleAndClose} data-testid="btn-cband-split-done">완료</Button>
                )}
                {(view.status === 'failed' || (view.status === 'idle' && !view.canSendNext)) && !busy && (
                  <Button variant="outline" className="h-12 flex-1" onClick={() => setOpen(false)} data-testid="btn-cband-split-close">닫기</Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  // 미설정/미연결 게이트 — 분할결제는 단일결제로 단말이 이미 세팅된 PC 전제. 안내만 노출(설정창 중복 창안 금지).
  if (!hasCfg) {
    return (
      <div className="w-full space-y-1" data-testid="cband-split-gate-nocfg">
        <Button variant="outline" size="sm" className="w-full gap-1 border-gray-300 text-gray-400" disabled>
          <CreditCard className="h-3.5 w-3.5" /> 카드 단말 분할결제(코밴)
        </Button>
        <div className="flex items-start gap-1.5 px-0.5 text-xs text-gray-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span>카드 단말기(TID/COM)가 이 PC에 설정되어 있지 않습니다. 카드 단일 결제 창에서 먼저 설정해 주세요.</span>
        </div>
      </div>
    );
  }
  if (probe === null || probe === 'awaiting' || probe === 'blocked') {
    const msg = probe === null ? '카드 단말기를 확인하는 중입니다…'
      : probe === 'awaiting' ? '브라우저에서 단말기 연결 권한을 허용해 주세요.'
      : '카드 단말기에 연결하지 못했습니다. 단말기 프로그램 실행 여부를 확인해 주세요.';
    return (
      <div className="w-full space-y-1" data-testid="cband-split-gate-probe">
        <Button variant="outline" size="sm" className="w-full gap-1 border-gray-300 text-gray-400" disabled>
          <CreditCard className="h-3.5 w-3.5" /> 카드 단말 분할결제(코밴)
        </Button>
        <div className="flex items-start gap-1.5 px-0.5 text-xs text-gray-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="flex-1">{msg}</span>
          {probe !== null && (
            <button type="button" className="shrink-0 font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800" onClick={runProbe} data-testid="btn-cband-split-reprobe">다시 확인</button>
          )}
        </div>
      </div>
    );
  }

  return entry;
}
