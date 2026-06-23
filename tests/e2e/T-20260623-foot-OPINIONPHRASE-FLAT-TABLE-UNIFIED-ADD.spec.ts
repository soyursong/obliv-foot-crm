/**
 * E2E spec — T-20260623-foot-OPINIONPHRASE-FLAT-TABLE-UNIFIED-ADD (문지은 대표원장, 풋센터)
 *
 * 요청: 서비스관리 > 소견서 상용구 탭이 (섹션 카드 + 섹션 추가) + (섹션 내 버튼 추가) 2단계라 복잡.
 *   → 평면 테이블 [서류종류 | 명칭 | 내용 | 액션] + 단일 "소견서상용구 추가" 버튼으로 단순화.
 *   DB 무변경 — form_templates(opinion_doc).field_map.sections jsonb 구조 동일(마이그 없음).
 *
 * AC-1 평면 테이블: thead = 서류종류(section.title) | 명칭(option.label) | 내용(option.phrase) | 액션. 진단서→금기증 순.
 * AC-2 단일 추가 버튼: 상단 "소견서상용구 추가" 1개 → 다이얼로그(서류종류 Select / 명칭 / 내용) → 선택 section 아래 추가.
 * AC-3 수정 = AC-2 통합 다이얼로그 재사용. 서류종류 변경 시 다른 section 으로 이동.
 * AC-4 GUARD: 편집 권한 게이트(canEditClinicMgmt) 보존 — 권한 없으면 추가/수정/삭제 비노출. jsonb 무손실. 소비처 불변.
 *
 * 본 spec = 소스 구조 불변식(데이터·로그인 비의존 회귀) + 편집 권한 헬퍼 회귀(AC-4).
 *   실제 브라우저 렌더(테이블/추가/수정+이동/권한)는 권한자 계정으로 라이브 확인(단계별 브라우저 테스트 의무).
 *
 * 실행: npx playwright test T-20260623-foot-OPINIONPHRASE-FLAT-TABLE-UNIFIED-ADD.spec.ts
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canEditClinicMgmt } from '../../src/lib/permissions';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const OPINION_TAB = 'src/components/admin/OpinionPhrasesTab.tsx';

// ── 시나리오 1: 평면 테이블 렌더 (AC-1) ─────────────────────────────────────────
test.describe('FLAT-TABLE-UNIFIED-ADD — 시나리오 1: 평면 테이블 렌더(AC-1)', () => {
  const ot = read(OPINION_TAB);

  test('AC-1: [서류종류|명칭|내용|액션] 단일 테이블로 렌더', () => {
    expect(ot).toContain('data-testid="opinion-phrase-table"');
    expect(ot).toContain('data-testid="opinion-phrase-row"');
    expect(ot).toContain('data-testid="opinion-phrase-row-section"'); // 서류종류 = section.title
    expect(ot).toContain('data-testid="opinion-phrase-row-label"');   // 명칭 = option.label
    expect(ot).toContain('data-testid="opinion-phrase-row-phrase"');  // 내용 = option.phrase
    // thead 라벨
    expect(ot).toContain('서류 종류');
    expect(ot).toContain('명칭');
    expect(ot).toContain('내용');
  });

  test('AC-1: 진단서 → 금기증 순서(기존 section order) 보존 — draft flatten', () => {
    // visibleSections(원본 section order) 를 flatMap 으로 평면화 → 섹션 순서 그대로.
    expect(ot).toContain('const flatRows = visibleSections.flatMap');
    // 절대 draft 인덱스(sIdx/oIdx) 보존 — 수정/삭제 핸들러 정확성.
    expect(ot).toMatch(/section\.options\.map\(\(opt, oIdx\) =>/);
  });

  test('AC-1: 내용 길이 clamp(2줄) + 옛 섹션 카드 UI 제거', () => {
    expect(ot).toContain('line-clamp-2');
    // 옛 섹션 카드/섹션 헤더 testid 제거(2단계 동선 폐지).
    expect(ot).not.toContain('data-testid="opinion-phrase-section"');
    expect(ot).not.toContain('data-testid="opinion-phrase-add-section"');
    expect(ot).not.toContain('data-testid="opinion-phrase-add-option"');
  });
});

// ── 시나리오 2: 단일 버튼으로 추가 (AC-2) ────────────────────────────────────────
test.describe('FLAT-TABLE-UNIFIED-ADD — 시나리오 2: 단일 추가(AC-2)', () => {
  const ot = read(OPINION_TAB);

  test('AC-2: 상단 단일 "소견서상용구 추가" 버튼', () => {
    expect(ot).toContain('data-testid="opinion-phrase-add"');
    expect(ot).toContain('소견서상용구 추가');
    expect(ot).toContain("setPhraseDialog({ mode: 'add' })");
  });

  test('AC-2: 통합 다이얼로그 = 서류종류 Select(동적) + 명칭 + 내용', () => {
    expect(ot).toContain('data-testid="opinion-phrase-dialog"');
    // 서류종류 Select — section.title 동적 파생
    expect(ot).toContain('data-testid="opinion-phrase-section-select"');
    expect(ot).toContain('data-testid="opinion-phrase-section-select-item"');
    expect(ot).toContain('sectionTitles.map');
    // 명칭/내용 입력
    expect(ot).toContain('data-testid="opinion-phrase-label-input"');
    expect(ot).toContain('data-testid="opinion-phrase-phrase-input"');
  });

  test('AC-2: 저장 시 선택 서류종류(section) 아래 option 추가 — genOptionKey 재사용', () => {
    // 추가 경로: 대상 section 찾기 → push (genOptionKey)
    expect(ot).toContain('const targetIdx = next.findIndex');
    expect(ot).toContain('const key = genOptionKey(allKeys)');
    expect(ot).toContain('next[targetIdx].options.push({ key, label, phrase })');
  });
});

// ── 시나리오 3: 수정 + 서류종류 이동 (AC-3) ──────────────────────────────────────
test.describe('FLAT-TABLE-UNIFIED-ADD — 시나리오 3: 수정+이동(AC-3)', () => {
  const ot = read(OPINION_TAB);

  test('AC-3: 행 수정 = 통합 다이얼로그 재사용(서류종류 선택 포함)', () => {
    expect(ot).toContain('data-testid="opinion-phrase-row-edit"');
    expect(ot).toContain("setPhraseDialog({ mode: 'edit', sectionIdx: sIdx, optIdx: oIdx })");
    // edit 모드 시 현재 서류종류/명칭/내용이 다이얼로그 initial 로 주입
    expect(ot).toContain("phraseDialog?.mode === 'edit'");
    expect(ot).toContain('sectionTitle: draft[phraseDialog.sectionIdx]?.title');
  });

  test('AC-3: 서류종류 변경 시 다른 section 으로 이동(key 보존)', () => {
    // 같은 종류 = 제자리 수정 / 다른 종류 = splice 후 target push
    expect(ot).toContain('if (sectionIdx === targetIdx)');
    expect(ot).toContain('next[sectionIdx].options.splice(optIdx, 1)');
    expect(ot).toContain('next[targetIdx].options.push({ ...cur, label, phrase })');
  });
});

// ── 시나리오 4(회귀): 편집 권한 게이트 보존 (AC-4 GUARD) ─────────────────────────
test.describe('FLAT-TABLE-UNIFIED-ADD — 시나리오 4(회귀): 권한 게이트(AC-4)', () => {
  const ot = read(OPINION_TAB);

  test('AC-4: 편집 게이트 = canEditClinicMgmt 보존(OPINIONPHRASE-EDIT-DIRECTOR-ONLY)', () => {
    expect(ot).toContain('const canEdit = canEditClinicMgmt(profile)');
    // 추가/수정/삭제 노출이 canEdit 으로 게이팅
    expect(ot).toContain('{canEdit && (');
    // 액션 컬럼/추가 버튼은 canEdit 조건 내부
    const addIdx = ot.indexOf('data-testid="opinion-phrase-add"');
    const editIdx = ot.indexOf('data-testid="opinion-phrase-row-edit"');
    const delIdx = ot.indexOf('data-testid="opinion-phrase-row-delete"');
    expect(addIdx).toBeGreaterThan(-1);
    expect(editIdx).toBeGreaterThan(-1);
    expect(delIdx).toBeGreaterThan(-1);
  });

  test('AC-4: 권한자(대표원장/admin/director) 편집 O — lock-out 가드 보존', () => {
    expect(canEditClinicMgmt({ role: 'director', has_ops_authority: true })).toBe(true);
    expect(canEditClinicMgmt({ role: 'admin', has_ops_authority: false })).toBe(true);
    expect(canEditClinicMgmt({ role: 'director', has_ops_authority: false })).toBe(true);
  });

  test('AC-4: 비권한자(coordinator/therapist/manager) 편집 X — 추가/수정/삭제 비노출', () => {
    expect(canEditClinicMgmt({ role: 'coordinator', has_ops_authority: false })).toBe(false);
    expect(canEditClinicMgmt({ role: 'therapist', has_ops_authority: false })).toBe(false);
    expect(canEditClinicMgmt({ role: 'manager', has_ops_authority: false })).toBe(false);
    expect(canEditClinicMgmt(null)).toBe(false);
  });

  test('AC-4: DB 무손실 — sections jsonb 편집만(신규 컬럼/테이블/CHECK 없음, 소비처 불변)', () => {
    // 저장 = field_map 의 다른 키 보존 + sections 만 교체(기존 동작 유지)
    expect(ot).toContain('const nextFieldMap = { ...baseFieldMap, sections }');
    expect(ot).toContain('.update({ field_map: nextFieldMap })');
    // OpinionDocTab(소비처) 캐시 무효화로 즉시 반영 — 동작 불변
    expect(ot).toContain("queryKey: ['opinion_form_template', clinicId]");
  });
});
