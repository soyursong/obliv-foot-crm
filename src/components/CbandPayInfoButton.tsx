/**
 * CbandPayInfoButton.tsx — 일마감 결제내역 [결제정보 확인] 버튼 + 상세 모달 (플랜A 강점 노출)
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260813-foot-PLANA-PAYINFO-CONFIRM-COLUMN (플랜A 승인응답 열람 · FE · 조회 전용)
 *
 * 배경(현장): 플랜A(코밴 CAT 단말기 직결결제)는 승인 응답 전체가 CRM DB
 *   (cband_payment_attempts)에 저장되나, 결제내역에는 금액만 보여 기존 결제와 차이가
 *   드러나지 않음 → 실장들이 플랜A 강점(승인번호·거래고유번호 등 완전 이력)을 인식 못함.
 *   결제내역에서 상세 응답을 바로 열람 가능케 해 플랜A 강점을 현장에 노출.
 *
 * ── 활성/비활성 분기 (VG-4 판별자 동일: payment_attempt_id ∧ external_approval_no) ──
 *   · 활성: 플랜A 결제행 → 클릭 시 상세 모달(cband_payment_attempts.raw_response 기존 데이터).
 *   · 비활성: 기존 결제·현금·이체 행 → 회색 버튼 + 안내 문구(회색 only 금지, 현장 명시):
 *     "CRM 결제로 진행한 건만 확인할 수 있습니다".
 *
 * ── ★ 조회 전용(write-path 무접촉) ─────────────────────────────────────────────
 *   결제정보 수정 0 · 소급 채우기 0 · 레드페이 대조 0 · 신규 컬럼/테이블 0.
 *   상세 모달 진입 시 payment_attempt_id(=cband_payment_attempts.id)로 기존 행 1건 SELECT 만.
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
import { Receipt, Loader2, AlertTriangle, Printer, CheckCircle2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatAmount } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import {
  PAYINFO_INACTIVE_MESSAGE, isPayInfoAvailable, maskCardNo,
  fmtTranDate, fmtTranTime, fmtTranType, fmtHalbu, projectRawResponse,
  type CbandPayInfoPayment, type RawResponseView,
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

/** cband_payment_attempts 조회 결과(표시용). raw_response 는 화이트리스트 subset 만 참조. */
interface AttemptDetail {
  tran_type: string | null;
  auth_no: string | null;
  msg_trace: string | null;
  merno: string | null;
  cat_tid: string | null;
  response_code: string | null;
  requested_amount: number | null;
  raw: RawResponseView;
}

