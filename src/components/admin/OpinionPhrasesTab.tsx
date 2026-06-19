// OpinionPhrasesTab — 소견서 상용구(옵션 버튼 + 자동삽입 멘트) 관리
// Ticket: T-20260616-foot-OPINION-PHRASE-MGMT-TAB (문지은 대표원장)
//   요청: 소견서 화면 좌측 버튼들(버튼이름 + 클릭 시 자동삽입 멘트)을 어드민에서 직접 세팅.
//
// === 데이터 소스 (★DDL 없음 — jsonb 편집만) ===
//   form_templates(form_key='opinion_doc').field_map.sections 를 CRUD.
//   - read: OpinionDocTab.useOpinionTemplate 와 동일 row 를 읽어 parseOpinionSections 로 파싱(SSOT 공유).
//   - write: form_templates UPDATE — field_map 의 다른 키(print_template_key 등)는 보존하고 sections 만 교체.
//     RLS = form_templates_admin_all (is_admin_or_manager) → write 는 admin/manager 전용(AC-1).
//   신규 컬럼/테이블/CHECK 없음. publish_opinion_doc 마이그(20260616160000)가 seed 한 동일 row 를 편집할 뿐.
//
// === AC 매핑 ===
//   AC-1 탭 신설 = ClinicManagement '진료차트 상용구' 옆(value=opinion_phrases). admin/manager only.
//   AC-2 섹션별 옵션 CRUD = label(버튼이름) + phrase(자동삽입 멘트) 추가/수정/삭제.
//   AC-3 저장 = field_map.sections upsert(DDL 없음). 저장 버튼 1회로 jsonb 전체 갱신(atomic).
//   AC-4 seed = field_map.sections 비면 현행 OPINION_SECTIONS(진단서4+금기증24) 기본값으로 초기화 후 편집.
//   AC-5 read 우선순위 = 저장 후 OpinionDocTab 이 DB 우선 → 바뀐 버튼/멘트가 소견서 칩에 반영(旣 AC-8 wiring).
//   AC-6 섹션 이름 변경/신규 섹션 추가/삭제(MVP — 옵션 CRUD 와 동일 jsonb 편집).
//
// 무회귀: 소견서 칩 그리드 렌더·발행 동선(OPINION-DOC-FEATURE)에 영향 없음 — 읽기 소스만 DB 일원화.

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { canEditClinicMgmt } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import {
  OPINION_SECTIONS,
  parseOpinionSections,
  type OpinionSection,
} from '@/components/doctor/OpinionDocTab';
import {
  downloadPhraseCsv,
  phraseCsvFilename,
  parsePhraseCsv,
  computeImportPlan,
  applyPhraseImport,
  type ImportPlan,
} from '@/lib/opinionPhraseCsv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Save,
  FileText,
  FolderPlus,
  Download,
  Upload,
  History,
} from 'lucide-react';

// 버튼별 최신 업데이트 메타(AC-5) — field_map.phrase_meta[optionKey].
//   sections 배열과 분리 보관 → 기존 CRUD 저장(sections 교체)이 메타를 보존(field_map 다른 키 spread).
interface PhraseMeta {
  last_updated_at?: string;
  updated_by?: string;
}
type PhraseMetaMap = Record<string, PhraseMeta>;
interface ImportLogEntry {
  at: string;
  by: string;
  added: number;
  changed: number;
}

function parsePhraseMeta(fieldMap: Record<string, unknown>): PhraseMetaMap {
  const raw = fieldMap['phrase_meta'];
  if (!raw || typeof raw !== 'object') return {};
  const out: PhraseMetaMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const m = (v ?? {}) as Record<string, unknown>;
    out[k] = {
      last_updated_at: typeof m['last_updated_at'] === 'string' ? (m['last_updated_at'] as string) : undefined,
      updated_by: typeof m['updated_by'] === 'string' ? (m['updated_by'] as string) : undefined,
    };
  }
  return out;
}

