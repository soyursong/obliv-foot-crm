/**
 * ConsentForm — 환불 & 비급여 통합 동의서
 *
 * T-20260506-foot-CHECKLIST-AUTOUPLOAD.
 *
 * 태블릿 입력 UI + 서명 → 저장 시 documents/customer/{id}/ 자동 업로드.
 * 저장물:
 *   - consent_refund_{ts}.json   (환불 + 비급여 통합 양식 데이터)
 *   - signature_consent_{ts}.png (서명 이미지)
 *
 * 1번차트(CheckInDetailSheet) 결제 직후 호출.
 */
import { useEffect, useRef, useState } from 'react';
import { FileText, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FormModal } from './FormModal';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { useDocumentUpload } from '@/hooks/useDocumentUpload';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customerId: string;
  defaultName?: string;
  defaultServiceName?: string;
  onSaved?: (paths: { jsonPath: string; signaturePath: string }) => void;
}

interface ConsentData {
  name: string;
  service_name: string;
  // 비급여 항목 확인 체크
  ack_non_covered: boolean;
  // 환불 정책 동의
  ack_refund_before: boolean;  // 사용 전 전액 환불
  ack_refund_after: boolean;   // 사용 후 잔여회차 기준
  // 최종 동의
  agree_all: boolean;
}

const NON_COVERED_TEXT = [
  '1. 본 시술은 건강보험이 적용되지 않는 비급여 항목입니다.',
  '2. 시술 비용은 전액 본인 부담이며, 건강보험 급여 적용이 불가합니다.',
  '3. 비급여 항목의 가격은 의료기관에서 자율적으로 결정하며 변동될 수 있습니다.',
  '4. 시술의 목적, 방법, 예상 효과 및 부작용을 충분히 설명들었으며 이에 동의합니다.',
];

const REFUND_TEXT = [
  '1. 패키지 결제 후 환불 시 다음 기준에 따라 산정합니다.',
  '   ① 시술 시작 전 환불: 결제 금액 전액 환불',
  '   ② 시술 시작 후 환불: 정가 기준 사용 회차 차감 후 잔액 환불',
  '2. 환불 수수료는 별도로 부과되지 않습니다.',
  '3. 환불 처리 후 패키지 잔여 회차는 소멸되며 양도가 불가합니다.',
  '4. 환불 금액은 원래 결제 수단으로 환불되며 처리에 영업일 기준 3-7일이 소요될 수 있습니다.',
];

const initial = (defaults: { name?: string; service?: string }): ConsentData => ({
  name: defaults.name ?? '',
  service_name: defaults.service ?? '',
  ack_non_covered: false,
  ack_refund_before: false,
  ack_refund_after: false,
  agree_all: false,
});

