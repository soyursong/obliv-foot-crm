// LOGIC-LOCK: L-006 인접 — 서류출력 경로(DocumentPrintPanel/PaymentMiniWindow)의 편집 진입 공통 팝업.
//   출력 바인딩/렌더는 건드리지 않는다(편집값은 fieldValues 오버라이드 + form_submissions.field_data JSON).

/**
 * DocFormSettingsDialog — 서류 설정/편집 팝업 (DOCFORM-POPUP-OVERHAUL §2#4 canonical 최초 인스턴스)
 *
 * @see T-20260629-foot-DOCPRINT-EDIT-BTN (DECISION (A) GRANTED — 공통 base 구축)
 * @see T-20260617-foot-DOCFORM-POPUP-OVERHAUL (부모 프로그램 Phase 2 §2#4)
 *
 * ── 설계 원칙 (AC2 amended) ──
 * - **재사용 가능한 공통 컴포넌트**: DocumentPrintPanel 전용 일회성 에디터 금지.
 *   [출력] 옆 [수정] 진입점(본 건) + (향후) 우클릭[서류] 진입점(CTXMENU-DOC-ENTRY)이 동일 팝업 재사용.
 *   향후 §2#4 확장(언어/템플릿/포함항목 설정)은 본 컴포넌트를 extend.
 * - **편집필드 3종 한정**: 용도(purpose) / 발행일(issue_date) / 비고(remarks). (FIELD-ANALYSIS spec)
 * - **NO-DDL**: 편집값은 form_submissions.field_data(JSONB)에 schema-free 저장. 신규 컬럼/enum 0.
 * - **published 불변(의료법§22, AC4)**: 저장 = 신규 form_submissions 행 INSERT(status='draft').
 *   기존 발행행(published/printed)은 절대 UPDATE 하지 않음 → 회귀 0.
 * - **직원 scope**: 소견서(diag_opinion)·진단서(diagnosis)는 원장 전용 → 본 팝업 진입 차단(방어).
 *   (구조적으로도 게이트 서류는 IssueDialog 를 열지 않으므로 본 팝업에 도달하지 않음.)
 */

import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from '@/lib/toast';
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
import { isGatedMedDoc } from '@/lib/medDocPrintGate';
import type { CheckIn } from '@/lib/types';
import type { FormTemplate } from '@/lib/formTemplates';

// 용도(purpose) 후보값 — 재진술 명확화본(MSG-20260629-202735-uctd) fold.
//   직접 입력도 허용(태블릿: 칩 빠른선택 + 자유입력 병행).
export const DOC_PURPOSE_OPTIONS: ReadonlyArray<string> = [
  '보험청구용',
  '개인보관용',
  '진료의뢰용',
];

export interface DocFormEditValues {
  /** 서류 용도(목적) */
  purpose: string;
  /** 발행일 (yyyy-MM-dd) */
  issue_date: string;
  /** 비고(세부 내용 일부) */
  remarks: string;
}

interface Props {
  template: FormTemplate;
  checkIn: CheckIn;
  /** issued_by FK — staff.id (호출부에서 주입). 없으면 INSERT 생략하고 오버라이드만 적용. */
  staffId: string | null;
  /** 저장 스냅샷용 — 현재 출력 바인딩 전체값(allValues). 편집 3종을 여기에 병합해 field_data 로 적재. */
  baseFieldData: Record<string, string>;
  initialValues: DocFormEditValues;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** 저장 완료 시 편집 3종 반환 → 호출부가 출력 바인딩(fieldValues)에 오버라이드. */
  onApplied: (edited: DocFormEditValues) => void;
}

export function DocFormSettingsDialog({
  template,
  checkIn,
  staffId,
  baseFieldData,
  initialValues,
  open,
  onOpenChange,
  onApplied,
}: Props) {
  const [purpose, setPurpose] = useState(initialValues.purpose ?? '');
  const [issueDate, setIssueDate] = useState(initialValues.issue_date ?? '');
  const [remarks, setRemarks] = useState(initialValues.remarks ?? '');
  const [saving, setSaving] = useState(false);

  // 팝업 오픈 시 현재값으로 동기화(재진입마다 최신 바인딩 반영).
  useEffect(() => {
    if (!open) return;
    setPurpose(initialValues.purpose ?? '');
    setIssueDate(initialValues.issue_date ?? '');
    setRemarks(initialValues.remarks ?? '');
  }, [open, initialValues.purpose, initialValues.issue_date, initialValues.remarks]);

  // 방어: 원장 전용 의료서류(소견서·진단서)는 데스크 편집 차단(직원 scope EXCLUDE).
  const gated = isGatedMedDoc(template.form_key);

  const handleSave = async () => {
    if (gated) {
      toast.error('소견서·진단서는 원장 발행 전용 서류입니다.');
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      const edited: DocFormEditValues = {
        purpose: purpose.trim(),
        issue_date: issueDate.trim(),
        remarks: remarks.trim(),
      };

      // published 불변(AC4): 신규 form_submissions 행 INSERT 만 수행. 기존 발행행 UPDATE 절대 금지.
      //   schema-free → field_data(JSONB)에 편집 3종 병합 적재(NO-DDL). status='draft' = 출력 전 편집본.
      const isFallback = template.id.startsWith('fallback-');
      if (staffId && !isFallback) {
        const fieldData = {
          ...baseFieldData,
          purpose: edited.purpose,
          issue_date: edited.issue_date,
          remarks: edited.remarks,
          // 일부 양식은 {{remark}}(단수) 플레이스홀더 사용 → 동시 적재.
          remark: edited.remarks,
        };
        const { error } = await supabase.from('form_submissions').insert({
          clinic_id: checkIn.clinic_id,
          template_id: template.id,
          check_in_id: checkIn.id,
          customer_id: checkIn.customer_id ?? null,
          issued_by: staffId,
          field_data: fieldData,
          diagnosis_codes: null,
          status: 'draft',
        });
        if (error) {
          toast.error(`저장 실패: ${error.message}`);
          return;
        }
      }

      onApplied(edited);
      toast.success('서류 설정이 저장되었습니다');
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="docform-settings-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Pencil className="h-4 w-4 text-teal-600" />
            {template.name_ko} 설정 · 수정
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* 용도(purpose) — 칩 빠른선택 + 자유입력 (태블릿 큰 버튼) */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">서류 용도</Label>
            <div className="flex flex-wrap gap-1.5">
              {DOC_PURPOSE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  data-testid={`docform-purpose-${opt}`}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all min-h-[40px] ${
                    purpose === opt
                      ? 'border-teal-400 bg-teal-50 text-teal-800 ring-1 ring-teal-300'
                      : 'border-gray-200 bg-white text-muted-foreground hover:border-teal-300 hover:text-teal-700'
                  }`}
                  onClick={() => setPurpose(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
            <Input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="직접 입력 (예: 학교 제출용)"
              className="text-sm mt-1"
              data-testid="docform-purpose-input"
            />
          </div>

          {/* 발행일(issue_date) */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">발행일</Label>
            <Input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="text-sm"
              data-testid="docform-issue-date-input"
            />
          </div>

          {/* 비고(remarks) — 세부 내용 일부 */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">비고 (세부 내용)</Label>
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="세부 내용"
              rows={3}
              className="text-sm"
              data-testid="docform-remarks-input"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button
            size="sm"
            className="bg-teal-600 hover:bg-teal-700 gap-1"
            onClick={handleSave}
            disabled={saving}
            data-testid="docform-settings-save"
          >
            {saving ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
