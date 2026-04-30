import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { CheckIn } from '@/lib/types';

interface ChecklistData {
  nail_condition: string;
  affected_nails: string[];
  duration_months: number | null;
  prior_treatment: string;
  medical_history: string;
  medications: string;
  allergies: string;
  diabetes: boolean;
  pregnancy: boolean;
  skin_sensitivity: boolean;
  expectations: string;
  referral_source: string;
}

const NAIL_OPTIONS = [
  '엄지(좌)', '검지(좌)', '중지(좌)', '약지(좌)', '소지(좌)',
  '엄지(우)', '검지(우)', '중지(우)', '약지(우)', '소지(우)',
];

const CONDITION_OPTIONS = [
  { value: 'fungal', label: '무좀/곰팡이' },
  { value: 'ingrown', label: '내성발톱' },
  { value: 'deformed', label: '변형발톱' },
  { value: 'discolored', label: '변색' },
  { value: 'thickened', label: '비후' },
  { value: 'other', label: '기타' },
];

const REFERRAL_OPTIONS = ['네이버 검색', '지인 소개', 'SNS/인스타', '블로그', 'TV/언론', '기타'];

interface Props {
  checkIn: CheckIn | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCompleted: () => void;
}

export function PreChecklist({ checkIn, open, onOpenChange, onCompleted }: Props) {
  const [data, setData] = useState<ChecklistData>({
    nail_condition: '',
    affected_nails: [],
    duration_months: null,
    prior_treatment: '',
    medical_history: '',
    medications: '',
    allergies: '',
    diabetes: false,
    pregnancy: false,
    skin_sensitivity: false,
    expectations: '',
    referral_source: '',
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !checkIn) return;
    setData({
      nail_condition: '',
      affected_nails: [],
      duration_months: null,
      prior_treatment: '',
      medical_history: '',
      medications: '',
      allergies: '',
      diabetes: false,
      pregnancy: false,
      skin_sensitivity: false,
      expectations: '',
      referral_source: '',
    });
  }, [open, checkIn?.id]);

  if (!checkIn) return null;

  const toggleNail = (nail: string) => {
    setData((d) => ({
      ...d,
      affected_nails: d.affected_nails.includes(nail)
        ? d.affected_nails.filter((n) => n !== nail)
        : [...d.affected_nails, nail],
    }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);

    const notes = {
      ...(checkIn.notes as Record<string, unknown> ?? {}),
      checklist: data,
      checklist_completed_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('check_ins')
      .update({
        notes,
        // 4/30 표준 v2: checklist 폐지 → 체크리스트 완료 후 상담대기로 직행
        status: checkIn.status === 'registered' ? 'consult_waiting' : checkIn.status,
      })
      .eq('id', checkIn.id);

    setSubmitting(false);
    if (error) {
      toast.error(`저장 실패: ${error.message}`);
      return;
    }

    if (checkIn.status === 'registered') {
      await supabase.from('status_transitions').insert({
        check_in_id: checkIn.id,
        clinic_id: checkIn.clinic_id,
        from_status: 'registered',
        to_status: 'consult_waiting',
      });
    }

    toast.success('체크리스트 작성 완료');
    onCompleted();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            사전 체크리스트 — {checkIn.customer_name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 발톱 상태 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">발톱 증상</Label>
            <div className="flex flex-wrap gap-1.5">
              {CONDITION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setData((d) => ({ ...d, nail_condition: opt.value }))}
                  className={cn(
                    'rounded-md border px-2.5 py-1.5 text-xs font-medium transition',
                    data.nail_condition === opt.value
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 이환 발톱 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">이환 부위 (해당 발톱 선택)</Label>
            <div className="grid grid-cols-5 gap-2">
              {NAIL_OPTIONS.map((nail) => (
                <button
                  key={nail}
                  type="button"
                  onClick={() => toggleNail(nail)}
                  className={cn(
                    'rounded border h-9 px-2 text-xs font-medium transition',
                    data.affected_nails.includes(nail)
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {nail}
                </button>
              ))}
            </div>
          </div>

          {/* 유병 기간 */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">유병 기간 (개월)</Label>
            <Input
              type="number"
              value={data.duration_months ?? ''}
              onChange={(e) =>
                setData((d) => ({
                  ...d,
                  duration_months: e.target.value ? Number(e.target.value) : null,
                }))
              }
              placeholder="예: 12"
            />
          </div>

          {/* 이전 치료 */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">이전 치료 경험</Label>
            <Textarea
              value={data.prior_treatment}
              onChange={(e) => setData((d) => ({ ...d, prior_treatment: e.target.value }))}
              rows={2}
              placeholder="이전에 받은 치료 (약물, 레이저 등)"
            />
          </div>

          {/* 건강 상태 체크 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">건강 상태 확인</Label>
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'diabetes' as const, label: '당뇨' },
                { key: 'pregnancy' as const, label: '임신/수유' },
                { key: 'skin_sensitivity' as const, label: '피부 민감' },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setData((d) => ({ ...d, [item.key]: !d[item.key] }))}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-medium transition',
                    data[item.key]
                      ? 'border-red-400 bg-red-50 text-red-700'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {data[item.key] ? '⚠ ' : ''}{item.label}
                </button>
              ))}
            </div>
          </div>

          {/* 복용 약물 */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">현재 복용 약물</Label>
            <Input
              value={data.medications}
              onChange={(e) => setData((d) => ({ ...d, medications: e.target.value }))}
              placeholder="없음 / 약물명"
            />
          </div>

          {/* 알러지 */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">알러지</Label>
            <Input
              value={data.allergies}
              onChange={(e) => setData((d) => ({ ...d, allergies: e.target.value }))}
              placeholder="없음 / 알러지 내역"
            />
          </div>

          {/* 기대사항 */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">기대사항</Label>
            <Textarea
              value={data.expectations}
              onChange={(e) => setData((d) => ({ ...d, expectations: e.target.value }))}
              rows={2}
              placeholder="시술에 대한 기대사항이나 우려"
            />
          </div>

          {/* 유입 경로 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">방문 경로</Label>
            <div className="flex flex-wrap gap-1.5">
              {REFERRAL_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setData((d) => ({ ...d, referral_source: opt }))}
                  className={cn(
                    'rounded-md border px-2.5 py-1.5 text-xs font-medium transition',
                    data.referral_source === opt
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? '저장 중…' : '체크리스트 완료'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
