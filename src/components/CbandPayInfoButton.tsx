/**
 * CbandPayInfoButton.tsx — 일마감 결제내역 [결제정보 확인] 버튼 + 상세 모달 (플랜A 강점 노출)
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260813-foot-PLANA-PAYINFO-CONFIRM-COLUMN (플랜A 승인응답 열람 · FE · 조회 전용)
 * + T-20260813-foot-PAYINFO-MODAL-CANCELPAIR-DISPLAY (승인+취소 동시표시 · 기획서 3-2)
 *
 * 배경(현장): 플랜A(코밴 CAT 단말기 직결결제)는 승인 응답 전체가 CRM DB
 *   (cband_payment_attempts)에 저장되나, 결제내역에는 금액만 보여 기존 결제와 차이가
 *   드러나지 않음 → 실장들이 플랜A 강점(승인번호·거래고유번호 등 완전 이력)을 인식 못함.
 *   결제내역에서 상세 응답을 바로 열람 가능케 해 플랜A 강점을 현장에 노출.
 *
 * ── ★승인+취소 동시표시(CANCELPAIR) ────────────────────────────────────────────
 *   취소된 플랜A 결제는 승인(0210)만 보이면 실장이 '취소됨'을 오인. 모달 진입 시 클릭 행의
 *   AUTHNO(auth_no·원거래 동일)로 관련 거래를 함께 조회해 승인 leg + 취소 leg 를 한 화면에 노출.
 *   구분 = TRANTYPE(0210=승인 / 0430=취소) + TRANSERIAL(msg_trace). 취소 존재 시 상단 '취소됨' 배지.
 *
 * ── 활성/비활성 분기 (VG-4 판별자 동일: payment_attempt_id ∧ external_approval_no) ──
 *   · 활성: 플랜A 결제행 → 클릭 시 상세 모달(cband_payment_attempts.raw_response 기존 데이터).
 *   · 비활성: 기존 결제·현금·이체 행 → 회색 버튼 + 안내 문구(회색 only 금지, 현장 명시):
 *     "CRM 결제로 진행한 건만 확인할 수 있습니다".
 *
 * ── ★ 조회 전용(write-path 무접촉) ─────────────────────────────────────────────
 *   결제정보 수정 0 · 소급 채우기 0 · 레드페이 대조 0 · 신규 컬럼/테이블 0.
 *   상세 모달 진입 시 AUTHNO(auth_no) 로 관련 거래 SELECT 만(승인 1 + 취소 N). auth_no 부재 시 id 폴백.
 *   (raw_response 는 PII 인접 → 전 행 upfront 로딩 아닌 클릭 시점 on-demand 조회로 노출 최소화.)
 *
 * ── ★ 보안/PII (HARD) ──────────────────────────────────────────────────────────
 *   · 카드번호: raw_response.cardNoMasked = 단말이 이미 마스킹한 값 verbatim(extractMaskedCardNo).
 *     평문 PAN 재조합 금지 + 방어적 마스킹(maskCardNo)으로 이중 방어.
 *   · QR_DATA_256(현금영수증 응답, 미마스킹 개인정보 13자리) 은 **표시하지 않는다**.
 *     본 모달은 raw_response 를 순회하지 않고 화이트리스트 필드만 명시 read → 구조적으로 QR 유출 불가.
 *
 * ── ★ 영수증 재출력(전표출력) — T-20260813-foot-PAYHIST-RECEIPT-REPRINT-TERMINAL1 ──
 *   본 모달 하단 [영수증 출력] 버튼 = 이미 승인된 이 결제의 영수증을 **이 PC에 연결된 카드 단말기
 *   (프린터)로 다시 뽑는다**(전표출력 TCODE=XP, 금전 무이동). 벤더 스펙 = 재출력 전용 명령
 *   ※ "단말기 번호"(1번 등) 라우팅 개념 없음 — 전표출력은 이 PC 로컬 시리얼(CAT_PORT)로만 인쇄
 *     (벤더 XP 스펙에 TID 라우팅 필드 부재). 결제 단말기와 무관(terminal-agnostic).
 *   (신규 결제/승인/취소 아님) → 구조적으로 중복 매출 유발 불가(AC3). DB write 0(감사/매출 레코드 생성 없음).
 *   단말 미연결/오프라인/미설정 시 명확한 실패 메시지(무반응 금지·AC4). 순수 로직 = @/lib/cband/receiptReprint.
 *
 * 태블릿 UX: teal-emerald · 큰 버튼 · 천단위 콤마 · 한국어. (풋센터 표준)
 */

