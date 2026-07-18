// T-20260716-foot-MEDCHART-THERAPISTMEMO-INPUT-LAG-DATALOSS-RCA
// 치료메모(customer_treatment_memos) 입력 격리 컴포넌트.
//
// [RCA 근본원인] 기존 치료메모 입력 상태(newMemoText/editingMemoText)가 10,777줄 CustomerChartPage
//   부모에 존재 → 키 입력마다 부모 전체 트리(201 useState·198 비메모 배열연산) 재렌더 → 입력 지연/떨림.
//
// [해소] 입력 상태를 memoized 자식이 로컬 소유 → 키 입력 시 자식만 재렌더(부모 무재렌더).
//   부모는 안정된 콜백(onSave)·props만 전달. → 입력 매끄러움(AC-1).
//
// [무손실] 작성 중 텍스트를 sessionStorage draft(customer별 key)로 유지 →
//   부모 재렌더/탭전환/이탈/새로고침에도 복원, 저장 성공 시 draft 삭제(AC-2).
//   ⚠ 이는 브라우저 로컬 임시버퍼일 뿐 임상기록 DB 영속과 무관 —
//     customer_treatment_memos INSERT는 '메모 추가' 명시 클릭 시점에만, payload/트리거 무변경.
//   ⚠ sessionStorage(=탭 종료 시 소멸) 선택: 공용 태블릿에 PHI draft가 무기한 잔류하지 않도록.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';

export interface CustchartPhrase {
  id: number;
  name: string;
  content: string;
}

function readDraft(key: string): string {
  if (!key) return '';
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(key: string, value: string) {
  if (!key) return;
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* sessionStorage 불가(사파리 프라이빗 등) — draft만 생략, 입력·저장은 정상 */
  }
}

// ── 새 치료메모 입력 (composer) ─────────────────────────────────────────────
function TreatmentMemoComposerInner({
  phrases,
  saving,
  draftKey,
  onSave,
}: {
  phrases: CustchartPhrase[];
  saving: boolean;
  draftKey: string; // customer별 고유 (예: `foot_txmemo_draft:${customerId}`)
  onSave: (text: string) => Promise<boolean>; // 성공 시 true → draft/입력 초기화
}) {
  const [text, setText] = useState<string>(() => readDraft(draftKey));

  // customer 전환(draftKey 변경) 시 해당 customer draft로 재초기화 (교차 bleed 방지).
  const prevKey = useRef(draftKey);
  useEffect(() => {
    if (prevKey.current !== draftKey) {
      prevKey.current = draftKey;
      setText(readDraft(draftKey));
    }
  }, [draftKey]);

  // 입력 변경 → sessionStorage draft 동기화 (DB 저장 아님).
  useEffect(() => {
    writeDraft(draftKey, text);
  }, [draftKey, text]);

  const handleSave = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const ok = await onSave(trimmed);
    if (ok) {
      setText('');
      writeDraft(draftKey, '');
    }
  }, [text, onSave, draftKey]);

  return (
    <>
      {phrases.length > 0 && (
        <div>
          <label className="block text-[11px] text-muted-foreground mb-0.5">상용구</label>
          <div className="flex flex-wrap gap-1" data-testid="custchart-phrases-치료메모">
            {phrases.map(phrase => (
              <button
                key={phrase.id}
                type="button"
                onClick={() => setText(prev => prev ? `${prev} ${phrase.content}` : phrase.content)}
                className="rounded border border-sage-200 bg-sage-50 px-1.5 py-0.5 text-[10px] text-sage-700 hover:bg-sage-100 transition"
              >
                {phrase.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div>
        <label className="block text-[11px] text-muted-foreground mb-0.5">새 메모 추가</label>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="치료 메모"
          className="text-[11px] resize-none"
          data-testid="treatment-memo-new-input"
        />
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !text.trim()}
        className="w-full rounded bg-[#666666] text-white py-1.5 text-[11px] font-medium hover:bg-[#757575] transition disabled:opacity-50"
        data-testid="treatment-memo-add-btn"
      >
        {saving ? '저장 중…' : '메모 추가'}
      </button>
    </>
  );
}

export const TreatmentMemoComposer = memo(TreatmentMemoComposerInner);

// ── 기존 치료메모 수정 (editor) ─────────────────────────────────────────────
// 수정 텍스트를 로컬 소유 → 편집 중 키 입력이 부모를 재렌더하지 않음.
// 최초값은 이미 DB에 영속된 content이므로 별도 draft 불필요(원본 보존).
function TreatmentMemoEditorInner({
  initialContent,
  saving,
  onSave,
  onCancel,
}: {
  initialContent: string;
  saving: boolean;
  onSave: (text: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [text, setText] = useState<string>(initialContent);

  const handleSave = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await onSave(trimmed);
  }, [text, onSave]);

  return (
    <>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="text-[11px] resize-none"
        autoFocus
        data-testid="treatment-memo-edit-input"
      />
      <div className="flex gap-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !text.trim()}
          className="flex-1 rounded bg-neutral-800 text-white py-1 text-[11px] font-medium hover:bg-neutral-900 transition disabled:opacity-50"
        >
          {saving ? '저장 중…' : '수정 저장'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-2 rounded border border-gray-300 text-[11px] hover:bg-gray-100 transition"
        >
          취소
        </button>
      </div>
    </>
  );
}

export const TreatmentMemoEditor = memo(TreatmentMemoEditorInner);
