/**
 * E2E spec — T-20260603-foot-RX-CHART-FOLLOWUP3 C-3
 * 서류템플릿 위계 재설계 (FOLLOWUP2 #2 잘못 구현 정정).
 *
 * 현장 의도(문지은 대표원장): 카테고리가 2개(category+subcategory)인 구조는 불필요.
 *   실제 = '서류이름(name) = 카테고리1' > '하위분류(subcategory) = 드롭다운' 단일 2단 위계.
 *
 * 본 spec은 in-page 순수 로직 시뮬레이션 패턴(기존 RX-* spec과 동일) — DocumentTemplatesTab
 * 구현 정본의 규칙을 모사해 회귀를 잡는다.
 *
 * 커버:
 *   C-3-1 등록 입력 구조 = name > subcategory (중복 category 입력 제거)
 *   C-3-2 그룹핑 1단계 키 = name(서류이름), 2단계 = subcategory(하위분류)
 *   C-3-3 레거시 category 컬럼 보존 — 저장 payload 에서 제외(파괴적 백필/드롭 없음)
 *   하위분류 콤보박스 sentinel(미지정/직접입력) 값 해석
 */
import { test, expect } from '@playwright/test';

const UNCATEGORIZED = '미분류';
const SUBCAT_NONE = '__none__';
const SUBCAT_CUSTOM = '__custom__';

interface DocTemplate {
  id: number;
  name: string;
  category: string | null; // 레거시(보존) — 그룹핑/입력에서 더 이상 사용 안 함
  subcategory: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// C-3-2 — 그룹핑 1단계 키 = name(서류이름), 2단계 = subcategory(하위분류)
//   정본: DocumentTemplatesTab.grouped 규칙. null/'' = 미분류.
// ═══════════════════════════════════════════════════════════════════════════

function groupByName(tpls: DocTemplate[]) {
  const out: Record<string, Record<string, DocTemplate[]>> = {};
  for (const t of tpls) {
    const c = t.name?.trim() ? t.name.trim() : UNCATEGORIZED;
    const s = t.subcategory?.trim() ? t.subcategory.trim() : UNCATEGORIZED;
    (out[c] ??= {});
    (out[c][s] ??= []).push(t);
  }
  return out;
}

test.describe('C-3-2 서류템플릿 단일 위계 그룹핑 (name > subcategory)', () => {
  test('서류이름이 1단계 카테고리, 하위분류가 2단계 — category 무시', () => {
    const tpls: DocTemplate[] = [
      // 레거시 category 가 있어도 그룹핑은 name 기준
      { id: 1, name: '진단서', category: '레이저진단서', subcategory: '위장장애' },
      { id: 2, name: '진단서', category: '엉뚱한카테고리', subcategory: '간질환' },
      { id: 3, name: '소견서', category: null, subcategory: null },
    ];
    const g = groupByName(tpls);
    // 1단계 = 서류이름
    expect(Object.keys(g)).toEqual(expect.arrayContaining(['진단서', '소견서']));
    // '진단서' 아래 하위분류 2개
    expect(Object.keys(g['진단서'])).toEqual(expect.arrayContaining(['위장장애', '간질환']));
    expect(g['진단서']['위장장애'].map((t) => t.id)).toEqual([1]);
    expect(g['진단서']['간질환'].map((t) => t.id)).toEqual([2]);
    // 하위분류 없는 소견서는 미분류 버킷
    expect(g['소견서'][UNCATEGORIZED].map((t) => t.id)).toEqual([3]);
  });

  test('레거시 category 가 그룹 키로 절대 쓰이지 않음(중복 카테고리 제거 회귀가드)', () => {
    const tpls: DocTemplate[] = [
      { id: 1, name: '처방전', category: '구카테고리A', subcategory: '일반' },
    ];
    const g = groupByName(tpls);
    expect(g['구카테고리A']).toBeUndefined();
    expect(g['처방전']).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C-3-3 — 저장 payload: 레거시 category 보존(payload 에 미포함)
//   정본: useUpsertDoc.payload 는 name + subcategory 만 기록, category 키 없음.
//   → UPDATE 시 기존 category 값 untouched(보존), INSERT 시 DB default(NULL).
// ═══════════════════════════════════════════════════════════════════════════

interface DocForm {
  document_type: string;
  name: string;
  content: string;
  is_active: boolean;
  sort_order: number;
  subcategory: string;
}

function buildSavePayload(form: DocForm) {
  return {
    document_type: form.document_type,
    name: form.name,
    content: form.content,
    is_active: form.is_active,
    sort_order: form.sort_order,
    subcategory: form.subcategory.trim() === '' ? null : form.subcategory.trim(),
    updated_at: '2026-06-04T00:00:00.000Z',
  };
}

test.describe('C-3-3 레거시 category 보존 (payload 제외)', () => {
  const form: DocForm = {
    document_type: 'diagnosis',
    name: '진단서',
    content: '내용',
    is_active: true,
    sort_order: 0,
    subcategory: '위장장애',
  };

  test('저장 payload 에 category 키가 없어 기존 값이 파괴되지 않음', () => {
    const payload = buildSavePayload(form);
    expect('category' in payload).toBe(false);
    expect(payload.name).toBe('진단서');
    expect(payload.subcategory).toBe('위장장애');
  });

  test('하위분류 공란이면 subcategory=null(미분류) 저장', () => {
    const payload = buildSavePayload({ ...form, subcategory: '   ' });
    expect(payload.subcategory).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 하위분류 콤보박스 sentinel 해석
//   정본: SubcategoryField — 미지정(__none__)='' , 직접입력(__custom__)=자유입력 전환.
// ═══════════════════════════════════════════════════════════════════════════

function resolveSubcatSelect(picked: string): { value: string; custom: boolean } {
  if (picked === SUBCAT_CUSTOM) return { value: '', custom: true };
  if (picked === SUBCAT_NONE) return { value: '', custom: false };
  return { value: picked, custom: false };
}

test.describe('하위분류 콤보박스 sentinel', () => {
  test('미지정 선택 → 빈 값(미분류)', () => {
    expect(resolveSubcatSelect(SUBCAT_NONE)).toEqual({ value: '', custom: false });
  });
  test('직접 입력 선택 → 자유 입력 모드 전환', () => {
    expect(resolveSubcatSelect(SUBCAT_CUSTOM)).toEqual({ value: '', custom: true });
  });
  test('기존 하위분류 선택 → 해당 값', () => {
    expect(resolveSubcatSelect('위장장애')).toEqual({ value: '위장장애', custom: false });
  });
});
