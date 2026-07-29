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

import { useEffect, useMemo, useState } from 'react';
import { formatDateDots } from '@/lib/format';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
// T-20260729-foot-INSURANCE-GRADE-JUDGE-ASSIST: 판정 보조(추천만) — 순수 매칭 로직 SSOT.
import {
  judgeInsuranceGrade,
  ageFromBirthValue,
  BENEFIT_OPTIONS,
  RELIEF_OPTIONS,
  type FieldEcho,
} from '@/lib/insuranceGradeJudge';
// T-20260724-foot-NHIS-PARSER-REMOVE-MANUAL-ONLY: 파서 제안(suggested*) prop 경로 제거 — 수기 선택 only.
import { updateInsuranceGrade, useInsuranceGrade } from '@/hooks/useInsurance';

interface Props {
  customerId: string;
  /**
   * 나이 자동 추천(§3)용 clinic_id. fn_customer_birthdates RPC(나이 SSOT, rrn 서버파생) 호출에 필요.
   * 없으면 나이 추천 생략(데스크 수동) — 판정 보조 텍스트 매칭은 그대로 동작.
   */
  clinicId?: string | null;
  /** 외부에서 변경 후 후속 처리 */
  onChanged?: () => void;
  /** false 시 수정 차단 (읽기 전용) */
  editable?: boolean;
}

