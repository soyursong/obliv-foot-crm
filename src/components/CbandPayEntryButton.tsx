/**
 * CbandPayEntryButton.tsx — 코밴 CAT 직결 결제 진입 버튼 + 결제 다이얼로그 (기능플래그·단말감지 게이트)
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD (플랜A · FE)
 *
 * ★ 대원칙: 기존 결제 화면 무접촉. 결제·이중결제방지·전문 로직은 불변, 바뀌는 건 'FE 렌더 조건'뿐.
 *   ① 기능플래그 VITE_CBAND_PAY ON (기본 OFF — DDL 적용 전 프로덕션 노출 0). OFF 인 PC 만 완전 숨김.
 *   ② 로컬 단말 설정(TID/MERNO/CAT_PORT) 존재 (실측#1: 없으면 결제 불가)
 *   ③ probeTerminal() = 단말 데몬 구동중 판정(ws://127.0.0.1:8888 접속 1회).
 *
 * ── ★ T-20260803-foot-CBAND-PAYBTN-DISABLED-TOOLTIP (미연결 시 숨김→비활성) ──────────────
 *   미연결/미설정(TID 미등록·탐지중·권한대기·연결실패)에서 버튼을 '숨김'이 아니라 '비활성 버튼 +
 *   마우스오버 툴팁 + 버튼 아래 상시 1줄 사유'로 렌더한다. "왜 못 누르는지"가 항상 보이게(AC-6).
 *   6-상태 표는 아래 cbandGateCopy 위 주석 참조. db_change=false.
 *
 * ── ★ T-20260803-foot-CBAND-TIDCOM-POPUP-PLACEMENT ② (TID/COM 팝업을 결제 Dialog 안으로) ──
 *   결제 Dialog(카드결제 버튼 클릭 시 창) 안에 단말기 TID·COM 설정 인라인 패널(CbandTerminalConfigInline)을
 *   저장여부 무관 항상 표시. 저장 시 요약 한 줄(`단말기 {TID} · COM {n} [변경]`)로 접힌다.
 *   CONFLICT#1 reconcile(§8): 위 6-상태 표의 disable 중 'TID 미등록(!hasCfg)'만 '활성'으로 분리해
 *   Dialog 를 열 수 있게 한다(창 안에서 TID/COM 입력 → chicken-egg 방지). daemon 미연결·권한차단은 유지.
 *   빈값(TID) 전송 차단은 onApprove 에서(“단말기 번호를 먼저 입력해 주세요”). db_change=false.
 *
 * ── ★ 현장 보강(총괄 MSG-151826) — 구현 불변식 2건 ─────────────────────────────
 *   DELTA 1: 통신속도(baud/COM speed) 입력 칸 미노출. baud=38400 고정(값 계승만, config/protocol).
 *            팝업 입력 필드는 `단말기 TID`+`COM 포트` 2칸만 — 3칸(+통신속도) 금지.
 *   DELTA 2: TID 자동획득(auto-fetch) 불가 확정. 데몬 응답 어디에도 TID 없음(MERNO=가맹점번호만).
 *            데몬 응답을 파싱해 TID 를 자동 세팅하는 경로 신설 금지 — 사람이 직접 조회·입력(수동입력)만.
 *
 * 태블릿 UX: teal-emerald · 큰 버튼 · 천단위 콤마 · 한국어. (풋센터 표준)
 *
 * ── ★ 이중결제 방지 UX(D) ──────────────────────────────────────────────────
 *   결과가 '확인 필요'(ATTENTION)면 자동 재시도 버튼을 주지 않고 정지 화면만 노출한다.
 *   화면에 MSG_TRACE 를 크게 띄워 단말 [승인내역조회]로 확인하도록 안내.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CreditCard, AlertTriangle, CheckCircle2, Loader2, XCircle, Users, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { AmountInput, parseAmountRaw } from '@/components/ui/AmountInput';
import { formatAmount } from '@/lib/format';
import {
  isCbandPayEnabled, approve, precheckConcurrentPayment,
  type PaymentFlowResult, type ConcurrencyDecision,
} from '@/lib/cband/paymentFlow';
import { supabaseAttemptStore } from '@/lib/cband/supabaseAttemptStore';
import { probeTerminal, cancelProbe, type ProbeResult } from '@/lib/cband/catClient';
import { getTerminalConfig, getTerminalConfigRaw, saveTerminalConfig } from '@/lib/cband/config';
import { cbandGateCopy, type CbandGateKind } from '@/lib/cband/gateCopy';

interface Props {
  checkInId: string;
  clinicId: string;
  customerId: string | null;
  /**
   * ★T-20260803-foot-CBAND-DIRECTPAY-PREDEPLOY-5FIX ① — 외부(수납창) 게이팅.
   * true 면 결제 진입을 비활성 렌더(사유 1줄 노출) 한다. 분할결제 선택 시 등 '카드 단일결제가 아닐 때'
   * 상위(PaymentMiniWindow)가 전달. ★결제·전문·이중결제방지 로직 무접촉 — 진입 버튼 렌더 조건만.
   */
  disabled?: boolean;
  /** disabled=true 일 때 버튼 아래 상시 노출할 사유 1줄. */
  disabledReason?: string;
}