import { useState } from 'react';
import { Receipt, Loader2, AlertTriangle, Printer, XCircle, CheckCircle2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatAmount } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import {
  PAYINFO_INACTIVE_MESSAGE, isPayInfoAvailable, maskCardNo, payInfoButtonClass,
  fmtTranDate, fmtTranTime, fmtTranType, fmtHalbu, projectRawResponse,
  pairApprovalCancel, payInfoNetStatusLabel, attemptAmount,
  type CbandPayInfoPayment, type PayInfoAttempt, type PayInfoLegs,
} from '@/lib/cband/payInfoView';
import { runReceiptReprint } from '@/lib/cband/receiptReprint';
import { getTerminalConfigRaw } from '@/lib/cband/config';

// 재노출(하위호환·기존 import 경로 안정). 순수 로직 SSOT = @/lib/cband/payInfoView.
export { PAYINFO_INACTIVE_MESSAGE, isPayInfoAvailable, maskCardNo };
export type { CbandPayInfoPayment };

interface Props {
  payment: CbandPayInfoPayment;
  /** 셀 식별용(테스트/디버그). */
  rowKey?: string;
}

/** cband_payment_attempts SELECT 컬럼(표시용). raw_response 는 화이트리스트 subset 만 참조. */
const SELECT_COLS = 'tran_type, auth_no, msg_trace, merno, cat_tid, response_code, requested_amount, raw_response';

/** SELECT row → 표시용 PayInfoAttempt(raw 화이트리스트 투영). */
function toAttempt(row: Record<string, unknown>): PayInfoAttempt {
  return {
    tran_type: (row.tran_type as string | null) ?? null,
    auth_no: (row.auth_no as string | null) ?? null,
    msg_trace: (row.msg_trace as string | null) ?? null,
    merno: (row.merno as string | null) ?? null,
    cat_tid: (row.cat_tid as string | null) ?? null,
    response_code: (row.response_code as string | null) ?? null,
    requested_amount: (row.requested_amount as number | null) ?? null,
    raw: projectRawResponse(row.raw_response as Record<string, unknown> | null),
  };
}

