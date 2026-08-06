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
// ★T-20260805-foot-PLANA-INSTALLMENT-HALBU-SUPPORT — 할부 최소금액(5만원, spec ①) + 한글표기 파생 SSOT.
// ★T-20260806-foot-PLANA-PKG-PAY-EXPAND(AC-2) — 건당 500만원 초과 사전차단 순수 술어 + 안내문구 SSOT.
import {
  CBAND_INSTALLMENT_MIN_AMOUNT, formatInstallmentKo,
  exceedsPerTxnLimit, perTxnLimitBlockMessage,
} from '@/lib/cband/protocol';
import {
  isCbandPayEnabled, approve, precheckConcurrentPayment,
  type PaymentFlowResult, type ConcurrencyDecision,
} from '@/lib/cband/paymentFlow';
import { supabaseAttemptStore } from '@/lib/cband/supabaseAttemptStore';
import { probeTerminal, cancelProbe, type ProbeResult } from '@/lib/cband/catClient';
import { getTerminalConfig, getTerminalConfigRaw, saveTerminalConfig } from '@/lib/cband/config';
import { cbandGateCopy, type CbandGateKind } from '@/lib/cband/gateCopy';
// ★T-20260804-foot-CBAND-PAYMODAL-AMOUNT-AUTOFILL: 미납잔액 default value 파생 SSOT(순수·≤0 스킵).
import { resolveCbandDefaultAmount } from '@/lib/cband/prefillAmount';
// ★T-20260805-foot-PLANA-PERSEAT-TID-REGISTRY-GATE — per-seat TID 를 registry allowlist 와 대조(AC-1),
//   미등록이면 soft-warn + 구조화 로깅(AC-2), 관리자 override escape hatch(AC-3). 결제 흐름 무차단(soft).
import {
  checkSeatTidRegistered, isTidGateOverridden, setTidGateOverride, logUnregisteredTid,
  getSeatId, type TidRegistryVerdict,
} from '@/lib/cband/tidRegistryGate';
import { useAuth } from '@/lib/auth';
import { hasOpsAuthority } from '@/lib/permissions';

/**
 * ★할부 개월 선택지 — T-20260805-foot-PLANA-INSTALLMENT-HALBU-SUPPORT (spec ①·scalp2 INSTALLMENT-BTN-1TO12 준용).
 *   일시불(0) + 2~12개월. 카드 관행상 1개월=일시불 → 1 제외. value=개월수(0=일시불), payments.installment 착지값.
 */
const CBAND_INSTALLMENT_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: '일시불' },
  { value: 2, label: '2개월' },
  { value: 3, label: '3개월' },
  { value: 4, label: '4개월' },
  { value: 5, label: '5개월' },
  { value: 6, label: '6개월' },
  { value: 7, label: '7개월' },
  { value: 8, label: '8개월' },
  { value: 9, label: '9개월' },
  { value: 10, label: '10개월' },
  { value: 11, label: '11개월' },
  { value: 12, label: '12개월' },
] as const;