export function ConsentForm({
  open,
  onOpenChange,
  customerId,
  defaultName,
  defaultServiceName,
  onSaved,
}: Props) {
  const sigRef = useRef<SignaturePadHandle>(null);
  const [data, setData] = useState<ConsentData>(() =>
    initial({ name: defaultName, service: defaultServiceName }),
  );
  const [sigEmpty, setSigEmpty] = useState(true);
  const { upload, uploading } = useDocumentUpload();

  useEffect(() => {
    if (open) {
      setData(initial({ name: defaultName, service: defaultServiceName }));
      setSigEmpty(true);
      setTimeout(() => sigRef.current?.clear(), 60);
    }
  }, [open, defaultName, defaultServiceName]);

  const allChecked =
    data.ack_non_covered && data.ack_refund_before && data.ack_refund_after && data.agree_all;

  const handleSubmit = async () => {
    if (!data.name.trim()) {
      toast.error('성명을 입력해주세요');
      return;
    }
    if (!allChecked) {
      toast.error('모든 동의 항목에 체크해주세요');
      return;
    }
    if (!sigRef.current || sigRef.current.isEmpty()) {
      toast.error('서명을 해주세요');
      return;
    }

    const ts = new Date().toISOString();
    const sigDataUrl = sigRef.current.toDataURL('image/png');

    // 1) 서명 PNG 업로드
    const sigUp = await upload({
      customerId,
      prefix: 'signature_consent',
      body: sigDataUrl,
      ext: 'png',
    });
    if (!sigUp) {
      toast.error('서명 업로드 실패');
      return;
    }

    // 2) 양식 JSON 업로드
    const payload = {
      form_type: 'consent_refund_non_covered',
      title: '환불 & 비급여 동의서',
      data,
      content: { non_covered: NON_COVERED_TEXT, refund: REFUND_TEXT },
      signature_path: sigUp.path,
      saved_at: ts,
    };
    const jsonUp = await upload({
      customerId,
      prefix: 'consent_refund',
      body: JSON.stringify(payload, null, 2),
      ext: 'json',
    });
    if (!jsonUp) {
      toast.error('동의서 저장 실패');
      return;
    }

    toast.success('환불·비급여 동의서 저장 완료');
    onSaved?.({ jsonPath: jsonUp.path, signaturePath: sigUp.path });
    onOpenChange(false);
  };

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      title="환불 & 비급여 동의서"
      description="비급여 시술 안내와 환불 정책에 대한 동의서입니다."
      icon={<FileText className="h-5 w-5 text-teal-600" />}
      submitLabel="동의 및 서명 완료"
      onSubmit={handleSubmit}
      submitting={uploading}
      submitDisabled={!allChecked || sigEmpty}
    >
      {/* 신원 + 서비스 */}
      <section className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">성명 *</Label>
            <Input
              value={data.name}
              onChange={(e) => setData((d) => ({ ...d, name: e.target.value }))}
              className="h-11 text-sm"
              placeholder="홍길동"
            />
          </div>
          <div>
            <Label className="text-xs">서비스명</Label>
            <Input
              value={data.service_name}
              onChange={(e) => setData((d) => ({ ...d, service_name: e.target.value }))}
              className="h-11 text-sm"
              placeholder="예: 가열레이저 5회 패키지"
            />
          </div>
        </div>
      </section>

      {/* 비급여 안내 */}
      <section className="space-y-2 rounded-lg border bg-amber-50/40 p-3">
        <h3 className="text-sm font-semibold text-amber-900">비급여 진료 동의</h3>
        <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
          {NON_COVERED_TEXT.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={data.ack_non_covered}
            onChange={(e) => setData((d) => ({ ...d, ack_non_covered: e.target.checked }))}
            className="h-5 w-5 rounded border-gray-300"
          />
          <span className="font-medium">위 비급여 안내를 모두 확인하였습니다.</span>
        </label>
      </section>

      {/* 환불 정책 */}
      <section className="space-y-2 rounded-lg border bg-teal-50/40 p-3">
        <h3 className="text-sm font-semibold text-teal-900">환불 정책</h3>
        <div className="space-y-1 text-xs leading-relaxed text-muted-foreground whitespace-pre-line">
          {REFUND_TEXT.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        <div className="space-y-1.5 pt-1">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={data.ack_refund_before}
              onChange={(e) => setData((d) => ({ ...d, ack_refund_before: e.target.checked }))}
              className="h-5 w-5 rounded border-gray-300"
            />
            <span>시술 시작 전 환불 — 전액 환불 기준에 동의합니다.</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={data.ack_refund_after}
              onChange={(e) => setData((d) => ({ ...d, ack_refund_after: e.target.checked }))}
              className="h-5 w-5 rounded border-gray-300"
            />
            <span>시술 시작 후 환불 — 잔여회차 기준 정가 차감에 동의합니다.</span>
          </label>
        </div>
      </section>

      {/* 최종 동의 */}
      <section className="space-y-2 rounded-lg border-2 border-teal-200 bg-teal-50 p-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={data.agree_all}
            onChange={(e) => setData((d) => ({ ...d, agree_all: e.target.checked }))}
            className="h-5 w-5 rounded border-gray-300"
          />
          <span className="font-semibold text-teal-900">
            본인은 위 비급여 진료 안내 및 환불 정책을 모두 충분히 이해하였으며, 이에 동의합니다.
          </span>
        </label>
      </section>

      {/* 서명 */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-teal-800">서명 *</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => sigRef.current?.clear()}
            className="h-9 gap-1 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" /> 다시 쓰기
          </Button>
        </div>
        <div className={cn('rounded-lg border-2 bg-white', !sigEmpty && 'border-teal-300')}>
          <SignaturePad
            ref={sigRef}
            width={520}
            height={170}
            className="w-full rounded-lg"
            onChange={(empty) => setSigEmpty(empty)}
          />
        </div>
        <p className="text-xs text-muted-foreground text-center">위 박스 안에 서명해 주세요</p>
      </section>
    </FormModal>
  );
}