function parseImportLog(fieldMap: Record<string, unknown>): ImportLogEntry[] {
  const raw = fieldMap['import_log'];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => (e ?? {}) as Record<string, unknown>)
    .filter((e) => typeof e['at'] === 'string')
    .map((e) => ({
      at: String(e['at']),
      by: typeof e['by'] === 'string' ? (e['by'] as string) : '—',
      added: typeof e['added'] === 'number' ? (e['added'] as number) : 0,
      changed: typeof e['changed'] === 'number' ? (e['changed'] as number) : 0,
    }));
}

// KST 'YYYY-MM-DD HH:mm' 표기 (parts 기반 — 로케일 포맷 문자열 흔들림 회피).
function fmtKst(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// ---------------------------------------------------------------------------
// opinion_doc form_template 전체 row(field_map 포함) — write 시 print_template_key 보존용.
// ---------------------------------------------------------------------------
interface OpinionTemplateRow {
  id: string | null;          // null = 아직 seed 안 됨(FE insert 경로)
  fieldMap: Record<string, unknown>;
  sections: OpinionSection[]; // parseOpinionSections 결과(빈 배열 가능)
  phraseMeta: PhraseMetaMap;  // AC-5: 버튼별 최신 업데이트 메타.
  importLog: ImportLogEntry[]; // AC-5: 업로드 이력.
}

function useOpinionTemplateRow(clinicId: string | null) {
  return useQuery<OpinionTemplateRow>({
    queryKey: ['opinion_phrase_template', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return { id: null, fieldMap: {}, sections: [], phraseMeta: {}, importLog: [] };
      const { data, error } = await supabase
        .from('form_templates')
        .select('id, field_map')
        .eq('clinic_id', clinicId)
        .eq('form_key', 'opinion_doc')
        .eq('active', true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? null) as { id?: string; field_map?: unknown } | null;
      const fieldMap = (row?.field_map ?? {}) as Record<string, unknown>;
      return {
        id: row?.id ? String(row.id) : null,
        fieldMap,
        sections: parseOpinionSections(fieldMap),
        phraseMeta: parsePhraseMeta(fieldMap),
        importLog: parseImportLog(fieldMap),
      };
    },
    staleTime: 30_000,
  });
}

// 저장 = field_map.sections 교체(다른 키 보존). row 없으면 insert(seed FE 폴백).
function useSaveOpinionSections(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      templateId,
      baseFieldMap,
      sections,
    }: {
      templateId: string | null;
      baseFieldMap: Record<string, unknown>;
      sections: OpinionSection[];
    }) => {
      // 다른 field_map 키(print_template_key 등) 보존 + sections 만 교체. DDL 없음.
      const nextFieldMap = { ...baseFieldMap, sections };
      if (templateId) {
        const { error } = await supabase
          .from('form_templates')
          .update({ field_map: nextFieldMap })
          .eq('id', templateId);
        if (error) throw error;
      } else {
        // seed 미적용 환경 폴백 — opinion_doc row 신규 insert(마이그 seed 와 동형 컬럼).
        if (!clinicId) throw new Error('clinic 정보를 확인할 수 없습니다.');
        const { error } = await supabase.from('form_templates').insert({
          clinic_id: clinicId,
          category: 'foot-service',
          form_key: 'opinion_doc',
          name_ko: '소견서',
          template_path: '',
          template_format: 'html',
          field_map: { print_template_key: 'diag_opinion', ...nextFieldMap },
          requires_signature: false,
          required_role: 'admin|manager|director|consultant|coordinator|technician|therapist',
          active: true,
          sort_order: 120,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['opinion_phrase_template', clinicId] });
      // OpinionDocTab 의 옵션 그리드 캐시도 무효화 → 진료의 화면 즉시 반영(AC-5).
      qc.invalidateQueries({ queryKey: ['opinion_form_template', clinicId] });
      toast.success('소견서 상용구가 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

// CSV 대량입력 반영(AC-4 commit) — dry-run plan 을 form_templates.field_map 에 적용.
//   field_map = { ...base, sections(비파괴 머지), phrase_meta(영향 옵션 갱신), import_log(append) }.
//   신규 컬럼/테이블/CHECK 없음(ADDITIVE jsonb) — AC-5.
function useCommitCsvImport(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      templateId,
      baseFieldMap,
      currentSections,
      plan,
      updatedBy,
    }: {
      templateId: string | null;
      baseFieldMap: Record<string, unknown>;
      currentSections: OpinionSection[];
      plan: ImportPlan;
      updatedBy: string;
    }) => {
      const { sections, affectedKeys } = applyPhraseImport(currentSections, plan);
      const nowIso = new Date().toISOString();
      // 옵션별 최신 업데이트 메타 갱신(추가/변경 대상만).
      const prevMeta = parsePhraseMeta(baseFieldMap);
      const nextMeta: PhraseMetaMap = { ...prevMeta };
      for (const k of affectedKeys) nextMeta[k] = { last_updated_at: nowIso, updated_by: updatedBy };
      // 업로드 이력 append.
      const prevLog = parseImportLog(baseFieldMap);
      const entry: ImportLogEntry = { at: nowIso, by: updatedBy, added: plan.added, changed: plan.changed };
      const nextFieldMap = {
        ...baseFieldMap,
        sections,
        phrase_meta: nextMeta,
        import_log: [...prevLog, entry],
      };
      if (templateId) {
        const { error } = await supabase
          .from('form_templates')
          .update({ field_map: nextFieldMap })
          .eq('id', templateId);
        if (error) throw error;
      } else {
        if (!clinicId) throw new Error('clinic 정보를 확인할 수 없습니다.');
        const { error } = await supabase.from('form_templates').insert({
          clinic_id: clinicId,
          category: 'foot-service',
          form_key: 'opinion_doc',
          name_ko: '소견서',
          template_path: '',
          template_format: 'html',
          field_map: { print_template_key: 'diag_opinion', ...nextFieldMap },
          requires_signature: false,
          required_role: 'admin|manager|director|consultant|coordinator|technician|therapist',
          active: true,
          sort_order: 120,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['opinion_phrase_template', clinicId] });
      qc.invalidateQueries({ queryKey: ['opinion_form_template', clinicId] });
      toast.success('CSV 내용이 반영됐어요.');
    },
    onError: (e: Error) => toast.error(`반영 실패: ${e.message}`),
  });
}

