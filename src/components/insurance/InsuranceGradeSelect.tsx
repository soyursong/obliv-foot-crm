/**
 * InsuranceGradeSelect — 환자 자격등급 + source 선택 패널
 *
 * T-20260504-foot-INSURANCE-COPAYMENT
 *
 * - 9등급 (general / low_income_x / medical_aid_x / infant / elderly_flat / foreigner / unverified)
 * - source 4가지 (전능CRM / 자격득실확인서 / 요양기관정보마당 / 수동)
 * - 90일+ 미갱신 시 "갱신 권장" 뱃지
 * - 태블릿 터치 UX (button-grid, h-10 이상)
 */

import { useEffect, useRef, useState } from 'react';
import { formatDateDots } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  ALL_INSURANCE_GRADES,
  ALL_INSURANCE_GRADE_SOURCES,
  INSURANCE_GRADE_SHORT_LABELS,
  INSURANCE_GRADE_SOURCE_LABELS,
  VERIFICATION_STALE_DAYS,
  daysSinceVerified,
  type InsuranceGrade,
  type InsuranceGradeSource,
} from '@/lib/insurance';
import { updateInsuranceGrade, useInsuranceGrade } from '@/hooks/useInsurance';

interface Props {
  customerId: string;
  /** 외부에서 변경 후 후속 처리 */
  onChanged?: () => void;
  /** false 시 수정 차단 (읽기 전용) */
  editable?: boolean;
  /**
   * T-20260724-foot-NHIS-MANUAL-CAPTURE: 수기 캡처 파서가 제안한 등급.
   * suggestionKey 가 바뀌면 편집 모드로 진입하며 이 등급/소스/메모를 초안에 프리필한다.
   * ★자동 저장하지 않는다★ — 사람이 [저장]을 눌러야 확정(자동확정 금지 불변식).
   */
  suggestedGrade?: InsuranceGrade | null;
  suggestedSource?: InsuranceGradeSource | null;
  suggestedMemo?: string | null;
  /** 제안 변경 감지 키(파서 stamp). 같은 값이면 재진입 안 함. */
  suggestionKey?: number | null;
}

export function InsuranceGradeSelect({
  customerId,
  onChanged,
  editable = true,
  suggestedGrade,
  suggestedSource,
  suggestedMemo,
  suggestionKey,
}: Props) {
  const { grade, source, verifiedAt, memo, refresh } = useInsuranceGrade(customerId);
  const [draftGrade, setDraftGrade] = useState<InsuranceGrade>('unverified');
  const [draftSource, setDraftSource] = useState<InsuranceGradeSource>('manual_input');
  const [draftMemo, setDraftMemo] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // 초기 로딩 시 폼 동기화
  useEffect(() => {
    setDraftGrade((grade ?? 'unverified') as InsuranceGrade);
    setDraftSource((source ?? 'manual_input') as InsuranceGradeSource);
    setDraftMemo(memo ?? '');
  }, [grade, source, memo]);

  // T-20260724-foot-NHIS-MANUAL-CAPTURE: 파서 제안 수신 → 편집 모드 프리필(자동저장 X).
  //   suggestionKey(파서 stamp)가 바뀔 때만 1회 진입. editable=false 면 무시.
  const appliedSuggestionKey = useRef<number | null>(null);
  useEffect(() => {
    if (!editable) return;
    if (suggestionKey == null) return;
    if (appliedSuggestionKey.current === suggestionKey) return;
    if (!suggestedGrade) return; // 제안 등급이 없으면(비화이트리스트·나이모순 등) 프리필 안 함
    appliedSuggestionKey.current = suggestionKey;
    setDraftGrade(suggestedGrade);
    setDraftSource((suggestedSource ?? 'hira_lookup') as InsuranceGradeSource);
    setDraftMemo(suggestedMemo ?? '수기 포털조회');
    setEditing(true);
  }, [suggestionKey, suggestedGrade, suggestedSource, suggestedMemo, editable]);

  const days = daysSinceVerified(verifiedAt);
  const stale = days != null && days >= VERIFICATION_STALE_DAYS;

  const startEdit = () => {
    setDraftGrade((grade ?? 'unverified') as InsuranceGrade);
    setDraftSource((source ?? 'manual_input') as InsuranceGradeSource);
    setDraftMemo(memo ?? '');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    const { error } = await updateInsuranceGrade(customerId, draftGrade, draftSource, draftMemo || null);
    setSaving(false);
    if (error) {
      toast.error(`자격등급 저장 실패: ${error}`);
      return;
    }
    toast.success('자격등급이 갱신되었습니다');
    setEditing(false);
    refresh();
    onChanged?.();
  };

  return (
    <div className="space-y-2">
      {/* 표시 모드 */}
      {!editing && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={grade && grade !== 'unverified' ? 'teal' : 'secondary'} className="text-[11px] px-2 py-0.5">
              {INSURANCE_GRADE_SHORT_LABELS[(grade ?? 'unverified') as InsuranceGrade]}
            </Badge>
            {source && (
              <span className="text-[11px] text-muted-foreground">
                {INSURANCE_GRADE_SOURCE_LABELS[source]}
              </span>
            )}
            {verifiedAt && (
              <span className="text-[11px] text-muted-foreground">
                · {formatDateDots(verifiedAt)}
              </span>
            )}
            {stale && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                {days}일 경과 — 갱신 권장
              </Badge>
            )}
            {editable && (
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="h-7 ml-auto"
                onClick={startEdit}
              >
                {grade && grade !== 'unverified' ? '수정' : '입력'}
              </Button>
            )}
          </div>
          {memo && (
            <div className="rounded bg-muted/40 px-2 py-1 text-xs text-muted-foreground whitespace-pre-wrap">
              {memo}
            </div>
          )}
        </div>
      )}

      {/* 편집 모드 */}
      {editing && (
        <div className="space-y-3 rounded-lg border border-teal-200 bg-teal-50/40 p-3">
          {/* 등급 선택 (9개 버튼 그리드) */}
          <div className="space-y-1.5">
            <Label className="text-xs">자격등급</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {ALL_INSURANCE_GRADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setDraftGrade(g)}
                  className={cn(
                    'h-10 rounded-md border px-2 text-xs font-medium transition',
                    draftGrade === g
                      ? 'border-neutral-400 bg-neutral-100 text-neutral-800'
                      : 'border-input bg-background hover:bg-muted',
                  )}
                >
                  {INSURANCE_GRADE_SHORT_LABELS[g]}
                </button>
              ))}
            </div>
          </div>

          {/* source 선택 (4개) */}
          <div className="space-y-1.5">
            <Label className="text-xs">확인 방법</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {ALL_INSURANCE_GRADE_SOURCES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDraftSource(s)}
                  className={cn(
                    'h-10 rounded-md border px-2 text-xs font-medium transition',
                    draftSource === s
                      ? 'border-neutral-400 bg-neutral-100 text-neutral-800'
                      : 'border-input bg-background hover:bg-muted',
                  )}
                >
                  {INSURANCE_GRADE_SOURCE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* 메모 (옵션) */}
          <div className="space-y-1.5">
            <Label className="text-xs">메모 (선택)</Label>
            <Textarea
              value={draftMemo}
              onChange={(e) => setDraftMemo(e.target.value)}
              rows={2}
              placeholder="예: 2024-12 자격득실확인서 확인"
              className="text-xs"
            />
          </div>

          {/* 액션 */}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1 h-9" onClick={cancelEdit}>
              취소
            </Button>
            <Button type="button" className="flex-1 h-9" onClick={save} disabled={saving}>
              {saving ? '저장 중…' : '저장'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