export function InsuranceGradeSelect({
  customerId,
  clinicId,
  onChanged,
  editable = true,
}: Props) {
  const { grade, source, verifiedAt, memo, refresh } = useInsuranceGrade(customerId);
  const [draftGrade, setDraftGrade] = useState<InsuranceGrade>('unverified');
  const [draftSource, setDraftSource] = useState<InsuranceGradeSource>('manual_input');
  const [draftMemo, setDraftMemo] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── 판정 보조(§1~§4): 데스크가 긁어 넣은 값 → 등급 추천(추천만, 확정은 사람) ──
  const [benefitText, setBenefitText] = useState('');
  const [reliefText, setReliefText] = useState('');
  const [isForeigner, setIsForeigner] = useState(false);
  const [ageYears, setAgeYears] = useState<number | null>(null);

  // 초기 로딩 시 폼 동기화
  useEffect(() => {
    setDraftGrade((grade ?? 'unverified') as InsuranceGrade);
    setDraftSource((source ?? 'manual_input') as InsuranceGradeSource);
    setDraftMemo(memo ?? '');
  }, [grade, source, memo]);

  // 나이 자동(§3) — 나이 SSOT = fn_customer_birthdates RPC(서버파생 'YYYY-MM-DD', 세기 정확).
  //   REDEFINITION_RISK 정렬: 클라 세기-휴리스틱 신설 없이 RPC 재사용. clinicId 없으면 나이 추천 생략.
  useEffect(() => {
    if (!clinicId || !customerId) {
      setAgeYears(null);
      return;
    }
    let cancelled = false;
    supabase
      .rpc('fn_customer_birthdates', { p_clinic_id: clinicId, p_ids: [customerId] })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setAgeYears(null);
          return;
        }
        const row = (data ?? [])[0] as { birth_date_display: string | null } | undefined;
        setAgeYears(ageFromBirthValue(row?.birth_date_display ?? null, Date.now()));
      });
    return () => {
      cancelled = true;
    };
  }, [clinicId, customerId]);

  const judge = useMemo(
    () => judgeInsuranceGrade({ benefitText, reliefText, isForeigner, ageYears }),
    [benefitText, reliefText, isForeigner, ageYears],
  );

  // T-20260724-foot-NHIS-PARSER-REMOVE-MANUAL-ONLY: 파서 제안 프리필(suggested*) 경로 제거.
  //   등급 입력은 오직 사람이 [수정/입력] → 등급 클릭 → [저장]으로만 write(자동확정 없음).

  const days = daysSinceVerified(verifiedAt);
  const stale = days != null && days >= VERIFICATION_STALE_DAYS;

  const startEdit = () => {
    setDraftGrade((grade ?? 'unverified') as InsuranceGrade);
    setDraftSource((source ?? 'manual_input') as InsuranceGradeSource);
    setDraftMemo(memo ?? '');
    // 판정 보조 입력은 매 편집 시 비움(이전 값 잔류 = 오판정 방지).
    setBenefitText('');
    setReliefText('');
    setIsForeigner(false);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  /** 추천 등급을 등급 선택에 적용(사람 클릭 = 확정은 사람). §1.6: 자동선택 안 함, 원클릭 적용만. */
  const applyRecommendation = () => {
    if (!judge.recommended) return;
    setDraftGrade(judge.recommended);
    if (judge.needsMemoNote && !draftMemo.trim()) {
      setDraftMemo(judge.reason);
    }
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
          {/* ── 판정 보조 (§1~§4) — 값만 긁어 붙이면 등급 추천. 추천일 뿐, 확정은 사람. ── */}
          <div className="space-y-2.5 rounded-md border border-emerald-200 bg-emerald-50/50 p-2.5">
            <div className="flex items-center gap-1.5">
              <Badge variant="teal" className="text-[10px] px-1.5 py-0">판정 보조</Badge>
              <span className="text-[11px] text-muted-foreground">
                포털 조회결과 값을 각 칸에 붙이면 등급을 추천합니다 (추천만 · 확정은 직접)
              </span>
            </div>

            {/* 최종 추천 — 크게 1개 */}
            {judge.recommended ? (
              <div className="rounded-md border border-emerald-300 bg-white/70 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">추천 등급</span>
                  <span className="text-lg font-bold text-emerald-700">
                    {INSURANCE_GRADE_SHORT_LABELS[judge.recommended]}
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    className="h-8 ml-auto"
                    onClick={applyRecommendation}
                  >
                    이 등급으로 선택
                  </Button>
                </div>
                {judge.reason && (
                  <p className="mt-1 text-[11px] text-muted-foreground">{judge.reason}</p>
                )}
                {judge.needsMemoNote && (
                  <p className="mt-1 text-[11px] font-medium text-amber-700">
                    ⚠ 미확인 계열 — 메모에 사유를 기록하고 수동으로 확인해 주세요
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-emerald-200 bg-white/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                값을 붙이면 추천 등급이 표시됩니다 (비워두면 아래에서 직접 선택)
              </div>
            )}

            {/* 급여 종류 */}
            <div className="space-y-1">
              <Label className="text-[11px]">급여 종류</Label>
              <div className="flex gap-1.5">
                <Input
                  value={benefitText}
                  onChange={(e) => setBenefitText(e.target.value)}
                  placeholder="예: 건강보험 / 의료급여 1종"
                  className="h-9 flex-1 text-xs"
                />
                <select
                  value=""
                  onChange={(e) => e.target.value && setBenefitText(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-1.5 text-[11px] text-muted-foreground"
                  aria-label="급여 종류 선택"
                >
                  {BENEFIT_OPTIONS.map((o) => (
                    <option key={o.label} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <EchoLine echo={judge.echo.benefit} />
            </div>

            {/* 본인부담 경감 */}
            <div className="space-y-1">
              <Label className="text-[11px]">본인부담 경감</Label>
              <div className="flex gap-1.5">
                <Input
                  value={reliefText}
                  onChange={(e) => setReliefText(e.target.value)}
                  placeholder="예: 차상위 2종 (없으면 비워두세요)"
                  className="h-9 flex-1 text-xs"
                />
                <select
                  value=""
                  onChange={(e) => e.target.value && setReliefText(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-1.5 text-[11px] text-muted-foreground"
                  aria-label="본인부담 경감 선택"
                >
                  {RELIEF_OPTIONS.map((o) => (
                    <option key={o.label} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <EchoLine echo={judge.echo.relief} />
            </div>

            {/* 외국인 */}
            <div className="flex items-center gap-2">
              <Switch checked={isForeigner} onCheckedChange={setIsForeigner} />
              <Label className="text-[11px]">외국인이면 체크</Label>
              {ageYears != null && (
                <span className="ml-auto text-[11px] text-muted-foreground">
                  만 {ageYears}세 (나이 자동 반영)
                </span>
              )}
            </div>
          </div>

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

/** 인식 에코(§1 UX2/3): 붙여넣는 즉시 무엇으로 읽혔는지 표시. 실패=회색 안내(억지 추측 금지). */
function EchoLine({ echo }: { echo: FieldEcho }) {
  if (echo.empty) return null;
  if (echo.recognized) {
    return (
      <p className="text-[11px] font-medium text-emerald-700">→ {echo.recognized}로 인식</p>
    );
  }
  return (
    <p className="text-[11px] text-muted-foreground">→ 자동 인식 안 됨, 아래에서 직접 선택</p>
  );
}
