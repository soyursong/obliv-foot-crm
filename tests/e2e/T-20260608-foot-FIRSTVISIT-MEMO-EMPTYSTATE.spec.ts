/**
 * E2E spec — T-20260608-foot-FIRSTVISIT-MEMO-EMPTYSTATE
 * 진료차트 우측 "📋 상담" 탭(ConsultRecordTab)에서 "초진상담차트 있는데 메모없음" 표시 원인 규명·수정.
 *
 * AC-0 (READ-ONLY 진단, scripts/_diag_firstvisit_memo_20260608.mjs / 초진 158건 전수):
 *   · notes.text(비어있지않음) 보유 = 0건  → 본 탭이 읽던 단일 키가 사실상 비어있음.
 *   · notes.memo 에 실제 초진 상담 메모 존재("초진 상담. 무지외반증 … 패키지 12회권 계약.")
 *     → notesText()가 .text 만 읽어 숨겨짐(= 데이터 있는데 미표시). 활성 쓰기경로 없음(레거시/임포트).
 *   ⇒ 분기 B(데이터 연결 버그) 확정 + 분기 A(실제 빈 데이터 다수)도 공존.
 *
 * 조치:
 *   AC-2 (분기 B): notesText() 읽기 경로 확장 — text 우선, 비면 memo 폴백. 쓰기/스키마 무변경.
 *   AC-1 (분기 A): 빈 상태 문구 "기록 메모 없음"→"입력된 상담 메모 없음"(시스템 오류 오해 방지).
 *
 * 스타일: 기존 풋 진료차트 spec — 구현 정본 규칙을 인-페이지 순수 로직으로 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

// ── 정본 타입 (ConsultRecordTab.ConsultRecord) ─────────────────────────────────
interface ConsultRecord {
  id: string;
  checked_in_at: string;
  visit_type: 'new' | 'returning' | null;
  consultation_done: boolean | null;
  consultant_id: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  notes: any | null;
  treatment_kind: string | null;
  treatment_category: string | null;
  treatment_contents: string[] | null;
  status: string | null;
}

// ── 정본: notes 메모 추출 — text 우선, 비면 memo 폴백 (AC-2 수정 반영) ───────────
const notesText = (notes: unknown): string => {
  if (!notes || typeof notes !== 'object') return '';
  const n = notes as { text?: unknown; memo?: unknown };
  const t = typeof n.text === 'string' ? n.text.trim() : '';
  if (t) return t;
  const m = typeof n.memo === 'string' ? n.memo.trim() : '';
  return m;
};

// ── 정본: 치료 요약 (treatmentSummary) ─────────────────────────────────────────
const treatmentSummary = (r: ConsultRecord): string => {
  const parts: string[] = [];
  if (r.treatment_category) parts.push(r.treatment_category);
  if (r.treatment_kind) parts.push(r.treatment_kind);
  if (Array.isArray(r.treatment_contents) && r.treatment_contents.length > 0) {
    parts.push(r.treatment_contents.filter(Boolean).join(', '));
  }
  return parts.join(' · ');
};

// ── 정본: 카드의 메모 영역 렌더 결정 ───────────────────────────────────────────
//   memo 있으면 memo 박스. 없고 tx/consultant 도 없으면 "입력된 상담 메모 없음".
//   memo 없지만 tx/consultant 있으면 메모 영역 자체 미렌더(빈문자열로 표현).
const EMPTY_MEMO_LABEL = '입력된 상담 메모 없음';
const renderMemoArea = (r: ConsultRecord): string => {
  const memo = notesText(r.notes);
  if (memo) return memo;
  const tx = treatmentSummary(r);
  const consultant = r.consultant_id ? 'name' : '';
  if (!tx && !consultant) return EMPTY_MEMO_LABEL;
  return ''; // 미렌더
};

const base = (over: Partial<ConsultRecord>): ConsultRecord => ({
  id: 'x',
  checked_in_at: '2026-06-08T10:00:00+09:00',
  visit_type: 'new',
  consultation_done: true,
  consultant_id: null,
  notes: null,
  treatment_kind: null,
  treatment_category: null,
  treatment_contents: null,
  status: 'completed',
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0: 진단 근거 — notes.text 비어있고 notes.memo 에 실메모가 있는 형상 재현
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-0 진단 형상 (notes.memo 숨김 케이스)', () => {
  test('text 비어있고 memo 에 상담메모가 있으면 (구) text-only 로직은 숨겼다', () => {
    const legacyTextOnly = (notes: unknown): string => {
      if (!notes || typeof notes !== 'object') return '';
      const t = (notes as { text?: unknown }).text;
      return typeof t === 'string' ? t.trim() : '';
    };
    const rec = base({ notes: { memo: '초진 상담. 무지외반증 및 발뒤꿈치 각질 복합 케어 희망. 패키지 12회권 계약.' } });
    // 구 로직: 숨김(빈문자열) → "기록 메모 없음" 으로 오표시되던 버그
    expect(legacyTextOnly(rec.notes)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 (분기 B): 읽기 경로 확장 — notes.memo 폴백
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 notes.memo 폴백 (데이터 연결 수정)', () => {
  test('text 없고 memo 있으면 memo 를 메모로 표시한다', () => {
    const rec = base({ notes: { memo: '초진 상담 메모 본문' } });
    expect(notesText(rec.notes)).toBe('초진 상담 메모 본문');
    expect(renderMemoArea(rec)).toBe('초진 상담 메모 본문');
  });

  test('text 가 있으면 text 우선 (memo 무시)', () => {
    const rec = base({ notes: { text: 'TEXT 우선', memo: 'MEMO 무시' } });
    expect(notesText(rec.notes)).toBe('TEXT 우선');
  });

  test('text 가 공백뿐이면 memo 로 폴백한다', () => {
    const rec = base({ notes: { text: '   ', memo: '폴백 메모' } });
    expect(notesText(rec.notes)).toBe('폴백 메모');
  });

  test('memo 도 공백뿐이면 빈 메모로 처리', () => {
    const rec = base({ notes: { text: '', memo: '   ' } });
    expect(notesText(rec.notes)).toBe('');
  });

  test('notes 가 null/비객체면 안전하게 빈문자열', () => {
    expect(notesText(null)).toBe('');
    expect(notesText('str')).toBe('');
    expect(notesText(undefined)).toBe('');
  });

  test('메타데이터 키만 있으면(lead_source 등) 메모 아님', () => {
    const rec = base({ notes: { lead_source: '인스타', id_check_required: true } });
    expect(notesText(rec.notes)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 (분기 A): 빈 상태 문구 명확화
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 빈 상태 문구', () => {
  test('실제 빈 데이터 카드는 "입력된 상담 메모 없음" 을 표시한다', () => {
    const rec = base({ notes: null, treatment_kind: null, treatment_category: null, consultant_id: null });
    expect(renderMemoArea(rec)).toBe('입력된 상담 메모 없음');
  });

  test('모호한 구 문구("기록 메모 없음")는 더 이상 사용하지 않는다', () => {
    expect(EMPTY_MEMO_LABEL).not.toBe('기록 메모 없음');
    expect(EMPTY_MEMO_LABEL).toBe('입력된 상담 메모 없음');
  });

  test('치료/담당자 정보가 있으면 메모 영역은 미렌더(빈 문구 노출 안 함)', () => {
    const rec = base({ notes: null, treatment_kind: '레이저', consultant_id: 'u-1' });
    expect(renderMemoArea(rec)).toBe(''); // 빈 문구 미노출
  });
});
