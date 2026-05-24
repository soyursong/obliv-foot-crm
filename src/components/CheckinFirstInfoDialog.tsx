/**
 * CheckinFirstInfoDialog — 초진 접수 시 정보입력 폼
 * T-20260522-foot-CHECKIN-FIRST-INFO
 *
 * - 이름/전화번호 프리필 (예약 데이터 기반)
 * - 주민번호 앞6자리(birth_date) 입력
 * - 건강보험 자격조회 동의서 서명 (SignaturePad Canvas 재사용)
 * - 저장 후 onCompleted 콜백 → 실제 check-in INSERT는 호출자 담당
 *
 * WARN: rrn_encrypt RPC 호출 제거 (CUST-REG-LOGOUT 버그 연관, 세션 종료 위험)
 *       birth_date(YYMMDD 앞6자리)만 저장, 전체 RRN은 CustomerChartPage에서 별도 처리.
 */
import { useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { SignaturePad, type SignaturePadHandle } from '@/components/forms/SignaturePad';
import type { Reservation } from '@/lib/types';
import { formatPhone } from '@/lib/format';

interface Props {
  reservation: Reservation | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** 폼 제출 완료 후 호출 — 실제 check-in INSERT는 호출자 담당 */
  onCompleted: () => void;
}

/** 건강보험 자격조회 동의서 내용 */
const HIRA_CONSENT_CONTENT = [
  '1. 건강보험심사평가원의 요양급여 적정성 평가 등을 위해 진료 정보가 활용될 수 있습니다.',
  '2. 건강보험 자격 및 보험료 납부 현황을 조회할 수 있음에 동의합니다.',
  '3. 개인정보는 진료 목적 외에 사용되지 않으며, 관련 법령에 따라 보호됩니다.',
  '4. 동의를 거부할 수 있으나, 건강보험 급여 적용이 불가할 수 있습니다.',
  '5. 본인은 위 내용을 확인하고 건강보험 자격 조회에 동의합니다.',
];

/**
 * RRN 입력값에서 birth_date(YYMMDD) 추출.
 * - 숫자만 추출 후 앞 6자리 반환
 * - 6자리 미만이면 null
 */
function extractBirthDate(rrn: string): string | null {
  const digits = rrn.replace(/\D/g, '');
  if (digits.length < 6) return null;
  return digits.slice(0, 6);
}

/** RRN 입력값 자동 포맷 (YYMMDD-XXXXXXX) */
function formatRrn(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

export function CheckinFirstInfoDialog({ reservation, open, onOpenChange, onCompleted }: Props) {
  const sigRef = useRef<SignaturePadHandle>(null);
  const [rrn, setRrn] = useState('');
  const [sigEmpty, setSigEmpty] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const name = reservation?.customer_name ?? '';
  const phone = reservation?.customer_phone ? formatPhone(reservation.customer_phone) : '';

  /** 다이얼로그 내부 상태 초기화 + 닫기 */
  const handleClose = () => {
    setRrn('');
    setSigEmpty(true);
    setAgreed(false);
    sigRef.current?.clear();
    onOpenChange(false);
  };

  const handleRrnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRrn(formatRrn(e.target.value));
  };

  const handleSubmit = async () => {
    if (!reservation) return;

    // ── 유효성 검사 ──────────────────────────────────────────────────
    const birthDate = extractBirthDate(rrn);
    if (!birthDate) {
      toast.error('주민번호 앞 6자리를 입력해주세요');
      return;
    }
    if (sigRef.current?.isEmpty()) {
      toast.error('건보조회동의서에 서명해주세요');
      return;
    }
    if (!agreed) {
      toast.error('동의 체크를 해주세요');
      return;
    }

    setSubmitting(true);

    // ── 1) 서명 이미지 업로드 ─────────────────────────────────────────
    let signatureUrl = '';
    try {
      const dataUrl = sigRef.current!.toDataURL('image/png');
      const blob = await (await fetch(dataUrl)).blob();
      const fileName = `hira_consent_${reservation.id}_${Date.now()}.png`;
      const { error: uploadErr } = await supabase.storage
        .from('signatures')
        .upload(fileName, blob, { contentType: 'image/png' });
      if (uploadErr) {
        toast.error(`서명 업로드 실패: ${uploadErr.message}`);
        setSubmitting(false);
        return;
      }
      const { data: urlData } = await supabase.storage
        .from('signatures')
        .createSignedUrl(fileName, 3600 * 24 * 30); // 30일 유효
      signatureUrl = urlData?.signedUrl ?? fileName;
    } catch (err) {
      toast.error(`서명 처리 오류: ${String(err)}`);
      setSubmitting(false);
      return;
    }

    // ── 2) customers 업데이트 (customer_id 있는 경우) ────────────────
    if (reservation.customer_id) {
      const { error: custErr } = await supabase
        .from('customers')
        .update({
          birth_date: birthDate,
          hira_consent: true,
          hira_consent_at: new Date().toISOString(),
        })
        .eq('id', reservation.customer_id);
      if (custErr) {
        toast.error(`고객 정보 저장 실패: ${custErr.message}`);
        setSubmitting(false);
        return;
      }
    }

    // ── 3) consent_forms INSERT (hira_consent) ───────────────────────
    // check_in_id는 이 시점에 아직 없음 → null. 생성 후 후처리 불필요.
    if (reservation.customer_id) {
      const { error: cfErr } = await supabase.from('consent_forms').insert({
        clinic_id: reservation.clinic_id,
        customer_id: reservation.customer_id,
        form_type: 'hira_consent',
        form_data: {
          content: HIRA_CONSENT_CONTENT,
          customer_name: name,
          signed_date: new Date().toISOString(),
          birth_date: birthDate,
        },
        signature_url: signatureUrl,
        signed_at: new Date().toISOString(),
      });
      if (cfErr) {
        // 동의서 저장 실패는 경고만 (접수는 진행)
        toast.warning(`건보동의서 저장 경고: ${cfErr.message}`);
      }
    }

    setSubmitting(false);
    toast.success('정보 입력 완료 — 접수를 진행합니다');
    handleClose();
    onCompleted();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">초진 접수 — 정보 입력</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">

          {/* ── 이름 / 전화번호 (프리필, 읽기전용) ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">이름</Label>
              <Input
                value={name}
                readOnly
                className="bg-muted/50 text-sm h-10"
                data-testid="checkin-info-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">전화번호</Label>
              <Input
                value={phone}
                readOnly
                className="bg-muted/50 text-sm h-10"
                data-testid="checkin-info-phone"
              />
            </div>
          </div>

          {/* ── 주민번호 ── */}
          <div className="space-y-1.5">
            <Label className="text-xs">
              주민번호{' '}
              <span className="text-muted-foreground font-normal">(앞 6자리 필수)</span>
            </Label>
            <Input
              value={rrn}
              onChange={handleRrnChange}
              placeholder="YYMMDD-XXXXXXX"
              maxLength={14}
              className="font-mono text-sm h-11"
              inputMode="numeric"
              data-testid="checkin-info-rrn"
            />
            <p className="text-[11px] text-muted-foreground">
              생년월일(앞 6자리)만 저장됩니다. 건보조회 동의 근거로 활용됩니다.
            </p>
          </div>

          {/* ── 건강보험 자격조회 동의서 ── */}
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="text-xs font-semibold text-teal-700">
              건강보험 자격 조회 동의서
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
              {HIRA_CONSENT_CONTENT.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
                data-testid="checkin-info-consent-checkbox"
              />
              <span className="font-medium leading-snug">
                위 내용을 읽고 이해하였으며, 건강보험 자격 조회에 동의합니다.
              </span>
            </label>
          </div>

          {/* ── 서명 ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">서명</Label>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-xs h-8"
                onClick={() => {
                  sigRef.current?.clear();
                  setSigEmpty(true);
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                다시 쓰기
              </Button>
            </div>
            <div className="rounded-lg border bg-white overflow-hidden">
              <SignaturePad
                ref={sigRef}
                width={380}
                height={140}
                onChange={(isEmpty) => setSigEmpty(isEmpty)}
                className="w-full"
              />
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
              위 박스 안에 서명해주세요
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !agreed || sigEmpty || !extractBirthDate(rrn)}
            data-testid="btn-checkin-first-info-submit"
            className="bg-teal-600 hover:bg-teal-700"
          >
            {submitting ? '처리 중…' : '접수 완료'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