export default function CbandPayInfoButton({ payment, rowKey }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legs, setLegs] = useState<PayInfoLegs | null>(null);
  // ★영수증 재출력(전표출력) 상태 — 금전 무이동·DB write 0. 실패는 명확한 메시지(무반응 금지·AC4).
  const [reprintState, setReprintState] = useState<'idle' | 'printing' | 'printed' | 'failed'>('idle');
  const [reprintMsg, setReprintMsg] = useState<string>('');

  const active = isPayInfoAvailable(payment);
  const key = rowKey ?? payment.payment_attempt_id ?? 'na';

  // ── 비활성: 기존 결제·현금·이체 행 → 회색 버튼 + 안내 문구(회색 only 금지, 현장 명시) ──
  if (!active) {
    return (
      <span
        className="group relative inline-block"
        tabIndex={0}
        title={PAYINFO_INACTIVE_MESSAGE}
        aria-label={PAYINFO_INACTIVE_MESSAGE}
        data-testid={`btn-payinfo-disabled-${key}`}
      >
        <button
          type="button"
          disabled
          className={payInfoButtonClass(false)}
        >
          결제정보 확인
        </button>
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 w-56 max-w-[80vw] -translate-x-1/2 rounded-md bg-gray-900 px-2.5 py-1.5 text-[11px] leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
          data-testid={`payinfo-tooltip-${key}`}
        >
          {PAYINFO_INACTIVE_MESSAGE}
        </span>
      </span>
    );
  }

  async function openDialog() {
    setOpen(true);
    setLegs(null);
    setError(null);
    setReprintState('idle');
    setReprintMsg('');
    setLoading(true);
    try {
      // ★조회 전용: AUTHNO(auth_no·원거래 동일)로 관련 거래(승인 0210 + 취소 0430) read. write 없음.
      //   auth_no 부재 시 payment_attempt_id(=attempt.id) 단건 폴백(부모 동작 보존).
      const authno = payment.external_approval_no?.trim();
      let q = supabase.from('cband_payment_attempts').select(SELECT_COLS);
      q = authno ? q.eq('auth_no', authno) : q.eq('id', payment.payment_attempt_id!);
      const { data, error: qErr } = await q.limit(20);
      if (qErr) throw new Error(qErr.message);
      const rows = (data ?? []) as Record<string, unknown>[];
      if (rows.length === 0) {
        setError('결제 상세 정보를 찾을 수 없습니다.');
        return;
      }
      // ★승인/취소 페어링(순수) — 화이트리스트 투영 후 leg 분리.
      setLegs(pairApprovalCancel(rows.map(toAttempt)));
    } catch (e) {
      setError(`결제 상세 정보를 불러오지 못했습니다: ${(e as Error)?.message ?? '오류'}`);
    } finally {
      setLoading(false);
    }
  }

  const cancelled = !!legs?.cancelled;

  /**
   * ★영수증 재출력 — 이 결제의 저장된 승인데이터를 이 PC 로컬 단말(CAT_PORT)로 다시 출력.
   *   전표출력(TCODE=XP)·금전 무이동 → 신규 결제/재승인/중복 매출 절대 발생 안 함(AC3). DB write 0.
   *   단말 미설정/미연결/오프라인은 runReceiptReprint 이 명확한 실패 메시지로 반환(무반응 금지·AC4).
   */
  async function onReprint() {
    // ★재출력 원천 = 승인(0210, 원거래) leg. 취소건이어도 '원거래 승인 영수증'을 다시 뽑는다(취소 leg 아님).
    const appr = legs?.approval;
    if (!appr) return;
    setReprintState('printing');
    setReprintMsg('');
    // ★라우팅 = 이 PC에 물린 로컬 단말의 시리얼 포트(CAT_PORT). "단말기 번호" 선택 개념 없음(terminal-agnostic).
    //   재출력은 시리얼 물리연결로 로컬 프린터에만 인쇄 → 원거래 TID/승인번호는 '인쇄 내용'에만 실린다(라우팅 키 아님).
    const catPort = getTerminalConfigRaw().catPort;
    const r = await runReceiptReprint({
      data: {
        tranType: appr.tran_type,
        authNo: appr.auth_no,
        amount: attemptAmount(appr),
        halbu: appr.raw.halbu,
        cardNoMasked: maskCardNo(appr.raw.cardNoMasked),
        cardName: appr.raw.cardName,
        tranDate: appr.raw.tranDate,
        tranTime: appr.raw.tranTime,
        tid: appr.cat_tid,
        merno: appr.merno,
        msgTrace: appr.msg_trace,
      },
      catPort: catPort || null,
    });
    setReprintState(r.outcome === 'PRINTED' ? 'printed' : 'failed');
    setReprintMsg(r.userMessage);
  }

  return (
    <>
      <button
        type="button"
        data-testid={`btn-payinfo-${key}`}
        title="이 결제의 카드 단말기 승인 상세 정보를 확인합니다"
        onClick={openDialog}
        className={payInfoButtonClass(true)}
      >
        결제정보 확인
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto" data-testid="payinfo-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-teal-700" /> 결제정보 확인
              {legs && (
                <span
                  data-testid="payinfo-net-status"
                  className={[
                    'ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold',
                    cancelled ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700',
                  ].join(' ')}
                >
                  {cancelled ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {payInfoNetStatusLabel(legs)}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-teal-700">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">결제 상세 정보를 불러오는 중…</span>
            </div>
          )}

          {!loading && error && (
            <div className="space-y-2 rounded-lg border-2 border-amber-300 bg-amber-50 p-4" data-testid="payinfo-error">
              <div className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-6 w-6" />
                <span className="text-base font-bold">불러오기 실패</span>
              </div>
              <p className="text-sm text-amber-900">{error}</p>
            </div>
          )}

          {!loading && !error && legs && (
            <div className="space-y-4 py-1" data-testid="payinfo-detail">
              {/* ── 취소됨 안내(승인만 보고 오인 방지, 기획서 3-2) ── */}
              {cancelled && (
                <div
                  className="flex items-start gap-2 rounded-lg border-2 border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
                  data-testid="payinfo-cancelled-banner"
                >
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
                  <span>이 결제는 <b>취소된 건</b>입니다. 아래 승인·취소 내역을 함께 확인하세요.</span>
                </div>
              )}

              {/* ── 승인(0210) leg ── */}
              {legs.approval ? (
                <LegBlock attempt={legs.approval} tone="approve" testid="payinfo-leg-approval" />
              ) : (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500" data-testid="payinfo-noapproval">
                  승인(원거래) 내역을 확인할 수 없습니다.
                </div>
              )}

              {/* ── 취소(0430) leg(s) — TRANSERIAL 별 ── */}
              {legs.cancels.map((c, i) => (
                <LegBlock
                  key={c.msg_trace ?? `cancel-${i}`}
                  attempt={c}
                  tone="cancel"
                  testid={`payinfo-leg-cancel-${i}`}
                />
              ))}

              {/* ★영수증 재출력(전표출력) — 승인(원거래) leg 기준. 금전 무이동·DB write 0. 실패는 명확한 안내(AC4).
                  (RECEIPT-REPRINT-TERMINAL1 병합: CANCELPAIR 슬롯에 재출력 버튼 착지 — 원거래 승인 영수증 재인쇄.) */}
              {legs.approval && (
                <div className="mt-1 space-y-2 border-t border-gray-100 pt-3" data-testid="payinfo-reprint">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 w-full gap-2 border-teal-300 text-teal-700 hover:bg-teal-50"
                    disabled={reprintState === 'printing'}
                    data-testid="btn-payinfo-reprint"
                    onClick={onReprint}
                  >
                    {reprintState === 'printing' ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> 단말기로 출력 중…</>
                    ) : (
                      <><Printer className="h-4 w-4" /> 영수증 출력</>
                    )}
                  </Button>
                  {reprintState === 'printed' && (
                    <div className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-2.5 text-sm text-emerald-800" data-testid="payinfo-reprint-ok">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <span>{reprintMsg || '영수증을 단말기로 다시 출력했습니다.'}</span>
                    </div>
                  )}
                  {reprintState === 'failed' && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-800" data-testid="payinfo-reprint-fail">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      <span>{reprintMsg || '영수증을 재출력하지 못했습니다. 단말기 연결 상태를 확인해 주세요.'}</span>
                    </div>
                  )}
                  <p className="text-center text-[11px] text-gray-400">
                    이미 승인된 결제의 영수증을 다시 출력합니다. 새로 결제되지 않습니다.
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" className="h-11 flex-1" onClick={() => setOpen(false)} data-testid="btn-payinfo-close">
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 단일 거래(승인 or 취소) 상세 블록. tone 으로 승인(teal)/취소(rose) 색상 구분. */
function LegBlock({ attempt, tone, testid }: { attempt: PayInfoAttempt; tone: 'approve' | 'cancel'; testid: string }) {
  const isCancel = tone === 'cancel';
  const amount = attemptAmount(attempt);
  const maskedCard = maskCardNo(attempt.raw.cardNoMasked);
  return (
    <section
      data-testid={testid}
      className={[
        'rounded-lg border px-3 py-2',
        isCancel ? 'border-rose-200 bg-rose-50/40' : 'border-teal-100 bg-teal-50/30',
      ].join(' ')}
    >
      <div
        className={[
          'mb-1 flex items-center gap-1.5 text-[13px] font-bold',
          isCancel ? 'text-rose-700' : 'text-teal-800',
        ].join(' ')}
        data-testid={`${testid}-header`}
      >
        {isCancel ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        {fmtTranType(attempt.tran_type)}
      </div>
      <dl className="divide-y divide-gray-100 text-sm">
        <Row label="승인번호" value={attempt.auth_no ?? '—'} mono testid={`${testid}-auth-no`} />
        <Row label="거래일자" value={fmtTranDate(attempt.raw.tranDate)} testid={`${testid}-tran-date`} />
        <Row label="거래시각" value={fmtTranTime(attempt.raw.tranTime)} testid={`${testid}-tran-time`} />
        <Row
          label={isCancel ? '취소금액' : '승인금액'}
          value={amount != null ? `${isCancel ? '-' : ''}${formatAmount(amount)}원` : '—'}
          strong
          tone={tone}
          testid={`${testid}-amount`}
        />
        <Row label="할부" value={fmtHalbu(attempt.raw.halbu)} testid={`${testid}-halbu`} />
        <Row label="카드번호" value={maskedCard ?? '—'} mono testid={`${testid}-card-no`} />
        <Row label="발급사 · 매입사" value={attempt.raw.cardName ?? '—'} testid={`${testid}-card-name`} />
        <Row label="단말기번호 (TID)" value={attempt.cat_tid ?? '—'} mono testid={`${testid}-tid`} />
        <Row label="가맹점번호" value={attempt.merno ?? '—'} mono testid={`${testid}-merno`} />
        {/* ★거래고유번호(TRANSERIAL, msg_trace 12자리) — 유실 시 단말기 승인내역조회 유일 키 + 승인/취소 행 구분자. */}
        <Row label="거래고유번호 (TRANSERIAL)" value={attempt.msg_trace ?? '—'} mono strong tone={tone} testid={`${testid}-transerial`} />
        <Row label="응답코드" value={attempt.response_code ?? '—'} mono testid={`${testid}-response-code`} />
      </dl>
    </section>
  );
}

/** 라벨/값 한 줄(모달 상세). mono=고정폭, strong=강조, tone=승인(teal)/취소(rose) 강조색. */
function Row({
  label, value, mono, strong, tone, testid,
}: { label: string; value: string; mono?: boolean; strong?: boolean; tone?: 'approve' | 'cancel'; testid?: string }) {
  const strongColor = tone === 'cancel' ? 'text-rose-700' : 'text-teal-800';
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-gray-500">{label}</dt>
      <dd
        className={[
          'text-right break-all',
          mono ? 'font-mono' : '',
          strong ? `font-bold ${strongColor}` : 'text-gray-800',
        ].join(' ')}
        data-testid={testid}
      >
        {value}
      </dd>
    </div>
  );
}
