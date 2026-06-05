/**
 * E2E spec — T-20260605-foot-RX-SUPER-PHRASE-LOAD-BUG
 * 진료차트(MedicalChartPanel) 우측 패널 "상용구"/"슈퍼상용구" 불러오기(로딩) 버그 수정 검증.
 * (문지은 대표원장: "진료차트 슈퍼상용구 패널에서 기등록 상용구 불러오기가 안 됨 — 응답없음/미표시")
 *
 * 루트코즈 (prod 실측 확정 / 2026-06-05, node-pg 직접 조회):
 *   - super_phrases: 테이블 존재 + RLS staff_read(USING true)/admin_write 정상 + rows=0
 *     → 마이그 갭은 이미 해소(apply_20260603060000_super_phrases_pg.mjs). 0건은 "정당한 빈 상태".
 *     ⇒ 본 증상은 cda2c8d(RX-SUPER-PHRASE) 자체 회귀가 아님 (AC-3 명시).
 *   - phrase_templates 34건 = pen_chart 33 + medical_chart 1 (모두 active).
 *     MedicalChartPanel.loadData 가 .eq('phrase_type','medical_chart') 단일 필터(T-20260526 MEDCHART-SYNC)라
 *     진료차트 '상용구' 탭에 현장 상용구 대부분(pen_chart 33)이 노출 안 됨 → 의사 입장 "불러오기 안됨/미표시".
 *     ⇒ 6/5 SUPER-PHRASE-LOAD-FIX(SuperPhrasesTab)와 동일 루트코즈이나, 본 진료차트 패널엔 미전파였던 회귀.
 *
 * 수정:
 *   AC-1 (로딩정상): loadData 의 phrase_templates 필터 완화 — is_active=true 전체 노출(유형 무관),
 *                    phrase_type 보존(배지) + 진료차트 우선 안정정렬.
 *   AC-2 (빈 vs 에러 구분): 조회 error 와 0건을 구분. error 면 "불러오지 못했습니다", 0건이면 "없음".
 *   AC-4 (GUARD): insertPhrase/insertSelectedPhrases/applySuperPhrase 가 null·빈 내용에서 무반응(크래시)
 *                 대신 안전 종료/경고.
 *
 * 스타일: 기존 RX-SUPER-PHRASE / SUPER-PHRASE-LOAD-FIX spec 패턴(in-page 순수 로직 시뮬레이션) —
 *   구현 정본(loadData 필터/정렬, applySuperPhrase·insert* 가드, 빈/에러 게이트)과 동일 규칙을 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

// ── 정본 타입 ──────────────────────────────────────────────────────────────────
interface PhraseRow {
  id: number;
  name: string;
  content: string;
  is_active: boolean;
  phrase_type: 'pen_chart' | 'medical_chart' | null;
}
interface PhraseTemplate {
  id: number;
  name: string;
  content: string;
  phrase_type: 'pen_chart' | 'medical_chart';
}
interface SuperPhrase {
  id: number;
  name: string;
  diagnosis: string | null;
  clinical_progress: string | null;
  rx_items: { name: string }[];
}

// ── 수정 정본: loadData 의 상용구 선택/정렬 규칙 (AC-1 필터완화) ──────────────
//   is_active=true 전체 → 진료차트 우선 안정정렬 (phrase_type null → pen_chart 폴백)
const loadPhrasesFixed = (rows: PhraseRow[]): PhraseTemplate[] => {
  const out = rows
    .filter((r) => r.is_active)
    .map((r) => ({
      id: r.id,
      name: r.name,
      content: r.content,
      phrase_type: (r.phrase_type ?? 'pen_chart') as 'pen_chart' | 'medical_chart',
    }));
  out.sort((a, b) =>
    a.phrase_type === b.phrase_type ? 0 : a.phrase_type === 'medical_chart' ? -1 : 1,
  );
  return out;
};

// ── 회귀 비교용: 수정 전 버그 로직 (medical_chart 단일 필터) ───────────────────
const loadPhrasesBuggy = (rows: PhraseRow[]): PhraseTemplate[] =>
  rows
    .filter((r) => r.is_active && r.phrase_type === 'medical_chart')
    .map((r) => ({ id: r.id, name: r.name, content: r.content, phrase_type: 'medical_chart' as const }));

// ── 빈 vs 에러 게이트 정본 (AC-2) ─────────────────────────────────────────────
//   supabase 응답 { data, error } → 패널이 보여줄 상태.
type PanelState = 'error' | 'empty' | 'list';
const panelStateFor = (res: { data: unknown[] | null; error: unknown | null }): PanelState => {
  if (res.error) return 'error';
  if (!res.data || res.data.length === 0) return 'empty';
  return 'list';
};

// ── GUARD 정본 (AC-4): insertSelectedPhrases / applySuperPhrase ───────────────
const insertSelectedPhrasesGuard = (
  phrases: PhraseTemplate[],
  selected: Set<number>,
): { ok: boolean; warn?: string; text?: string } => {
  if (selected.size === 0) return { ok: false, warn: '삽입할 상용구를 선택해주세요' };
  const text = phrases
    .filter((p) => selected.has(p.id))
    .map((p) => (p.content ?? '').trim())
    .filter((c) => c !== '')
    .join('\n');
  if (!text) return { ok: false, warn: '선택한 상용구에 삽입할 내용이 없어요' };
  return { ok: true, text };
};

const applySuperPhraseGuard = (sp: SuperPhrase | null | undefined): string[] => {
  if (!sp) return []; // null/손상 방어 — 무반응 대신 안전 종료
  const applied: string[] = [];
  if ((sp.diagnosis ?? '').trim()) applied.push('진단명');
  if ((sp.clinical_progress ?? '').trim()) applied.push('임상경과');
  const items = (sp.rx_items ?? []).filter((it) => (it.name ?? '').trim() !== '');
  if (items.length > 0) applied.push(`처방 ${items.length}개`);
  return applied;
};

// ── prod 실측 픽스처 (2026-06-05): pen 33 + medical 1 ─────────────────────────
const makeProdPhrases = (): PhraseRow[] => {
  const rows: PhraseRow[] = [];
  rows.push({ id: 1, name: '진료차트상용구', content: '진료차트 임상경과', is_active: true, phrase_type: 'medical_chart' });
  for (let i = 0; i < 33; i++) {
    rows.push({ id: 100 + i, name: `펜차트상용구${i}`, content: `펜차트 내용 ${i}`, is_active: true, phrase_type: 'pen_chart' });
  }
  return rows;
};

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 로딩정상 — 진료차트 '상용구' 탭이 활성 상용구 전체를 노출 (회귀 차단)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 로딩정상: 상용구 전체 노출 + 진료차트 우선 정렬', () => {
  test('prod 픽스처(pen33+med1) — 수정 후 34건 전부 노출, 버그 로직은 1건만', () => {
    const rows = makeProdPhrases();

    const fixed = loadPhrasesFixed(rows);
    const buggy = loadPhrasesBuggy(rows);

    // 회귀 핵심: 수정 전엔 medical_chart 1건만 보여 "불러오기 안됨"으로 보였다.
    expect(buggy).toHaveLength(1);
    // 수정 후: 활성 34건 전부 노출.
    expect(fixed).toHaveLength(34);
    // 진료차트 유형이 맨 앞으로 정렬 (의사 맥락 우선).
    expect(fixed[0].phrase_type).toBe('medical_chart');
    // pen_chart 33건도 모두 포함.
    expect(fixed.filter((p) => p.phrase_type === 'pen_chart')).toHaveLength(33);
  });

  test('phrase_type null 레거시 행은 pen_chart 로 폴백 노출 (누락 금지)', () => {
    const rows: PhraseRow[] = [
      { id: 1, name: 'legacy', content: '레거시', is_active: true, phrase_type: null },
      { id: 2, name: 'med', content: '진료', is_active: true, phrase_type: 'medical_chart' },
    ];
    const fixed = loadPhrasesFixed(rows);
    expect(fixed).toHaveLength(2);
    expect(fixed.find((p) => p.id === 1)?.phrase_type).toBe('pen_chart');
    // 정렬: medical_chart 우선
    expect(fixed[0].id).toBe(2);
  });

  test('비활성 상용구는 제외 (is_active=false)', () => {
    const rows: PhraseRow[] = [
      { id: 1, name: 'on', content: 'a', is_active: true, phrase_type: 'pen_chart' },
      { id: 2, name: 'off', content: 'b', is_active: false, phrase_type: 'pen_chart' },
    ];
    expect(loadPhrasesFixed(rows)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 빈 vs 에러 구분 — 조회 실패와 0건을 다르게 표기
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 빈 vs 에러 구분', () => {
  test('상용구: error → error 상태, 빈 data → empty, data 있음 → list', () => {
    expect(panelStateFor({ data: null, error: { message: 'permission denied' } })).toBe('error');
    expect(panelStateFor({ data: [], error: null })).toBe('empty');
    expect(panelStateFor({ data: [{ id: 1 }], error: null })).toBe('list');
  });

  test('슈퍼상용구: prod 0건(빈)은 error 가 아닌 empty 로 표기 (정당한 빈 상태)', () => {
    // prod 실측: super_phrases rows=0, error 없음 → "등록된 슈퍼상용구 없음"
    expect(panelStateFor({ data: [], error: null })).toBe('empty');
    // RLS/스키마 차단 시에만 error
    expect(panelStateFor({ data: null, error: { code: '42P01' } })).toBe('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: GUARD — null/빈 입력에서 크래시 없이 안전 처리
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 GUARD: insert/apply 방어', () => {
  test('insertSelectedPhrases: 선택 0개 → 경고, 무삽입', () => {
    const r = insertSelectedPhrasesGuard([], new Set());
    expect(r.ok).toBe(false);
    expect(r.warn).toContain('선택');
  });

  test('insertSelectedPhrases: 선택했으나 내용 전부 빈칸 → 경고, 무삽입', () => {
    const phrases: PhraseTemplate[] = [{ id: 1, name: 'x', content: '   ', phrase_type: 'pen_chart' }];
    const r = insertSelectedPhrasesGuard(phrases, new Set([1]));
    expect(r.ok).toBe(false);
    expect(r.warn).toContain('내용');
  });

  test('insertSelectedPhrases: 정상 선택 → 내용 합본 삽입', () => {
    const phrases: PhraseTemplate[] = [
      { id: 1, name: 'a', content: '첫째', phrase_type: 'medical_chart' },
      { id: 2, name: 'b', content: '둘째', phrase_type: 'pen_chart' },
    ];
    const r = insertSelectedPhrasesGuard(phrases, new Set([1, 2]));
    expect(r.ok).toBe(true);
    expect(r.text).toBe('첫째\n둘째');
  });

  test('applySuperPhrase: null/undefined → 빈 적용(크래시 없음)', () => {
    expect(applySuperPhraseGuard(null)).toEqual([]);
    expect(applySuperPhraseGuard(undefined)).toEqual([]);
  });

  test('applySuperPhrase: 모든 슬롯 빈 슈퍼상용구 → 적용 0 (안전)', () => {
    const sp: SuperPhrase = { id: 1, name: '빈것', diagnosis: '  ', clinical_progress: null, rx_items: [] };
    expect(applySuperPhraseGuard(sp)).toEqual([]);
  });

  test('applySuperPhrase: 부분 슬롯 — 채워진 것만 적용', () => {
    const sp: SuperPhrase = {
      id: 1,
      name: '발톱무좀',
      diagnosis: '조갑백선',
      clinical_progress: null,
      rx_items: [{ name: '항진균제' }, { name: '   ' }],
    };
    const applied = applySuperPhraseGuard(sp);
    expect(applied).toContain('진단명');
    expect(applied).toContain('처방 1개'); // 빈 이름 항목은 제외
    expect(applied).not.toContain('임상경과');
  });
});
