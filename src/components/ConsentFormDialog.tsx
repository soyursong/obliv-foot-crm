import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import SignatureCanvas from 'react-signature-canvas';
import { FileText, RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { CheckIn } from '@/lib/types';

type FormType = 'refund' | 'non_covered' | 'treatment' | 'privacy';

interface Props {
  checkIn: CheckIn | null;
  formType: FormType;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSigned: () => void;
}

const FORM_TITLES: Record<FormType, string> = {
  refund: '환불 동의서',
  non_covered: '비급여 진료비 확인 동의서',
  treatment: '시술 동의서',
  privacy: '개인정보 수집·이용 동의서',
};

const FORM_CONTENT: Record<FormType, string[]> = {
  treatment: [
    '1. 본인은 시술의 목적, 방법, 예상되는 효과 및 부작용에 대해 충분히 설명을 들었습니다.',
    '2. 시술 후 발생할 수 있는 일시적 통증, 부종, 발적 등의 가능성을 이해하였습니다.',
    '3. 시술 결과는 개인의 상태에 따라 다를 수 있으며, 결과를 보장하지 않음을 이해합니다.',
    '4. 시술 전·후 주의사항을 숙지하고 이행할 것을 동의합니다.',
    '5. 위 내용을 충분히 이해한 후 시술에 동의합니다.',
  ],
  non_covered: [
    '1. 아래 시술은 건강보험이 적용되지 않는 비급여 항목입니다.',
    '2. 시술 비용은 전액 본인 부담이며, 건강보험 급여 적용이 불가합니다.',
    '3. 비급여 항목의 가격은 의료기관에서 자율적으로 결정하며 변동될 수 있습니다.',
    '4. 본인은 위 내용을 충분히 이해하고 비급여 진료에 동의합니다.',
  ],
  privacy: [
    '1. 수집 항목: 성명, 연락처, 주민등록번호(뒷자리 1자리), 진료 기록, 시술 사진',
    '2. 수집 목적: 진료 및 시술, 예약 관리, 결제, 사후 관리',
    '3. 보유 기간: 의료법에 따른 진료기록 보존 기간 (최소 5년)',
    '4. 동의를 거부할 권리가 있으나, 거부 시 진료 및 시술이 제한될 수 있습니다.',
    '5. 본인은 위 내용을 확인하고 개인정보 수집·이용에 동의합니다.',
  ],
  refund: [
    '1. 환불 규정에 따라 산출된 환불 금액에 동의합니다.',
    '2. 사용한 회차는 정가 기준으로 차감됩니다.',
    '3. 환불 처리 후 패키지 잔여 회차는 소멸됩니다.',
    '4. 환불 금액은 원래 결제 수단으로 환불되며, 처리 기간이 소요될 수 있습니다.',
    '5. 본인은 위 환불 조건을 이해하고 동의합니다.',
  ],
};

export function ConsentFormDialog({ checkIn, formType, open, onOpenChange, onSigned }: Props) {
  const sigRef = useRef<SignatureCanvas>(null);
  const [submitting, setSubmitting] = useState(false);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (open) {
      setAgreed(false);
      setTimeout(() => sigRef.current?.clear(), 100);
    }
  }, [open]);

  if (!checkIn) return null;

  const handleSign = async () => {
    if (!sigRef.current || sigRef.current.isEmpty()) {
      toast.error('서명을 해주세요');
      return;
    }
    if (!agreed) {
      toast.error('동의 체크를 해주세요');
      return;
    }

    setSubmitting(true);

    const dataUrl = sigRef.current.toDataURL('image/png');
    const blob = await (await fetch(dataUrl)).blob();
    const fileName = `${checkIn.id}_${formType}_${Date.now()}.png`;

    const { error: uploadErr } = await supabase.storage
      .from('signatures')
      .upload(fileName, blob, { contentType: 'image/png' });

    if (uploadErr) {
      toast.error(`서명 업로드 실패: ${uploadErr.message}`);
      setSubmitting(false);
      return;
    }

    const { data: urlData } = await supabase.storage.from('signatures').createSignedUrl(fileName, 3600);

    const { error } = await supabase.from('consent_forms').insert({
      clinic_id: checkIn.clinic_id,
      customer_id: checkIn.customer_id,
      check_in_id: checkIn.id,
      form_type: formType,
      form_data: {
        content: FORM_CONTENT[formType],
        customer_name: checkIn.customer_name,
        signed_date: new Date().toISOString(),
      },
      signature_url: urlData?.signedUrl ?? fileName,
      signed_at: new Date().toISOString(),
    });

    setSubmitting(false);
    if (error) {
      toast.error(`동의서 저장 실패: ${error.message}`);
      return;
    }
    toast.success(`${FORM_TITLES[formType]} 서명 완료`);
    onSigned();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {FORM_TITLES[formType]}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/20 p-4 text-sm leading-relaxed space-y-2">
            {FORM_CONTENT[formType].map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span>위 내용을 모두 읽고 이해하였으며, 이에 동의합니다.</span>
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>서명</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => sigRef.current?.clear()}
                className="gap-1 text-xs h-9"
              >
                <RotateCcw className="h-3.5 w-3.5" /> 다시 쓰기
              </Button>
            </div>
            <div className="rounded-lg border bg-white">
              <SignatureCanvas
                ref={sigRef}
                canvasProps={{
                  width: 420,
                  height: 150,
                  className: 'w-full rounded-lg',
                  role: 'img',
                  'aria-label': '서명 캔버스',
                }}
                penColor="#1a1a1a"
              />
            </div>
            <p className="text-xs text-muted-foreground text-center">
              위 박스 안에 서명해 주세요
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleSign} disabled={submitting || !agreed}>
            {submitting ? '처리 중…' : '서명 완료'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConsentFormButtons({
  checkIn,
  onSigned,
}: {
  checkIn: CheckIn;
  onSigned: () => void;
}) {
  const [formType, setFormType] = useState<FormType | null>(null);
  const [signed, setSigned] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('consent_forms')
        .select('form_type')
        .eq('check_in_id', checkIn.id);
      setSigned(new Set((data ?? []).map((d: { form_type: string }) => d.form_type)));
    })();
  }, [checkIn.id]);

  const types: { type: FormType; label: string }[] = [
    { type: 'treatment', label: '시술 동의' },
    { type: 'non_covered', label: '비급여 확인' },
    { type: 'privacy', label: '개인정보' },
  ];

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {types.map((t) => (
          <Button
            key={t.type}
            variant={signed.has(t.type) ? 'default' : 'outline'}
            size="sm"
            className={cn('text-xs gap-1', signed.has(t.type) && 'bg-emerald-600 hover:bg-emerald-700')}
            onClick={() => {
              if (!signed.has(t.type)) setFormType(t.type);
            }}
          >
            {signed.has(t.type) ? '✓' : <FileText className="h-3 w-3" />}
            {t.label}
          </Button>
        ))}
      </div>

      <ConsentFormDialog
        checkIn={checkIn}
        formType={formType ?? 'treatment'}
        open={!!formType}
        onOpenChange={(o) => { if (!o) setFormType(null); }}
        onSigned={() => {
          if (formType) setSigned((s) => new Set([...s, formType]));
          setFormType(null);
          onSigned();
        }}
      />
    </>
  );
}
