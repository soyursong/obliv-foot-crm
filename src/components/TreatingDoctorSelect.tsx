/**
 * TreatingDoctorSelect — 진료의(treating_doctor) 선택 드롭다운 (요청 A/B 공용 단일 write 경로)
 * T-20260708-foot-TREATING-DOCTOR-SELECT-SYNC
 *
 *  · 옵션/근무·휴무 = useTreatingDoctorOptions (DA canonical: clinic_doctors + duty_roster 조인).
 *  · 저장 grain = check_ins.treating_doctor_id (단일 앵커). 진료콜 명단·진료환자이력 탭이 같은 한 필드를
 *    read/write → single-field-share 로 AC3(양쪽 실시간 연동) 자동 충족(sync 아님).
 *  · 휴무 원장 = 옵션에 표시하되 disabled(선택 불가) — filter 아님(AC6/요청 D).
 *  · 미연결(staff_id NULL) 원장 = 선택 가능 + advisory(근무확인 미연결) — over-disable 방지.
 *  · treating ≠ signing(차트 서명) — 이 선택은 medical_charts 를 건드리지 않음(커플링 금지).
 */
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTreatingDoctorOptions } from '@/hooks/useTreatingDoctorOptions';

const NONE = '__none__';

interface Props {
  checkInId: string;
  clinicId: string | null | undefined;
  /** 근무판정 기준일 YYYY-MM-DD(KST) — 진료콜=오늘, 진료환자이력=조회일 */
  date: string;
  /** 현재 저장된 treating_doctor_id */
  value: string | null;
  /** 저장 성공 후 부모 갱신(react-query invalidate / onRefresh 등) */
  onSaved?: () => void;
  className?: string;
  /** 작은 표(진료환자이력 행) vs 명단(진료콜) 시각 밀도 */
  size?: 'sm' | 'md';
  'data-testid'?: string;
}

export default function TreatingDoctorSelect({
  checkInId,
  clinicId,
  date,
  value,
  onSaved,
  className,
  size = 'sm',
  'data-testid': testid = 'treating-doctor-select',
}: Props) {
  const { data: options = [], isLoading } = useTreatingDoctorOptions(clinicId, date);
  const [saving, setSaving] = useState(false);

  const current = value ? options.find((o) => o.id === value) : undefined;
  // 트리거 라벨 해석(base-ui Select.Value 는 render-fn). 저장값이 옵션에 없으면(비활성 clinic_doctor)
  //   이름 유실 방지 위해 '진료의(비활성)' 표기. UUID 는 절대 노출하지 않음.
  const renderLabel = (v: string) => {
    if (!v || v === NONE) return '진료의 미지정';
    const o = options.find((x) => x.id === v);
    return o?.name ?? '진료의(비활성)';
  };

  const handleChange = async (next: string) => {
    const nextId = next === NONE ? null : next;
    if (nextId === value) return;
    setSaving(true);
    const { error } = await supabase
      .from('check_ins')
      .update({ treating_doctor_id: nextId })
      .eq('id', checkInId);
    setSaving(false);
    if (error) {
      toast.error('진료의 저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    onSaved?.();
  };

  const hasOptions = options.length > 0;

  return (
    <Select
      value={value ?? NONE}
      onValueChange={handleChange}
      disabled={saving || isLoading}
    >
      <SelectTrigger
        data-testid={testid}
        data-treating-doctor-id={value ?? ''}
        className={cn(
          size === 'sm' ? 'h-7 text-[12px] px-2' : 'h-8 text-sm px-2.5',
          'min-w-[7.5rem] gap-1',
          className,
        )}
        title={current?.unlinked ? '근무 확인 미연결 원장(선택 가능)' : undefined}
      >
        <SelectValue placeholder={hasOptions ? '진료의 선택' : '근무 원장 없음'}>
          {renderLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE} data-testid="treating-doctor-option-none">
          진료의 미지정
        </SelectItem>
        {options.map((o) => (
          <SelectItem
            key={o.id}
            value={o.id}
            disabled={o.disabled}
            data-testid="treating-doctor-option"
            data-unlinked={o.unlinked ? 'true' : 'false'}
          >
            {o.name}
            {o.disabled ? ' · 휴무' : ''}
            {o.unlinked ? ' · 근무확인 미연결' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
