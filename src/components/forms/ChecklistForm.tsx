/**
 * ChecklistForm — 첫방문 발건강 질문지 + 개인정보 수집·이용 동의서
 *
 * T-20260506-foot-CHECKLIST-AUTOUPLOAD.
 *
 * 태블릿 입력 UI + 서명 → 저장 시 documents/customer/{id}/ 자동 업로드.
 * 저장물:
 *   - checklist_{ts}.json   (양식 데이터 전체 + 메타)
 *   - signature_{ts}.png    (서명 이미지)
 *
 * 1번차트(CheckInDetailSheet)에서 환자별로 호출.
 */
import { useEffect, useRef, useState } from 'react';
import { ClipboardCheck, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FormModal } from './FormModal';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { useDocumentUpload } from '@/hooks/useDocumentUpload';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** 환자 식별 — Storage 경로 키 */
  customerId: string;
  /** 사전 입력값 (있으면 자동 채움) */
  defaultName?: string;
  defaultBirthDate?: string;
  defaultPhone?: string;
  /** 저장 성공 후 호출 (업로드 경로 전달) */
  onSaved?: (paths: { jsonPath: string; signaturePath: string }) => void;
}

interface ChecklistData {
  // 신원
  name: string;
  birth_date: string;
  phone: string;
  // 발 관련 증상
  symptoms: string[];
  symptoms_other: string;
  // 통증 부위
  pain_areas: string[];
  // 과거병력
  medical_history: string[];
  medical_history_other: string;
  // 알레르기
  has_allergy: boolean;
  allergy_detail: string;
  // 동의
  agree_privacy: boolean;        // 필수
  agree_marketing: boolean;      // 선택
}

const SYMPTOM_OPTIONS = [
  '굳은살/티눈',
  '무좀',
  '내성발톱',
  '발냄새',
  '발건조/각질',
  '당뇨발/혈액순환',
  '기타',
];

const PAIN_AREAS = ['발앞꿈치', '발뒤꿈치', '발바닥', '발등', '발목'];

const MEDICAL_OPTIONS = ['당뇨', '고혈압', '심장질환', '혈액순환장애', '기타'];

const PRIVACY_TEXT = [
  '1. 수집 항목: 성명, 생년월일, 연락처, 발 건강 정보, 시술 사진',
  '2. 수집 목적: 시술·상담 진행, 예약 관리, 사후 관리',
  '3. 보유 기간: 의료법에 따른 진료기록 보존 기간 (최소 5년)',
  '4. 동의를 거부할 권리가 있으나, 거부 시 시술이 제한될 수 있습니다.',
];

const MARKETING_TEXT = [
  '1. 수집 항목: 성명, 연락처',
  '2. 수집 목적: 마케팅 정보 발송 (이벤트·신규 시술 안내)',
  '3. 보유 기간: 동의 철회 시까지',
  '4. 본 동의는 선택이며 거부해도 시술 이용에 제한이 없습니다.',
];

const initial = (defaults: { name?: string; birth?: string; phone?: string }): ChecklistData => ({
  name: defaults.name ?? '',
  birth_date: defaults.birth ?? '',
  phone: defaults.phone ?? '',
  symptoms: [],
  symptoms_other: '',
  pain_areas: [],
  medical_history: [],
  medical_history_other: '',
  has_allergy: false,
  allergy_detail: '',
  agree_privacy: false,
  agree_marketing: false,
});