// 옵션 key 생성 — 템플릿 내 유일성 보장(phrase 토글·provenance 식별자). 한글 라벨 무관 안정 키.
function genOptionKey(existing: Set<string>): string {
  let key = '';
  do {
    key = `opt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  } while (existing.has(key));
  return key;
}

// ---------------------------------------------------------------------------
// 옵션 추가/수정 다이얼로그 — label(버튼이름) + phrase(자동삽입 멘트).
// ---------------------------------------------------------------------------
function OptionDialog({
  open,
  onOpenChange,
  initial,
  sectionTitle,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: { label: string; phrase: string } | null;
  sectionTitle: string;
  onSubmit: (label: string, phrase: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [phrase, setPhrase] = useState('');
  const [bound, setBound] = useState<string | null>(null);

  // 다이얼로그가 새 대상으로 열릴 때마다 입력 초기화.
  const sig = open ? `${sectionTitle}|${initial?.label ?? '__new__'}|${initial?.phrase ?? ''}` : null;
  if (open && sig !== bound) {
    setBound(sig);
    setLabel(initial?.label ?? '');
    setPhrase(initial?.phrase ?? '');
  }

  const handleSubmit = () => {
    if (!label.trim()) return toast.error('버튼 이름을 입력해주세요.');
    if (!phrase.trim()) return toast.error('자동삽입 멘트를 입력해주세요.');
    onSubmit(label.trim(), phrase.trim());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="opinion-phrase-option-dialog">
        <DialogHeader>
          <DialogTitle>
            {initial ? '버튼 수정' : '버튼 추가'}
            <span className="ml-2 text-sm font-normal text-muted-foreground">· {sectionTitle}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">
              버튼 이름 * <span className="text-muted-foreground font-normal">— 소견서 화면에 표시될 버튼 글자</span>
            </Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="예) 경구약 O"
              className="mt-1"
              data-testid="opinion-phrase-label-input"
            />
          </div>
          <div>
            <Label className="text-xs">
              자동삽입 멘트 * <span className="text-muted-foreground font-normal">— 버튼을 누르면 소견 내용에 들어갈 문장</span>
            </Label>
            <Textarea
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="예) 경구약 복용이 가능한 상태로 확인됩니다."
              className="mt-1 min-h-[100px] text-sm"
              data-testid="opinion-phrase-phrase-input"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSubmit} data-testid="opinion-phrase-option-save">
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 섹션 추가/이름변경 다이얼로그 (AC-6).
// ---------------------------------------------------------------------------
function SectionTitleDialog({
  open,
  onOpenChange,
  initialTitle,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialTitle: string | null; // null = 신규 섹션
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [bound, setBound] = useState<string | null>(null);
  const sig = open ? (initialTitle ?? '__new__') : null;
  if (open && sig !== bound) {
    setBound(sig);
    setTitle(initialTitle ?? '');
  }
  const handleSubmit = () => {
    if (!title.trim()) return toast.error('섹션 이름을 입력해주세요.');
    onSubmit(title.trim());
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="opinion-phrase-section-dialog">
        <DialogHeader>
          <DialogTitle>{initialTitle ? '섹션 이름 변경' : '섹션 추가'}</DialogTitle>
        </DialogHeader>
        <div>
          <Label className="text-xs">섹션 이름 *</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예) 진단서 · 금기증"
            className="mt-1"
            data-testid="opinion-phrase-section-input"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSubmit} data-testid="opinion-phrase-section-save">확인</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CSV 대량입력 다이얼로그 (AC-4) — 파일선택 → dry-run 미리보기(추가/변경/오류) → '반영'.
// ---------------------------------------------------------------------------
function CsvImportDialog({
  open,
  onOpenChange,
  currentSections,
  committing,
  onCommit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentSections: OpinionSection[];
  committing: boolean;
  onCommit: (plan: ImportPlan) => void;
}) {
  const [fileName, setFileName] = useState<string>('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // 다이얼로그 닫힐 때 상태 리셋.
  const [boundOpen, setBoundOpen] = useState(false);
  if (open !== boundOpen) {
    setBoundOpen(open);
    if (!open) {
      setFileName('');
      setPlan(null);
      setParseError(null);
    }
  }

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setPlan(null);
    try {
      const text = await file.text();
      const rows = parsePhraseCsv(text);
      if (rows.length === 0) {
        setParseError('CSV에 데이터 행이 없습니다.');
        return;
      }
      setPlan(computeImportPlan(currentSections, rows));
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  const canCommit = !!plan && (plan.added > 0 || plan.changed > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="opinion-phrase-csv-import-dialog">
        <DialogHeader>
          <DialogTitle>CSV 대량입력</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-dashed p-3">
            <Label className="text-xs text-muted-foreground">
              양식 다운로드로 받은 CSV 파일을 선택하세요. 멘트를 수정하거나 행을 추가한 뒤 업로드하면 미리보기가 표시됩니다.
            </Label>
            <input
              type="file"
              accept=".csv,text/csv"
              className="mt-2 block w-full text-sm file:mr-2 file:rounded-md file:border file:border-teal-200 file:bg-teal-50 file:px-3 file:py-1.5 file:text-teal-700"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              data-testid="opinion-phrase-csv-file-input"
            />
            {fileName && <p className="mt-1 text-[11px] text-muted-foreground">선택된 파일: {fileName}</p>}
          </div>

          {parseError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="opinion-phrase-csv-parse-error">
              {parseError}
            </p>
          )}

          {plan && (
            <div className="space-y-2" data-testid="opinion-phrase-csv-preview">
              {/* 요약 — 추가 N / 변경 M / 오류 K */}
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700" data-testid="opinion-phrase-csv-count-add">
                  추가 {plan.added}
                </span>
                <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700" data-testid="opinion-phrase-csv-count-change">
                  변경 {plan.changed}
                </span>
                <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground" data-testid="opinion-phrase-csv-count-unchanged">
                  변동없음 {plan.unchanged}
                </span>
                <span className="rounded-full bg-destructive/10 px-2.5 py-1 font-medium text-destructive" data-testid="opinion-phrase-csv-count-error">
                  오류 {plan.errors}
                </span>
              </div>

              {plan.errors > 0 && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
                  오류 행은 반영에서 제외됩니다. 추가/변경 행만 반영됩니다.
                </p>
              )}

              {/* 상세 — 스크롤 영역 */}
              <div className="max-h-[260px] overflow-auto rounded-md border">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5">행</th>
                      <th className="px-2 py-1.5">구분</th>
                      <th className="px-2 py-1.5">섹션</th>
                      <th className="px-2 py-1.5">버튼이름</th>
                      <th className="px-2 py-1.5">삽입멘트 / 비고</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {plan.items.map((it, i) => (
                      <tr key={i} className={it.type === 'error' ? 'bg-destructive/5' : ''} data-testid={`opinion-phrase-csv-row-${it.type}`}>
                        <td className="px-2 py-1.5 text-muted-foreground">{it.line}</td>
                        <td className="px-2 py-1.5">
                          {it.type === 'add' && <span className="text-emerald-700">추가</span>}
                          {it.type === 'change' && <span className="text-amber-700">변경</span>}
                          {it.type === 'unchanged' && <span className="text-muted-foreground">변동없음</span>}
                          {it.type === 'error' && <span className="text-destructive">오류</span>}
                        </td>
                        <td className="px-2 py-1.5">{it.section}</td>
                        <td className="px-2 py-1.5">{it.label}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {it.type === 'error' ? (
                            <span className="text-destructive">{it.error}</span>
                          ) : it.type === 'change' ? (
                            <span>
                              <span className="line-through opacity-60">{it.oldPhrase}</span> → {it.phrase}
                            </span>
                          ) : (
                            it.phrase
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={committing}>
            취소
          </Button>
          <Button
            onClick={() => plan && onCommit(plan)}
            disabled={!canCommit || committing}
            className="bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"
            data-testid="opinion-phrase-csv-commit"
          >
            {committing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            반영 ({plan ? plan.added + plan.changed : 0}건)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function OpinionPhrasesTab() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;
  // T-20260620-foot-OPINIONPHRASE-EDIT-DIRECTOR-ONLY (문지은 대표원장): 소견서 상용구 편집(추가/수정/삭제)
  //   = 어드민의사(대표원장)만. ROLE-MATRIX hasOpsAuthority primitive 재사용(canEditClinicMgmt) — 진료관리(ClinicManagement)
  //   write 전용 술어. 특정 유저 하드코딩 금지(추후 '어드민원장' 추가 시 has_ops_authority=true 부여로 자동 권한 획득).
  //   ★lock-out-safe: canEditClinicMgmt 가 admin escape + director escape(MUNJIEUN-CLINICMGMT-LOCKOUT stopgap)를 내장 →
  //     역배정 전/flag 미적재 상태에서도 대표원장이 편집에서 잠기지 않음. manager(role-implied ops)는 의료 surface 라 제외(read-only).
  //   ★ supersedes WRITE-RESTRICT-MEDVIEW Phase A 의 admin-only 게이트.
  const canEdit = canEditClinicMgmt(profile);

  const { data: tpl, isLoading } = useOpinionTemplateRow(clinicId);
  const saveMut = useSaveOpinionSections(clinicId);
  const csvImportMut = useCommitCsvImport(clinicId);

  // 로컬 편집 draft + 서버 동기화 baseline 식별자(서버 데이터 변동 시 재초기화).
  const [draft, setDraft] = useState<OpinionSection[]>([]);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // AC-2 토글: 같은 영역에서 섹션(소견서/진단서 그룹)을 토글로 전환. '__all__' = 전체.
  const [sectionFilter, setSectionFilter] = useState<string>('__all__');
  // AC-4 CSV 대량입력 다이얼로그.
  const [csvOpen, setCsvOpen] = useState(false);

  const phraseMeta = tpl?.phraseMeta ?? {};
  const importLog = tpl?.importLog ?? [];
  const lastImport = importLog.length > 0 ? importLog[importLog.length - 1] : null;
  // 업로드 반영 대상 = 서버 확정본(OpinionDocTab read 소스). 미저장 draft 와 분리.
  const updatedBy = profile?.name || profile?.id || '알수없음';

  // AC-4 seed: DB sections 가 비면 현행 OPINION_SECTIONS 기본값으로 초기화 후 편집.
  const serverSections: OpinionSection[] = useMemo(
    () => (tpl ? (tpl.sections.length > 0 ? tpl.sections : OPINION_SECTIONS) : []),
    [tpl],
  );
  // 서버 데이터 도착/변동 시 draft 초기화(미저장 변경이 없을 때만 — 사용자 작업 보호).
  const serverSig = tpl ? JSON.stringify(tpl.sections) : null;
  if (tpl && serverSig !== baseline && !dirty) {
    setBaseline(serverSig);
    setDraft(JSON.parse(JSON.stringify(serverSections)));
  }

  // 옵션 다이얼로그 상태.
  const [optDialog, setOptDialog] = useState<{
    sectionIdx: number;
    optIdx: number | null; // null = 추가
  } | null>(null);
  // 섹션 다이얼로그 상태.
  const [secDialog, setSecDialog] = useState<{ idx: number | null } | null>(null); // idx null = 추가

  const allKeys = useMemo(() => {
    const s = new Set<string>();
    for (const sec of draft) for (const o of sec.options) s.add(o.key);
    return s;
  }, [draft]);

  const markDirty = () => setDirty(true);

  // ── 옵션 CRUD (AC-2) ──
  const submitOption = (label: string, phrase: string) => {
    if (!optDialog) return;
    const { sectionIdx, optIdx } = optDialog;
    setDraft((prev) => {
      const next = prev.map((s) => ({ ...s, options: [...s.options] }));
      if (optIdx === null) {
        const key = genOptionKey(allKeys);
        next[sectionIdx].options.push({ key, label, phrase });
      } else {
        const cur = next[sectionIdx].options[optIdx];
        next[sectionIdx].options[optIdx] = { ...cur, label, phrase };
      }
      return next;
    });
    markDirty();
  };

  const deleteOption = (sectionIdx: number, optIdx: number, label: string) => {
    if (!confirm(`"${label}" 버튼을 삭제할까요?`)) return;
    setDraft((prev) => {
      const next = prev.map((s) => ({ ...s, options: [...s.options] }));
      next[sectionIdx].options.splice(optIdx, 1);
      return next;
    });
    markDirty();
  };

  // ── 섹션 CRUD (AC-6) ──
  const submitSection = (title: string) => {
    if (!secDialog) return;
    const { idx } = secDialog;
    setDraft((prev) => {
      if (idx === null) return [...prev, { title, options: [] }];
      return prev.map((s, i) => (i === idx ? { ...s, title } : s));
    });
    markDirty();
  };

  const deleteSection = (idx: number, title: string, optCount: number) => {
    if (!confirm(`"${title}" 섹션을 삭제할까요?${optCount > 0 ? ` (버튼 ${optCount}개 포함)` : ''}`)) return;
    setDraft((prev) => prev.filter((_, i) => i !== idx));
    markDirty();
  };

  // ── 저장 (AC-3) ──
  const handleSave = async () => {
    if (!tpl) return;
    // 빈 섹션 제목 방지(읽기 파서가 빈 title 섹션을 버리므로 사전 차단).
    if (draft.some((s) => !s.title.trim())) {
      toast.error('이름이 비어있는 섹션이 있습니다. 섹션 이름을 입력해주세요.');
      return;
    }
    await saveMut.mutateAsync({
      templateId: tpl.id,
      baseFieldMap: tpl.fieldMap,
      sections: draft,
    });
    setDirty(false);
    setBaseline(null); // 재조회 후 draft 재동기화 트리거.
  };

  const handleReset = () => {
    if (dirty && !confirm('저장하지 않은 변경사항을 되돌릴까요?')) return;
    setDraft(JSON.parse(JSON.stringify(serverSections)));
    setDirty(false);
  };

  // ── AC-3 양식 CSV 다운로드 — 현행 값(서버 확정본) 채워서 export ──
  const handleDownloadCsv = () => {
    downloadPhraseCsv(serverSections, phraseCsvFilename());
  };

  // ── AC-4 CSV 업로드 열기 — 미저장 변경 있으면 차단(서버 확정본 기준 반영) ──
  const handleOpenCsv = () => {
    if (dirty) {
      toast.error('저장하지 않은 변경사항이 있습니다. 먼저 [저장] 또는 [되돌리기] 후 업로드해주세요.');
      return;
    }
    setCsvOpen(true);
  };

  // ── AC-4 commit — dry-run plan 반영 ──
  const handleCommitCsv = async (plan: ImportPlan) => {
    if (!tpl) return;
    await csvImportMut.mutateAsync({
      templateId: tpl.id,
      baseFieldMap: tpl.fieldMap,
      currentSections: serverSections,
      plan,
      updatedBy,
    });
    setCsvOpen(false);
    setBaseline(null); // 재조회 후 draft 재동기화.
  };

  // 토글 표시 대상 섹션 인덱스(원본 draft 인덱스 보존 — CRUD 핸들러가 절대 인덱스 사용).
  const visibleSections = draft
    .map((section, sIdx) => ({ section, sIdx }))
    .filter(({ section }) => sectionFilter === '__all__' || section.title === sectionFilter);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="opinion-phrases-tab">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <FileText className="h-4 w-4 text-teal-600" />
            소견서 상용구
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            소견서 작성 화면의 버튼 이름과, 버튼을 눌렀을 때 자동으로 들어갈 멘트를 관리합니다.
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {/* AC-3 양식 CSV 다운로드 */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadCsv}
              data-testid="opinion-phrase-csv-download"
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              양식 다운로드
            </Button>
            {/* AC-4 CSV 대량입력 */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenCsv}
              data-testid="opinion-phrase-csv-upload"
            >
              <Upload className="mr-1 h-3.5 w-3.5" />
              CSV 업로드
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSecDialog({ idx: null })}
              data-testid="opinion-phrase-add-section"
            >
              <FolderPlus className="mr-1 h-3.5 w-3.5" />
              섹션 추가
            </Button>
            {dirty && (
              <Button variant="ghost" size="sm" onClick={handleReset} data-testid="opinion-phrase-reset">
                되돌리기
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!dirty || saveMut.isPending}
              data-testid="opinion-phrase-save-all"
              className="bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"
            >
              {saveMut.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              저장
            </Button>
          </div>
        )}
      </div>

      {/* AC-2 토글 — 소견서/진단서(섹션) 그룹을 같은 영역에서 전환. + 최신 업로드 표시(AC-5) */}
      {draft.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1" data-testid="opinion-phrase-section-toggle">
            <button
              type="button"
              onClick={() => setSectionFilter('__all__')}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                sectionFilter === '__all__'
                  ? 'bg-teal-600 text-white'
                  : 'border bg-card text-muted-foreground hover:bg-muted'
              }`}
              data-testid="opinion-phrase-toggle-all"
            >
              전체
            </button>
            {draft.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSectionFilter(s.title)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  sectionFilter === s.title
                    ? 'bg-teal-600 text-white'
                    : 'border bg-card text-muted-foreground hover:bg-muted'
                }`}
                data-testid="opinion-phrase-toggle-section"
              >
                {s.title || '(이름 없음)'}
              </button>
            ))}
          </div>
          {lastImport && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="opinion-phrase-last-import">
              <History className="h-3 w-3" />
              최신 업로드: {fmtKst(lastImport.at)} · {lastImport.by} (추가 {lastImport.added}/변경 {lastImport.changed})
            </span>
          )}
        </div>
      )}

      {dirty && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700" data-testid="opinion-phrase-dirty">
          저장하지 않은 변경사항이 있습니다. [저장]을 눌러야 소견서 화면에 반영됩니다.
        </p>
      )}

      {/* 섹션 목록 */}
      {draft.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          등록된 상용구 섹션이 없습니다.
          {canEdit && '  [섹션 추가]로 시작하세요.'}
        </div>
      ) : (
        <div className="space-y-4">
          {visibleSections.map(({ section, sIdx }) => (
            <div key={sIdx} className="rounded-lg border bg-card" data-testid="opinion-phrase-section">
              {/* 섹션 헤더 */}
              <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                <span className="text-sm font-semibold" data-testid="opinion-phrase-section-title">
                  {section.title || <span className="text-destructive">(이름 없음)</span>}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">버튼 {section.options.length}개</span>
                </span>
                {canEdit && (
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="섹션 이름 변경"
                      onClick={() => setSecDialog({ idx: sIdx })}
                      data-testid="opinion-phrase-section-edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      title="섹션 삭제"
                      onClick={() => deleteSection(sIdx, section.title, section.options.length)}
                      data-testid="opinion-phrase-section-delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              {/* 옵션 목록 */}
              <div className="divide-y divide-border/50">
                {section.options.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                    이 섹션에 버튼이 없습니다.
                  </p>
                ) : (
                  section.options.map((opt, oIdx) => (
                    <div
                      key={opt.key}
                      className="flex items-start justify-between gap-2 px-3 py-2 hover:bg-muted/20"
                      data-testid="opinion-phrase-option"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="inline-block rounded border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700" data-testid="opinion-phrase-option-label">
                          {opt.label}
                        </span>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground" data-testid="opinion-phrase-option-phrase">
                          {opt.phrase}
                        </p>
                        {/* AC-5: 버튼별 최신 업데이트 시각 */}
                        {phraseMeta[opt.key]?.last_updated_at && (
                          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/70" data-testid="opinion-phrase-option-updated">
                            <History className="h-2.5 w-2.5" />
                            최신 업데이트: {fmtKst(phraseMeta[opt.key]?.last_updated_at)}
                            {phraseMeta[opt.key]?.updated_by ? ` · ${phraseMeta[opt.key]?.updated_by}` : ''}
                          </p>
                        )}
                      </div>
                      {canEdit && (
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setOptDialog({ sectionIdx: sIdx, optIdx: oIdx })}
                            data-testid="opinion-phrase-option-edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => deleteOption(sIdx, oIdx, opt.label)}
                            data-testid="opinion-phrase-option-delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* 옵션 추가 */}
              {canEdit && (
                <div className="border-t px-3 py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-teal-600 hover:text-teal-700"
                    onClick={() => setOptDialog({ sectionIdx: sIdx, optIdx: null })}
                    data-testid="opinion-phrase-add-option"
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    버튼 추가
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/70">
        ※ 여기서 만든 버튼은 진료 &gt; 소견서 작성 화면 왼쪽에 그대로 나타납니다. 버튼을 누르면 [자동삽입 멘트]가 소견 내용에 들어가며, 원장님이 자유롭게 수정할 수 있습니다. 변경 후 반드시 [저장]을 눌러야 소견서 화면에 반영됩니다.
      </p>

      {/* 옵션 다이얼로그 */}
      <OptionDialog
        open={!!optDialog}
        onOpenChange={(v) => { if (!v) setOptDialog(null); }}
        initial={
          optDialog && optDialog.optIdx !== null
            ? {
                label: draft[optDialog.sectionIdx]?.options[optDialog.optIdx]?.label ?? '',
                phrase: draft[optDialog.sectionIdx]?.options[optDialog.optIdx]?.phrase ?? '',
              }
            : null
        }
        sectionTitle={optDialog ? (draft[optDialog.sectionIdx]?.title ?? '') : ''}
        onSubmit={submitOption}
      />

      {/* 섹션 다이얼로그 */}
      <SectionTitleDialog
        open={!!secDialog}
        onOpenChange={(v) => { if (!v) setSecDialog(null); }}
        initialTitle={secDialog && secDialog.idx !== null ? (draft[secDialog.idx]?.title ?? '') : null}
        onSubmit={submitSection}
      />

      {/* AC-4 CSV 대량입력 다이얼로그 */}
      <CsvImportDialog
        open={csvOpen}
        onOpenChange={(v) => setCsvOpen(v)}
        currentSections={serverSections}
        committing={csvImportMut.isPending}
        onCommit={handleCommitCsv}
      />
    </div>
  );
}
