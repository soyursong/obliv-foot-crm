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
 * ⏸ 영수증 출력 버튼(재발행)은 본 티켓 scope 제외(동작 방식 미결) — 모달 하단 슬롯 여지만 확보,
 *   동작 미구현. TICKET-UPDATE 수신 후 별도 보완.
 *
 * 태블릿 UX: teal-emerald · 큰 버튼 · 천단위 콤마 · 한국어. (풋센터 표준)
 */

import { useState } from 'react';
import { Receipt, Loader2, AlertTriangle } from 'lucide-react';
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
              {/* ⏸ 영수증 출력 버튼 슬롯 — 본 티켓 scope 제외(동작 방식 미결). TICKET-UPDATE 수신 후 보완. */}
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