export function ChecklistForm({
  open,
  onOpenChange,
  customerId,
  defaultName,
  defaultBirthDate,
  defaultPhone,
  onSaved,
}: Props) {
  const sigRef = useRef<SignaturePadHandle>(null);
  const [data, setData] = useState<ChecklistData>(() =>
    initial({ name: defaultName, birth: defaultBirthDate, phone: defaultPhone }),
  );
  const [sigEmpty, setSigEmpty] = useState(true);
  const { upload, uploading } = useDocumentUpload();

  useEffect(() => {
    if (open) {
      setData(initial({ name: defaultName, birth: defaultBirthDate, phone: defaultPhone }));
      setSigEmpty(true);
      // 다이얼로그 마운트 직후 캔버스 초기화
      setTimeout(() => sigRef.current?.clear(), 60);
    }
  }, [open, defaultName, defaultBirthDate, defaultPhone]);

  const toggle = <K extends keyof ChecklistData>(key: K, value: string) => {
    setData((d) => {
      const arr = (d[key] as unknown as string[]) ?? [];
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      return { ...d, [key]: next as unknown as ChecklistData[K] };
    });
  };

  const handleSubmit = async () => {
    if (!data.name.trim()) {
      toast.error('성명을 입력해주세요');
      return;
    }
    if (!data.agree_privacy) {
      toast.error('개인정보 수집·이용에 동의해주세요 (필수)');
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
      prefix: 'signature_checklist',
      body: sigDataUrl,
      ext: 'png',
    });
    if (!sigUp) {
      toast.error('서명 업로드 실패');
      return;
    }

    // 2) 양식 JSON 업로드 (서명 경로 포함)
    const payload = {
      form_type: 'checklist',
      title: '첫방문 발건강 질문지 + 개인정보 동의서',
      data,
      signature_path: sigUp.path,
      saved_at: ts,
    };
    const jsonUp = await upload({
      customerId,
      prefix: 'checklist',
      body: JSON.stringify(payload, null, 2),
      ext: 'json',
    });
    if (!jsonUp) {
      toast.error('체크리스트 저장 실패');
      return;
    }

    toast.success('체크리스트 저장 완료');
    onSaved?.({ jsonPath: jsonUp.path, signaturePath: sigUp.path });
    onOpenChange(false);
  };

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      title="사전 체크리스트 & 개인정보"
      description="첫 방문 발 건강 질문지와 개인정보 수집·이용 동의서입니다."
      icon={<ClipboardCheck className="h-5 w-5 text-teal-600" />}
      submitLabel="작성 완료"
      onSubmit={handleSubmit}
      submitting={uploading}
      submitDisabled={!data.agree_privacy || sigEmpty}
    >
      {/* 신원 */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-teal-800">기본 정보</h3>
        <div className="grid grid-cols-3 gap-2">
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
            <Label className="text-xs">생년월일</Label>
            <Input
              type="date"
              value={data.birth_date}
              onChange={(e) => setData((d) => ({ ...d, birth_date: e.target.value }))}
              className="h-11 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">연락처</Label>
            <Input
              value={data.phone}
              onChange={(e) => setData((d) => ({ ...d, phone: e.target.value }))}
              className="h-11 text-sm"
              placeholder="010-0000-0000"
            />
          </div>
        </div>
      </section>

      {/* 발 관련 증상 */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-teal-800">발 관련 증상 (해당 항목 모두 선택)</h3>
        <div className="flex flex-wrap gap-2">
          {SYMPTOM_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggle('symptoms', opt)}
              className={cn(
                'min-h-12 rounded-md border px-4 py-2 text-sm font-medium transition',
                data.symptoms.includes(opt)
                  ? 'border-teal-600 bg-teal-50 text-teal-700'
                  : 'border-input hover:bg-muted',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
        {data.symptoms.includes('기타') && (
          <Input
            value={data.symptoms_other}
            onChange={(e) => setData((d) => ({ ...d, symptoms_other: e.target.value }))}
            placeholder="기타 증상 직접 입력"
            className="h-11"
          />
        )}
      </section>

      {/* 통증 부위 */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-teal-800">통증 부위</h3>
        <div className="flex flex-wrap gap-2">
          {PAIN_AREAS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggle('pain_areas', opt)}
              className={cn(
                'min-h-12 rounded-md border px-4 py-2 text-sm font-medium transition',
                data.pain_areas.includes(opt)
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                  : 'border-input hover:bg-muted',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      </section>

      {/* 과거병력 */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-teal-800">과거병력</h3>
        <div className="flex flex-wrap gap-2">
          {MEDICAL_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggle('medical_history', opt)}
              className={cn(
                'min-h-12 rounded-md border px-4 py-2 text-sm font-medium transition',
                data.medical_history.includes(opt)
                  ? 'border-amber-600 bg-amber-50 text-amber-700'
                  : 'border-input hover:bg-muted',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
        {data.medical_history.includes('기타') && (
          <Input
            value={data.medical_history_other}
            onChange={(e) => setData((d) => ({ ...d, medical_history_other: e.target.value }))}
            placeholder="기타 과거병력 직접 입력"
            className="h-11"
          />
        )}
      </section>

      {/* 알레르기 */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-teal-800">알레르기 여부</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setData((d) => ({ ...d, has_allergy: false, allergy_detail: '' }))}
            className={cn(
              'min-h-12 flex-1 rounded-md border px-4 py-2 text-sm font-medium transition',
              !data.has_allergy
                ? 'border-teal-600 bg-teal-50 text-teal-700'
                : 'border-input hover:bg-muted',
            )}
          >
            없음
          </button>
          <button
            type="button"
            onClick={() => setData((d) => ({ ...d, has_allergy: true }))}
            className={cn(
              'min-h-12 flex-1 rounded-md border px-4 py-2 text-sm font-medium transition',
              data.has_allergy
                ? 'border-rose-600 bg-rose-50 text-rose-700'
                : 'border-input hover:bg-muted',
            )}
          >
            있음
          </button>
        </div>
        {data.has_allergy && (
          <Textarea
            value={data.allergy_detail}
            onChange={(e) => setData((d) => ({ ...d, allergy_detail: e.target.value }))}
            placeholder="알레르기 내역을 입력해주세요"
            rows={2}
            className="text-sm"
          />
        )}
      </section>

      {/* 개인정보 동의 */}
      <section className="space-y-2 rounded-lg border bg-muted/20 p-3">
        <h3 className="text-sm font-semibold text-teal-800">개인정보 수집·이용 동의 (필수)</h3>
        <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
          {PRIVACY_TEXT.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={data.agree_privacy}
            onChange={(e) => setData((d) => ({ ...d, agree_privacy: e.target.checked }))}
            className="h-5 w-5 rounded border-gray-300"
          />
          <span className="font-medium">위 내용을 모두 확인하였으며 개인정보 수집·이용에 동의합니다.</span>
        </label>
      </section>

      {/* 마케팅 동의 (선택) */}
      <section className="space-y-2 rounded-lg border bg-muted/10 p-3">
        <h3 className="text-sm font-semibold text-muted-foreground">마케팅 정보 수신 동의 (선택)</h3>
        <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
          {MARKETING_TEXT.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={data.agree_marketing}
            onChange={(e) => setData((d) => ({ ...d, agree_marketing: e.target.checked }))}
            className="h-5 w-5 rounded border-gray-300"
          />
          <span>마케팅 정보 수신에 동의합니다.</span>
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
        <div className="rounded-lg border-2 bg-white">
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