interface Props {
  /**
   * ★T-20260806-foot-PLANA-PKG-PAY-EXPAND — 패키지 탭 결제는 내원(check_in) 비종속 → nullable.
   *   packageId 모드에서는 null 로 전달(동시성 잠금은 check_in 스코프 → 패키지는 payment_attempt_id 멱등이 1차 방어).
   */
  checkInId?: string | null;
  clinicId: string;
  customerId: string | null;
  /**
   * ★T-20260806-foot-PLANA-PKG-PAY-EXPAND(AC-1) — 비-null 이면 이 CAT 결제는 payments 가 아니라
   *   package_payments 행으로 착지한다(DA(b) canonical · VG-1 firewall). 카드 탭과 동일 버튼(총괄 "패키지 버튼 동일 버튼 생성").
   */
  packageId?: string | null;
  /** ★AC-3: 승인(수납/취소 성립) 후 상위 목록 갱신 콜백(패키지 상세시트 reload). 미전달 = no-op(카드 탭 회귀 0). */
  onApproved?: () => void;
  /**
   * ★T-20260803-foot-CBAND-DIRECTPAY-PREDEPLOY-5FIX ① — 외부(수납창) 게이팅.
   * true 면 결제 진입을 비활성 렌더(사유 1줄 노출) 한다. 분할결제 선택 시 등 '카드 단일결제가 아닐 때'
   * 상위(PaymentMiniWindow)가 전달. ★결제·전문·이중결제방지 로직 무접촉 — 진입 버튼 렌더 조건만.
   */
  disabled?: boolean;
  /** disabled=true 일 때 버튼 아래 상시 노출할 사유 1줄. */
  disabledReason?: string;
  /**
   * ★T-20260804-foot-CBAND-PAYMODAL-AMOUNT-AUTOFILL — 결제 팝업 금액칸 default value(미납잔액=수납잔액).
   *   상위(PaymentMiniWindow)가 SUSU/수납 팝업 잔액 계산(displayAmount=수납잔액) 값을 그대로 내려준다.
   *   팝업 open 시 금액칸에 자동 세팅(오기입 방지). 편집(override) 허용 — 결제·전문·payments write 무접촉(초기값만).
   *   ≤0(또는 미전달) → 자동입력 스킵(빈칸 유지, 기존 수동입력 동작 그대로).
   */
  defaultAmount?: number;
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
      <div
        className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        data-testid="cband-terminal-config-summary"
      >
        <span className="flex items-center gap-1.5">
          <CreditCard className="h-4 w-4 shrink-0 text-emerald-600" />
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

export default function CbandPayEntryButton({ checkInId, clinicId, customerId, disabled = false, disabledReason, defaultAmount, packageId, onApproved }: Props) {
  // ★T-20260804-foot-CBAND-PAYMODAL-AMOUNT-AUTOFILL: 미납잔액 default value(팝업 open/reset 시 금액칸 초기값).
  //   >0 일 때만 자동입력, ≤0/미전달 → 빈칸(수동입력) 유지. resolveCbandDefaultAmount = 쉼표없는 raw 정수문자열
  //   (AmountInput 이 표시 포맷 담당). 결제·payments write 로직 무접촉(초기값만).
  const defaultAmountStr = resolveCbandDefaultAmount(defaultAmount);
  // ★U3: probe 결과 3분기 (null=탐지중 / 'ok' / 'awaiting' / 'blocked').
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  // ★T-20260805-foot-PLANA-INSTALLMENT-HALBU-SUPPORT — 할부 개월(0=일시불). 5만원↓/일시불이면 HALBU='00' 전송.
  const [installment, setInstallment] = useState(0);
  const [ui, setUi] = useState<UiState>('idle');
  const [result, setResult] = useState<PaymentFlowResult | null>(null);
  // ★AC-6-2 동시결제 서버 재확인 결과(팝업 open 직전).
  const [concurrency, setConcurrency] = useState<ConcurrencyDecision | null>(null);
  const [prechecking, setPrechecking] = useState(false);
  // ★T-20260803-foot-CBAND-TIDCOM-POPUP-PLACEMENT ②: Dialog 안 TID/COM 저장 후 재평가용 버전 카운터.
  const [cfgVersion, setCfgVersion] = useState(0);
  // ②: 빈값(TID) 전송 차단 안내(pre-daemon).
  const [payBlock, setPayBlock] = useState<string | null>(null);
  // ★TID-REGISTRY-GATE: seat TID ↔ registry allowlist 대조 verdict + 관리자 override 상태(soft-warn·무차단).
  const [tidVerdict, setTidVerdict] = useState<TidRegistryVerdict | null>(null);
  const [tidOverridden, setTidOverridden] = useState(false);
  const mounted = useRef(true);

  // ★TID-REGISTRY-GATE: 구조화 로깅 '누구' 축(감사 흔적). 관리자 override 노출 게이트도 여기서 파생.
  const { profile } = useAuth();
  const actor = {
    userId: profile?.id ?? null,
    userName: profile?.name ?? null,
    clinicId: profile?.clinic_id ?? clinicId ?? null,
    seatId: getSeatId(),
  };
  // override(escape hatch)는 관리자급만 설정 가능(AC-3). admin/manager/director 또는 운영최고권한.
  const canOverrideTidGate =
    profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'director' ||
    hasOpsAuthority(profile);
  // 미등록 TID + override 미설정 → soft-warn 배너 노출(결제는 계속 가능).
  const showTidWarn = tidVerdict?.status === 'unregistered' && !tidOverridden;

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
  // ★T-20260806-foot-PLANA-PKG-PAY-EXPAND(AC-2): 건당 500만원 초과 = 섹타나인 자리 한도 → 전송 전 차단.
  //   패키지 탭(대액 결제 집중)·카드 탭 공용 게이트. overLimit 이면 결제요청 비활성 + 인라인 안내(실장 사유 인지).
  const overLimit = exceedsPerTxnLimit(amountNum);
  const canPay = amountNum > 0 && ui !== 'sending' && !overLimit;
  // ★spec ① 5만원 미만 할부 잠금 — 금액 < 50,000 이면 할부 선택 비활성(일시불 강제). 카드사 규정.
  const installmentAllowed = amountNum >= CBAND_INSTALLMENT_MIN_AMOUNT;
  // 실효 할부개월 — 잠금 시(또는 일시불) 항상 0. 이 값이 approve() 로 전달·payments.installment 착지.
  const effectiveInstallment = installmentAllowed && installment > 1 ? installment : 0;

  async function onApprove() {
    if (!(amountNum > 0)) return;
    // ★T-20260806-foot-PLANA-PKG-PAY-EXPAND(AC-2): 건당 500만원 초과 사전 차단 — 단말 전송 이전에 정지.
    //   실장이 손님 앞에서 밴 거절(승인 실패)로 막히지 않게, CRM 이 전송 前 사유를 안내한다(전문 미전송).
    if (overLimit) { setPayBlock(perTxnLimitBlockMessage()); return; }
    // ★② 빈값 전송 차단(pre-daemon): TID 미입력이면 결제 전문 전송 이전에 정지 + 안내.
    const rawCfg = getTerminalConfigRaw();
    if (!rawCfg.tid) { setPayBlock('단말기 번호를 먼저 입력해 주세요.'); return; }
    // TID 는 있으나 설정 미완(merno 등, ⑧에서 보정) → 전송 차단 + 설정 안내.
    const activeCfg = getTerminalConfig();
    if (!activeCfg) { setPayBlock('단말기 설정이 완료되지 않았습니다. 위 [변경]에서 확인하거나 관리자 설정을 완료해 주세요.'); return; }
    setPayBlock(null);
    // ★TID-REGISTRY-GATE (AC-1/AC-2): 커밋 직전 seat TID 를 registry allowlist 와 대조.
    //   미등록이면 구조화 로깅(누구/seat/TID/시각)만 남기고 결제는 진행한다(soft-warn·무차단).
    //   ★hard-block 아님 — 현장/DA 협의 게이트(임의 결제 거부 금지). verdict 미검(unknown)은 무소음.
    if (tidVerdict?.status === 'unregistered') {
      logUnregisteredTid({ ...actor, tid: activeCfg.tid, overridden: tidOverridden, phase: 'commit' });
    }
    setUi('sending');
    setResult(null);
    cancelProbe(); // ★U2: 결제 소켓 열기 전 탐침 소켓 확실히 종료(동시 1개). send 내부에서도 재호출됨.
    try {
      const r = await approve(
        {
          tid: activeCfg.tid, merno: activeCfg.merno, catPort: activeCfg.catPort,
          amount: amountNum, clinicId, customerId, checkInId: checkInId ?? null,
          // ★PKG-PAY-EXPAND(AC-1): 비-null → package_payments 착지(payments 아님). 카드 탭(미전달)=payments 회귀 0.
          packageId: packageId ?? null,
          // ★HALBU 가변 전송 — 실효 개월(5만원↓/일시불=0 → HALBU "00", 회귀 무영향). formatHalbu 가 "02"~"12" 조립.
          installmentMonths: effectiveInstallment,
        },
        supabaseAttemptStore,
      );
      if (!mounted.current) return;
      setResult(r);
      // ★ 분류에 따른 정지/성공/실패. ATTENTION 은 절대 자동 재시도하지 않음.
      setUi(r.needsCheck ? 'attention' : r.classification === 'APPROVED' ? 'approved' : 'failed');
      // ★AC-3: 승인 성립 시 상위 목록 갱신(패키지 잔금·결제이력 즉시 반영). 미전달(카드 탭)=no-op.
      if (!r.needsCheck && r.classification === 'APPROVED') onApproved?.();
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
    setInstallment(0);   // ★할부 선택 초기화(팝업 open/재시도 시 일시불 default).
    // ★T-20260804-foot-CBAND-PAYMODAL-AMOUNT-AUTOFILL: 팝업 open(onEntryClick)/재시도 시 금액칸 = 미납잔액 default.
    //   ≤0/미전달이면 defaultAmountStr='' → 기존 빈칸(수동입력) 동작 그대로. 편집(override) 가능(readonly 아님).
    setAmount(defaultAmountStr);
    setConcurrency(null);
    setPayBlock(null);
  }

  // ★AC-6-2: 결제 버튼 클릭 순간 서버 재확인(팝업 open 직전) → 진행중/완료/단말사용중이면 분기 안내.
  //   client 상태 불신(두 실장=다른 브라우저) → 서버 재확인이 유일 방어. 미감지면 정상 결제 팝업.
  async function onEntryClick() {
    reset();
    setPrechecking(true);
    // ★TID-REGISTRY-GATE (AC-1): 팝업 open 시 seat TID ↔ registry allowlist 대조(read-only).
    //   미등록이면 soft-warn 배너를 idle 화면에 노출(결제는 계속 가능). override 상태도 함께 반영.
    //   실패/미가용(unknown)은 무소음(degrade-open) — 거짓 경고로 현장 흐름 교란 금지.
    setTidOverridden(isTidGateOverridden());
    checkSeatTidRegistered(cfg?.tid).then((v) => {
      if (!mounted.current) return;
      setTidVerdict(v);
      if (v.status === 'unregistered') {
        logUnregisteredTid({ ...actor, tid: v.tid, overridden: isTidGateOverridden(), phase: 'detect' });
      }
    }).catch(() => { /* degrade-open: 미판정 무소음 */ });
    let decision: ConcurrencyDecision = { blocked: false, reason: null, allowOverride: false, userMessage: '' };
    try {
      decision = await precheckConcurrentPayment(
        { clinicId, checkInId: checkInId ?? null, merno: cfg?.merno ?? null },
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

  // ★TID-REGISTRY-GATE (AC-3) escape hatch — 관리자가 '이 단말 계속 사용' 승인(배너 억제).
  //   설정/사용은 구조화 로깅(누가·어느 seat·어느 TID). 결제 흐름은 원래 무차단(soft) — 배너만 접힌다.
  function overrideTidGate() {
    const tid = tidVerdict?.tid ?? getTerminalConfigRaw().tid;
    setTidGateOverride(true, { ...actor, tid });
    setTidOverridden(true);
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
                  <p className={overLimit ? 'text-right text-sm font-semibold text-rose-600' : 'text-right text-sm text-emerald-700'}>{formatAmount(amountNum)}원</p>
                )}
                {/* ★T-20260806-foot-PLANA-PKG-PAY-EXPAND(AC-2): 건당 500만원 초과 상시 인라인 안내(클릭 전 인지). */}
                {overLimit && (
                  <div className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700" data-testid="cband-over-limit-warn">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                    <span>{perTxnLimitBlockMessage()}</span>
                  </div>
                )}
              </div>
              {/* ★T-20260805-foot-PLANA-INSTALLMENT-HALBU-SUPPORT — 할부 개월 선택(일시불/2~12개월).
                  spec ①: 금액 < 5만원이면 할부 비활성(일시불 강제) + 안내문구. 태블릿 큰 버튼·teal-emerald·한국어. */}
              <div className="space-y-2" data-testid="cband-installment-selector">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">할부 개월</label>
                  {!installmentAllowed && (
                    <span className="text-xs text-gray-400" data-testid="cband-installment-locked-hint">
                      5만원 이상 결제 시 할부 선택 가능합니다
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {CBAND_INSTALLMENT_OPTIONS.map((opt) => {
                    const isLump = opt.value === 0;
                    // 5만원 미만이면 일시불만 활성(할부 잠금). 일시불은 언제나 선택 가능.
                    const optDisabled = ui === 'sending' || (!installmentAllowed && !isLump);
                    const selected = installmentAllowed ? installment === opt.value : isLump;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={optDisabled}
                        data-testid={`cband-installment-opt-${opt.value}`}
                        aria-pressed={selected}
                        onClick={() => setInstallment(opt.value)}
                        className={
                          'min-w-[64px] rounded-lg border px-3 py-2.5 text-sm font-medium transition ' +
                          (selected
                            ? 'border-emerald-500 bg-emerald-600 text-white'
                            : optDisabled
                              ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-300'
                              : 'border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50')
                        }
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {installmentAllowed && effectiveInstallment > 0 && (
                  <p className="text-right text-xs text-emerald-700" data-testid="cband-installment-summary">
                    {formatInstallmentKo(effectiveInstallment)} 할부로 결제합니다
                  </p>
                )}
              </div>
              {/* ★T-20260805-foot-PLANA-PERSEAT-TID-REGISTRY-GATE (AC-2/AC-3) — 미등록 TID soft-warn 배너.
                  이 PC 단말 번호(TID)가 정산 단말 목록(registry)에 없으면 안내 + (관리자) 계속 사용 승인.
                  ★결제는 막지 않는다(soft) — 잘못된 단말로 결제 시 정산 사각 위험을 사용자에게 알리는 용도. */}
              {showTidWarn && ui === 'idle' && (
                <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800" data-testid="cband-tid-unregistered-warn">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <span>
                      이 PC 카드 단말 번호(TID <span className="font-mono font-bold">{tidVerdict?.tid}</span>)가
                      등록된 정산 단말 목록에 없습니다. 이대로 결제하면 정산 대사에서 누락될 수 있어요.
                      단말 번호가 맞는지 위 [변경]에서 확인하거나 관리자에게 문의해 주세요.
                    </span>
                  </div>
                  {canOverrideTidGate && (
                    <button
                      type="button"
                      className="ml-6 font-medium text-amber-700 underline underline-offset-2 hover:text-amber-800"
                      data-testid="btn-cband-tid-override"
                      onClick={overrideTidGate}
                    >
                      관리자 확인 — 이 단말 계속 사용
                    </button>
                  )}
                </div>
              )}
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
              {/* ★T-20260804-foot-CBAND-BLOCKED-SEND-PHANTOM-MSGTRACE-SUPPRESS AC-3/AC-7 —
                  번호가 있을 때만 표시. 차단(blocked) 시 msgTrace 는 '차단 원인 시도의 실 번호'(AC-7)이거나
                  ''(원인 미특정 → 번호 없이 안내). 새 phantom 번호는 결코 여기 오지 않는다(AC-1). */}
              {result.msgTrace && (
                <div className="rounded bg-white/70 p-2 text-center">
                  <p className="text-xs text-gray-500">단말기 승인내역조회 번호(거래추적)</p>
                  <p className="text-xl font-mono font-bold tracking-wider text-gray-800" data-testid="cband-msgtrace">
                    {result.msgTrace}
                  </p>
                </div>
              )}
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
              {/* ★spec ② 할부 한글표기 — 승인 완료 화면에 결제 유형 노출(일시불/N개월). */}
              <p className="text-xs text-gray-600" data-testid="cband-approved-installment">
                결제 유형: {formatInstallmentKo(effectiveInstallment)}
              </p>
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