/**
 * 비활성 상태의 코밴 직결결제 버튼 + 툴팁 + 상시 1줄 사유.
 *  · 신규 npm 의존성 없이 경량 CSS(group-hover / group-focus-within)로 툴팁 구현.
 *  · disabled 버튼은 pointer-events-none 이라 hover 미발생 → 래퍼 span(group)에 hover/focus·title 을 건다.
 *  · ★AC-6: 마우스오버 없이도 버튼 아래 1줄 사유를 상시 노출(놓침 방지).
 */
function CbandGateButton({ kind, onRetry }: { kind: CbandGateKind; onRetry: () => void }) {
  const copy = cbandGateCopy(kind);
  return (
    <div className="w-full space-y-1" data-testid={copy.testid}>
      <div className="group relative w-full">
        <span className="block w-full" tabIndex={0} aria-label={copy.tooltip} title={copy.tooltip}>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1 border-gray-300 text-gray-400"
            disabled
            data-testid="btn-cband-pay-entry-disabled"
          >
            <CreditCard className="h-3.5 w-3.5" /> 카드 단말 결제(코밴)
            <span
              className="ml-1 rounded-sm bg-gray-200 px-1 py-px text-[10px] font-bold uppercase leading-none tracking-wide text-gray-500"
              data-testid="cband-beta-badge-disabled"
            >
              BETA
            </span>
          </Button>
        </span>
        {/* 마우스오버(또는 포커스) 툴팁 — 경량 CSS, 신규 의존성 없음 */}
        <div
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-72 max-w-[90vw] -translate-x-1/2 rounded-md bg-gray-900 px-3 py-2 text-xs leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
          data-testid="cband-gate-tooltip"
        >
          {copy.tooltip}
        </div>
      </div>
      {/* ★AC-6: 상시 1줄 사유(마우스오버 불필요) + (해당 시) [다시 확인] */}
      <div className="flex items-start gap-1.5 px-0.5 text-xs text-gray-500">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span className="flex-1" data-testid="cband-gate-reason">{copy.reason}</span>
        {copy.retryable && (
          <button
            type="button"
            className="shrink-0 font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
            data-testid="btn-cband-reprobe"
            onClick={onRetry}
          >
            다시 확인
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * ★T-20260803-foot-CBAND-TIDCOM-POPUP-PLACEMENT ② — 코밴 결제 Dialog 안 단말기 설정 인라인 패널.
 *  · 위치: 카드결제 창(Dialog) 안. 저장여부 무관 모든 PC에서 항상 표시(입력/전송 화면 상단).
 *  · 입력란 = `단말기 TID` + `COM 포트` (2필드) + [저장] 버튼 1개. (⑧ AdminSettings 의 MERNO 는 계승·비노출)
 *    ★DELTA 1: 통신속도(baud) 입력 칸 없음 — baud=38400 고정(값 계승만). 3칸 금지.
 *    ★DELTA 2: TID 는 수동입력만 — 데몬 응답에 TID 없음(자동획득 경로 신설 금지).
 *  · 프리필: localStorage `cband.terminal.config`(TERMINAL 티켓 deployed) 있으면 자동채움, 없으면 빈칸.
 *  · 저장됨(TID·COM 둘 다 있음): `단말기 {TID} · COM {n} [변경]` 한 줄 읽기전용. [변경] → 입력모드.
 *  · 규칙 계승(재정의 X): zero-pad·baud 38400·빈값차단 = TERMINAL 티켓(config/protocol). merno 는 ⑧/env 보존.
 */
function CbandTerminalConfigInline({ onSaved }: { onSaved: () => void }) {
  const raw = getTerminalConfigRaw();
  const savedTid = raw.tid;
  const savedPort = raw.catPort;
  // ② 저장여부 판정은 팝업 2필드(TID·COM) 기준. MERNO 는 팝업이 다루지 않음(⑧/env 계승).
  const hasSaved = savedTid !== '' && savedPort !== '';
  // ★T-20260803-foot-CBAND-TIDCOM-TERMINAL-NOSETUP — "TID·COM 입력했는데 단말 설정이 안됨" 진단 fix.
  //   원인축(CRM-side legibility trap): 팝업은 TID·COM 2필드만 다루고 MERNO 는 ⑧/env 계승(DELTA1 유지).
  //   그런데 결제 게이트 getTerminalConfig() 는 TID·MERNO·COM **3값 모두** 있어야 non-null(config.ts §41).
  //   → MERNO 미설정(env 없음 + ⑧ 미입력) PC 에서 팝업으로 TID·COM 만 저장하면 요약줄은 '저장됨'처럼 보이나
  //     결제요청 시 getTerminalConfig()=null 로 차단된다("단말기 설정이 완료되지 않았습니다"). [변경]은 TID·COM 만
  //     다뤄 MERNO 를 못 채우는 dead-end. 여기서는 그 은닉된 진짜 블로커(MERNO 미설정)를 명시적으로 노출한다.
  //   ★스펙 준수: 팝업에 MERNO 입력칸을 추가하지 않는다(DELTA1 2필드 유지) — '어디서 고치는지'만 안내.
  const mernoMissing = raw.merno === '';
  const [editing, setEditing] = useState(!hasSaved);
  const [tid, setTid] = useState(savedTid);
  const [port, setPort] = useState(savedPort);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = () => {
    const t = tid.trim();
    const p = port.trim();
    // 빈값차단(TERMINAL 티켓 계승) — TID·COM 필수.
    if (!t) { setErr('단말기 번호(TID)를 입력해 주세요.'); return; }
    if (!p) { setErr('COM 포트 번호를 입력해 주세요.'); return; }
    // ★merno 계승(재정의 X): ⑧ 설정/ENV 값을 보존해 저장(팝업은 TID·COM 만 다룸).
    saveTerminalConfig({ tid: t, merno: getTerminalConfigRaw().merno, catPort: p });
    setErr(null);
    setEditing(false);
    onSaved();
  };

  if (!editing) {
    return (
      <div className="space-y-1.5">
        <div
          className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
            mernoMissing
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
          data-testid="cband-terminal-config-summary"
        >
          <span className="flex items-center gap-1.5">
            <CreditCard className={`h-4 w-4 shrink-0 ${mernoMissing ? 'text-amber-600' : 'text-emerald-600'}`} />
            <span data-testid="cband-terminal-summary-text">단말기 {savedTid} · COM {savedPort}</span>
          </span>
          <button
            type="button"
            className="shrink-0 font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
            data-testid="btn-cband-terminal-edit"
            onClick={() => { setTid(getTerminalConfigRaw().tid); setPort(getTerminalConfigRaw().catPort); setErr(null); setEditing(true); }}
          >
            변경
          </button>
        </div>
        {/* ★NOSETUP fix: TID·COM 은 저장됐지만 MERNO 미설정 → 결제 불가. 진짜 블로커를 명시하고 조치 위치(관리자 설정 ⑧) 안내. */}
        {mernoMissing && (
          <div
            className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            data-testid="cband-terminal-merno-missing"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span>
              가맹점 번호(MERNO)가 아직 설정되지 않아 카드 결제를 시작할 수 없습니다.
              <b> 관리자 설정 → ⑧ 카드 단말기 설정</b> 화면에서 가맹점 번호를 한 번 입력해 주세요.
              (단말기 번호·COM 포트는 저장되었습니다.)
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3" data-testid="cband-terminal-config-edit">
      <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
        <Settings2 className="h-4 w-4 text-gray-500" /> 이 PC 카드 단말기 설정
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs text-gray-600">단말기 TID</label>
          <Input
            value={tid}
            onChange={(e) => setTid(e.target.value)}
            placeholder="예: 1234567890"
            inputMode="numeric"
            autoComplete="off"
            className="h-11 text-base"
            data-testid="cband-terminal-tid-input"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-gray-600">COM 포트</label>
          <Input
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="예: 3 (또는 COM3)"
            autoComplete="off"
            className="h-11 text-base"
            data-testid="cband-terminal-comport-input"
          />
        </div>
      </div>
      {err && <p className="text-xs text-rose-600" data-testid="cband-terminal-config-err">{err}</p>}
      <Button
        type="button"
        variant="outline"
        className="h-10 w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50"
        data-testid="btn-cband-terminal-save"
        onClick={handleSave}
      >
        저장
      </Button>
    </div>
  );
}

// ★AC-6: 'concurrency' = 버튼순간 서버 재확인이 진행중/완료/단말사용중을 감지해 분기 안내를 노출하는 상태.
type UiState = 'idle' | 'sending' | 'approved' | 'failed' | 'attention' | 'concurrency';

export default function CbandPayEntryButton({ checkInId, clinicId, customerId, disabled = false, disabledReason }: Props) {
  // ★U3: probe 결과 3분기 (null=탐지중 / 'ok' / 'awaiting' / 'blocked').
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [ui, setUi] = useState<UiState>('idle');
  const [result, setResult] = useState<PaymentFlowResult | null>(null);
  // ★AC-6-2 동시결제 서버 재확인 결과(팝업 open 직전).
  const [concurrency, setConcurrency] = useState<ConcurrencyDecision | null>(null);
  const [prechecking, setPrechecking] = useState(false);
  // ★T-20260803-foot-CBAND-TIDCOM-POPUP-PLACEMENT ②: Dialog 안 TID/COM 저장 후 재평가용 버전 카운터.
  const [cfgVersion, setCfgVersion] = useState(0);
  // ②: 빈값(TID) 전송 차단 안내(pre-daemon).
  const [payBlock, setPayBlock] = useState<string | null>(null);
  const mounted = useRef(true);

  const cfg = getTerminalConfig();
  // ★AC-4: '기능 노출(플래그)'과 '연결/설정 상태'를 분리. enabled = 기능플래그(ON/OFF)만.
  //  단말기 정보(TID) 미등록(cfg==null)은 '숨김'이 아니라 6-상태 표의 비활성 상태(②)로 처리한다.
  const enabled = isCbandPayEnabled();
  const hasCfg = cfg != null;

  // ③ 단말 감지 — probeTerminal(열고 닫기만). ★U3 3분기 결과를 그대로 반영.
  const runProbe = useCallback(() => {
    setProbe(null); // 탐지중
    probeTerminal().then((r) => { if (mounted.current) setProbe(r); });
  }, []);

  useEffect(() => {
    mounted.current = true;
    // ★AC-4: TID 미등록(cfg 없음) PC 는 탐지하지 않는다(더 근본 차단 = ② 상태). 플래그 ON + cfg 있을 때만 탐지.
    // ★①: 외부 disabled(분할결제 등)면 단말 탐지 자체를 건너뜀(불필요한 소켓·권한창 방지).
    if (!enabled || !hasCfg || disabled) return;
    runProbe();
    // ★U2: 언마운트 시 잔여 탐침 소켓 정리(동시 1개 보장).
    return () => { mounted.current = false; cancelProbe(); };
    // ②: cfgVersion — Dialog 안에서 TID/COM 저장(설정 완성)되면 즉시 재탐지.
  }, [enabled, hasCfg, disabled, cfgVersion, runProbe]);

  // ②: Dialog 안 TID/COM 패널 저장 후 config 재평가(+ 차단 안내 해제).
  const onTerminalSaved = useCallback(() => {
    setPayBlock(null);
    setCfgVersion((v) => v + 1);
  }, []);

  // 게이트 ①(기능플래그): 플래그 OFF 인 PC(=기능 미도입)에서만 완전 숨김.
  //  ※ '미연결/미설정(TID·데몬·권한)'은 더 이상 숨기지 않는다 → 아래 6-상태 표대로 비활성+툴팁+1줄사유.
  if (!enabled) return null;

  // ★① 외부 게이팅(수납창) — 분할결제 등 '카드 단일결제가 아닐 때' 비활성 진입 버튼 + 사유 1줄.
  //   결제·전문·이중결제방지 로직 무접촉(진입 렌더만). 플래그 ON PC 에서만 도달(위 !enabled 이후).
  if (disabled) {
    return (
      <div className="w-full space-y-1" data-testid="cband-entry-disabled-ext">
        <span
          className="block w-full"
          title={disabledReason ?? '지금은 카드 단말 결제를 사용할 수 없습니다.'}
        >
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1 border-gray-300 text-gray-400"
            disabled
            data-testid="btn-cband-pay-entry-disabled"
          >
            <CreditCard className="h-3.5 w-3.5" /> 카드 단말 결제(코밴)
            <span className="ml-1 rounded-sm bg-gray-200 px-1 py-px text-[10px] font-bold uppercase leading-none tracking-wide text-gray-500">
              BETA
            </span>
          </Button>
        </span>
        {disabledReason && (
          <div className="flex items-start gap-1.5 px-0.5 text-xs text-gray-500">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span className="flex-1" data-testid="cband-disabled-reason">{disabledReason}</span>
          </div>
        )}
      </div>
    );
  }

  const amountNum = parseInt(parseAmountRaw(amount) || '0', 10);
  const canPay = amountNum > 0 && ui !== 'sending';

  async function onApprove() {
    if (!(amountNum > 0)) return;
    // ★② 빈값 전송 차단(pre-daemon): TID 미입력이면 결제 전문 전송 이전에 정지 + 안내.
    const rawCfg = getTerminalConfigRaw();
    if (!rawCfg.tid) { setPayBlock('단말기 번호를 먼저 입력해 주세요.'); return; }
    // TID 는 있으나 설정 미완(merno 등, ⑧에서 보정) → 전송 차단 + 설정 안내.
    // ★NOSETUP fix: 미완 원인이 MERNO 면 [변경](TID·COM 만)=dead-end → 정확한 조치 위치(관리자 설정 ⑧) 안내.
    const activeCfg = getTerminalConfig();
    if (!activeCfg) { const mernoMissing = !getTerminalConfigRaw().merno; setPayBlock(mernoMissing ? '가맹점 번호(MERNO)가 설정되지 않아 결제를 시작할 수 없습니다. 관리자 설정 → ⑧ 카드 단말기 설정 화면에서 가맹점 번호를 입력해 주세요. (단말기 번호·COM 포트는 이미 저장됨)' : '단말기 설정이 완료되지 않았습니다. 위 [변경]에서 확인하거나 관리자 설정을 완료해 주세요.'); return; }
    setPayBlock(null);
    setUi('sending');
    setResult(null);
    cancelProbe(); // ★U2: 결제 소켓 열기 전 탐침 소켓 확실히 종료(동시 1개). send 내부에서도 재호출됨.
    try {
      const r = await approve(
        { tid: activeCfg.tid, merno: activeCfg.merno, catPort: activeCfg.catPort, amount: amountNum, clinicId, customerId, checkInId },
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
    setConcurrency(null);
    setPayBlock(null);
  }

  // ★AC-6-2: 결제 버튼 클릭 순간 서버 재확인(팝업 open 직전) → 진행중/완료/단말사용중이면 분기 안내.
  //   client 상태 불신(두 실장=다른 브라우저) → 서버 재확인이 유일 방어. 미감지면 정상 결제 팝업.
  async function onEntryClick() {
    reset();
    setPrechecking(true);
    let decision: ConcurrencyDecision = { blocked: false, reason: null, allowOverride: false, userMessage: '' };
    try {
      decision = await precheckConcurrentPayment(
        { clinicId, checkInId, merno: cfg?.merno ?? null },
        supabaseAttemptStore,
      );
    } catch (e) {
      // degrade-open: 재확인 실패해도 하드백스톱(insert-first L2)이 유효 → 정상 진행.
      console.error('동시결제 재확인 실패(degrade-open):', (e as Error)?.message);
    }
    if (!mounted.current) return;
    setPrechecking(false);
    if (decision.blocked) {
      setConcurrency(decision);
      setUi('concurrency');
    } else {
      setUi('idle');
    }
    setOpen(true);
  }

  // ★AC-6-2 완료건 재결제: 실장 confirm(그래도 진행) → 정상 결제 입력으로 전환.
  function overrideConcurrency() {
    setConcurrency(null);
    setUi('idle');
  }

  // ★AC-4 6-상태 표 — 미연결/미설정은 '숨김' 대신 비활성 버튼 + 툴팁 + 상시 1줄 사유(AC-6).
  //  ② TID 미등록 → ③ 탐지중(probe null) → ④ 권한대기(awaiting) → ⑤ 연결실패(blocked) → ⑥ 연결됨(ok, 활성)
  //  ⑤ blocked: 권한차단·데몬미실행 두 원인은 WS close 1006 으로 코드 구분 불가 → 툴팁에 두 조치를 함께 안내.
  //
  // ★T-20260803-foot-CBAND-TIDCOM-POPUP-PLACEMENT ② / CONFLICT#1 reconcile(§8):
  //   PAYBTN-DISABLED-TOOLTIP 의 버튼 disable 중 'TID 미등록(!hasCfg)'만 '활성'으로 분리한다.
  //   → Dialog 를 열어 창 안(CbandTerminalConfigInline)에서 TID/COM 을 입력할 수 있게(chicken-egg 방지).
  //   'daemon 미연결·권한차단(awaiting/blocked)' disable 은 그대로 유지(hasCfg 일 때만 탐지·게이트).
  //   ※ 빈값 전송 차단은 onApprove(②)에서 담당.
  const entryAndDialog = (
    <>
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
        disabled={!customerId || prechecking}
        data-testid="btn-cband-pay-entry"
        onClick={onEntryClick}
      >
        {prechecking
          ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> 확인 중…</>)
          : (
            <>
              <CreditCard className="h-3.5 w-3.5" /> 카드 단말 결제(코밴)
              {/* T-20260803-foot-CBAND-DIRECTPAY-BETA-BADGE AC-1: 첫 도입 시범 표시. 안정화 후 별도 티켓으로 제거. */}
              <span
                className="ml-1 rounded-sm bg-amber-100 px-1 py-px text-[10px] font-bold uppercase leading-none tracking-wide text-amber-700"
                data-testid="cband-beta-badge"
              >
                BETA
              </span>
            </>
          )}
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (ui !== 'sending') setOpen(v); }}>
        <DialogContent className="sm:max-w-md" data-testid="cband-pay-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-emerald-600" /> 카드 단말 결제(코밴)
              {/* T-20260803-foot-CBAND-DIRECTPAY-BETA-BADGE AC-1: 시범 표시(버튼과 동일 맥락). */}
              <span
                className="rounded-sm bg-amber-100 px-1 py-px text-[10px] font-bold uppercase leading-none tracking-wide text-amber-700"
                data-testid="cband-beta-badge-dialog"
              >
                BETA
              </span>
            </DialogTitle>
          </DialogHeader>

          {/* 입력/전송 */}
          {(ui === 'idle' || ui === 'sending') && (
            <div className="space-y-4 py-2">
              {/* ★② 코밴 결제 Dialog 안 단말기 설정(TID/COM) — 저장여부 무관 항상 표시 */}
              <CbandTerminalConfigInline onSaved={onTerminalSaved} />
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
              {/* ★② 빈값(TID) 전송 차단 안내 — 결제요청 눌렀는데 단말기 번호 미입력 시 */}
              {payBlock && ui === 'idle' && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800" data-testid="cband-payblock">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <span>{payBlock}</span>
                </div>
              )}
              {ui === 'sending' && (
                <div className="flex items-center justify-center gap-2 rounded-lg bg-emerald-50 py-4 text-emerald-700">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">카드 단말에서 결제를 진행해 주세요…</span>
                </div>
              )}
            </div>
          )}

          {/* ★AC-6-2 동시결제 분기 — 진행중/완료/단말사용중. 자동 진행 금지, confirm 유도 */}
          {ui === 'concurrency' && concurrency && (
            <div className="space-y-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-4" data-testid="cband-concurrency">
              <div className="flex items-center gap-2 text-amber-800">
                <Users className="h-6 w-6" />
                <span className="text-lg font-bold">
                  {concurrency.reason === 'patient_completed' ? '이미 결제된 환자' : '결제 진행 중'}
                </span>
              </div>
              <p className="text-sm text-amber-900" data-testid="cband-concurrency-msg">{concurrency.userMessage}</p>
              {!concurrency.allowOverride && (
                <p className="text-xs text-amber-700">※ 중복 결제를 막기 위해 결제를 시작하지 않았습니다.</p>
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
            {/* ★AC-6-2 동시결제 분기: 진행중/단말사용중=닫기만(진행 불가). 완료건=confirm 후 진행 허용. */}
            {ui === 'concurrency' && concurrency && (
              <>
                <Button
                  variant="outline"
                  className="h-12 flex-1"
                  onClick={() => setOpen(false)}
                  data-testid="btn-cband-concurrency-close"
                >
                  닫기
                </Button>
                {concurrency.allowOverride && (
                  <Button
                    className="h-12 flex-1 bg-emerald-600 hover:bg-emerald-700"
                    onClick={overrideConcurrency}
                    data-testid="btn-cband-concurrency-override"
                  >
                    확인, 그래도 결제
                  </Button>
                )}
              </>
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

  // ② reconcile: TID 미등록(!hasCfg)은 '활성' 진입 버튼 + Dialog(창 안 TID/COM 입력)로 분리.
  if (!hasCfg) return entryAndDialog;
  // 나머지 미연결/미설정 상태(daemon 탐지중/권한대기/연결실패)는 비활성 게이트 유지.
  if (probe === null) return <CbandGateButton kind="probing" onRetry={runProbe} />;
  if (probe === 'awaiting') return <CbandGateButton kind="awaiting" onRetry={runProbe} />;
  if (probe === 'blocked') return <CbandGateButton kind="blocked" onRetry={runProbe} />;

  // probe === 'ok' → 활성 결제 버튼 + 다이얼로그
  return entryAndDialog;
}