export default function CbandPayInfoButton({ payment, rowKey }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AttemptDetail | null>(null);
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
          className="rounded px-1 py-0.5 text-[10px] text-gray-400 cursor-not-allowed"
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
    setDetail(null);
    setError(null);
    setReprintState('idle');
    setReprintMsg('');
    setLoading(true);
    try {
      // ★조회 전용: payment_attempt_id(=attempt.id)로 기존 행 1건 read (raw_response 기존 데이터). write 없음.
      const { data, error: qErr } = await supabase
        .from('cband_payment_attempts')
        .select('tran_type, auth_no, msg_trace, merno, cat_tid, response_code, requested_amount, raw_response')
        .eq('id', payment.payment_attempt_id!)
        .limit(1);
      if (qErr) throw new Error(qErr.message);
      const row = data?.[0];
      if (!row) {
        setError('결제 상세 정보를 찾을 수 없습니다.');
        return;
      }
      // ★raw_response(jsonb, 정규화 camelCase) — 화이트리스트 필드만 명시 read(QR_DATA_256 등 미참조 = 구조적 차단).
      const rawView: RawResponseView = projectRawResponse(row.raw_response as Record<string, unknown> | null);
      setDetail({
        tran_type: (row.tran_type as string | null) ?? null,
        auth_no: (row.auth_no as string | null) ?? null,
        msg_trace: (row.msg_trace as string | null) ?? null,
        merno: (row.merno as string | null) ?? null,
        cat_tid: (row.cat_tid as string | null) ?? null,
        response_code: (row.response_code as string | null) ?? null,
        requested_amount: (row.requested_amount as number | null) ?? null,
        raw: rawView,
      });
    } catch (e) {
      setError(`결제 상세 정보를 불러오지 못했습니다: ${(e as Error)?.message ?? '오류'}`);
    } finally {
      setLoading(false);
    }
  }

  // 승인금액 = 응답 TAMT(raw.amount) 우선, 없으면 요청금액(requested_amount).
  const approvedAmount = detail?.raw.amount ?? detail?.requested_amount ?? null;
  const maskedCard = maskCardNo(detail?.raw.cardNoMasked);

  /**
   * ★영수증 재출력 — 이 결제의 저장된 승인데이터를 이 PC 로컬 단말(CAT_PORT)로 다시 출력.
   *   전표출력(TCODE=XP)·금전 무이동 → 신규 결제/재승인/중복 매출 절대 발생 안 함(AC3). DB write 0.
   *   단말 미설정/미연결/오프라인은 runReceiptReprint 이 명확한 실패 메시지로 반환(무반응 금지·AC4).
   */
  async function onReprint() {
    if (!detail) return;
    setReprintState('printing');
    setReprintMsg('');
    // ★라우팅 = 이 PC에 물린 로컬 단말의 시리얼 포트(CAT_PORT). "단말기 번호" 선택 개념 없음(terminal-agnostic).
    //   재출력은 시리얼 물리연결로 로컬 프린터에만 인쇄 → 원거래 TID/승인번호는 '인쇄 내용'에만 실린다(라우팅 키 아님).
    const catPort = getTerminalConfigRaw().catPort;
    const r = await runReceiptReprint({
      data: {
        tranType: detail.tran_type,
        authNo: detail.auth_no,
        amount: approvedAmount,
        halbu: detail.raw.halbu,
        cardNoMasked: maskedCard,
        cardName: detail.raw.cardName,
        tranDate: detail.raw.tranDate,
        tranTime: detail.raw.tranTime,
        tid: detail.cat_tid,
        merno: detail.merno,
        msgTrace: detail.msg_trace,
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
        className="rounded px-1 py-0.5 text-[10px] font-medium text-teal-700 hover:bg-teal-50 transition"
      >
        결제정보 확인
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" data-testid="payinfo-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-teal-700" /> 결제정보 확인
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

          {!loading && !error && detail && (
            <div className="py-1" data-testid="payinfo-detail">
              <dl className="divide-y divide-gray-100 text-sm">
                <Row label="거래구분" value={fmtTranType(detail.tran_type)} testid="payinfo-tran-type" />
                <Row label="승인번호" value={detail.auth_no ?? '—'} mono testid="payinfo-auth-no" />
                <Row label="거래일자" value={fmtTranDate(detail.raw.tranDate)} testid="payinfo-tran-date" />
                <Row label="거래시각" value={fmtTranTime(detail.raw.tranTime)} testid="payinfo-tran-time" />
                <Row
                  label="승인금액"
                  value={approvedAmount != null ? `${formatAmount(approvedAmount)}원` : '—'}
                  strong
                  testid="payinfo-amount"
                />
                <Row label="할부" value={fmtHalbu(detail.raw.halbu)} testid="payinfo-halbu" />
                <Row label="카드번호" value={maskedCard ?? '—'} mono testid="payinfo-card-no" />
                <Row label="발급사 · 매입사" value={detail.raw.cardName ?? '—'} testid="payinfo-card-name" />
                <Row label="단말기번호 (TID)" value={detail.cat_tid ?? '—'} mono testid="payinfo-tid" />
                <Row label="가맹점번호" value={detail.merno ?? '—'} mono testid="payinfo-merno" />
                {/* ★거래고유번호(TRANSERIAL, msg_trace 12자리) — 유실 시 단말기 승인내역조회 유일 키(반드시 포함). */}
                <Row label="거래고유번호 (TRANSERIAL)" value={detail.msg_trace ?? '—'} mono strong testid="payinfo-transerial" />
                <Row label="응답코드" value={detail.response_code ?? '—'} mono testid="payinfo-response-code" />
              </dl>

              {/* ★영수증 재출력(전표출력) — 금전 무이동·DB write 0. 실패는 명확한 안내(AC4). */}
              <div className="mt-3 space-y-2 border-t border-gray-100 pt-3" data-testid="payinfo-reprint">
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

/** 라벨/값 한 줄(모달 상세). mono=고정폭, strong=강조. */
function Row({
  label, value, mono, strong, testid,
}: { label: string; value: string; mono?: boolean; strong?: boolean; testid?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-gray-500">{label}</dt>
      <dd
        className={[
          'text-right break-all',
          mono ? 'font-mono' : '',
          strong ? 'font-bold text-teal-800' : 'text-gray-800',
        ].join(' ')}
        data-testid={testid}
      >
        {value}
      </dd>
    </div>
  );
}
