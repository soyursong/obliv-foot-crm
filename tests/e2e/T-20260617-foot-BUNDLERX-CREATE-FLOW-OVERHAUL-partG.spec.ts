/**
 * T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL — Part G: 우측 단(생성된 묶음처방) 표시·편집·전체펼침
 *
 * 현장요청(문지은 대표원장, MSG-20260617-220319-0b5d, in-flight OVERHAUL 테스트 중):
 *   "묶음처방 만들었는데 1개 처방세트 < 라고 뜨네. 묶음처방으로 바꿔주고, 수정할 수 있게 해주고,
 *    미리보기 말고 무조건 전체 폴드로 다 보이게 해줘 (우측 단)."
 * responder 재분해(MSG-20260617-220542-aaej, §0.11) → G1a/G1b/G2/G3.
 *
 * G1a [P0-fix·verify]: "1개 처방세트 <" 의 "<" = HTML 엔티티 escape 버그로 재규명됐으나,
 *    dev 코드확인 결과 우측 단 헤더(`{sets.length}개 처방세트`)에 `&lt;` 리터럴/이스케이프 버그 부재.
 *    → reporter 가 본 "<" 는 (a)카운트 라벨 '처방세트' 용어 + (b)미리보기 접힘 상태의 표현.
 *    회귀가드: 우측 단 카운트 라벨에 raw "<"/`&lt;` 미노출(plain text 렌더).
 * G1b [RENAME]: 우측 단 라벨 "처방세트" → "묶음처방"(카운트/추가버튼/빈상태/생성·수정 다이얼로그).
 * G2  [FEATURE]: 우측 단 생성 묶음처방 '수정'(이름/색/아이콘/이름숨김/약·1·3·2) — 생성 팝업 재사용, upsert {id}.
 * G3  [UI]: 우측 단 목록 미리보기/접힘(slice 3 + "+N개 항목 더") 제거 → 무조건 전체 펼침.
 *
 * TAG-QUICKTRIGGER / hidename spec 패턴 미러 — 소스 정적 검사(회귀0 presentation 위주).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p: string) => resolve(__dirname, '../../', p);
const read = (p: string) => readFileSync(root(p), 'utf8');
// 부정(.not) 검증은 코드만 대상 — 설명 주석의 단어로 인한 거짓 실패 방지.
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SETS_TAB = read('src/components/admin/PrescriptionSetsTab.tsx');
const CODE = stripComments(SETS_TAB);

// ── G1a: "<" escape 버그 부재 회귀가드 (우측 단 카운트 라벨 plain text) ──────────
test.describe('G1a — 우측 단 라벨 escape 버그 부재(verify)', () => {
  test('우측 단 카운트 라벨은 plain text({sets.length}개 묶음처방) — raw "<"/&lt; 미노출', () => {
    // 카운트 라벨 자체에 꺾쇠/엔티티 리터럴이 섞여있지 않음
    expect(CODE).toMatch(/\{sets\.length\}개 묶음처방/);
    expect(CODE).not.toContain('처방세트 &lt;');
    expect(CODE).not.toContain('개 처방세트 <');
  });

  test('우측 단 렌더에 dangerouslySetInnerHTML(이스케이프 누락 경로) 미사용', () => {
    expect(CODE).not.toContain('dangerouslySetInnerHTML');
  });
});

// ── G1b: 라벨 "처방세트" → "묶음처방" ─────────────────────────────────────────
test.describe('G1b — 우측 단 라벨 묶음처방 통일', () => {
  test('카운트 라벨 = "{sets.length}개 묶음처방"', () => {
    expect(SETS_TAB).toContain('data-testid="rx-set-count-label"');
    expect(SETS_TAB).toContain('{sets.length}개 묶음처방');
    // 구 라벨 "{sets.length}개 처방세트" 잔존 금지
    expect(SETS_TAB).not.toContain('{sets.length}개 처방세트');
  });

  test('추가 버튼·빈 상태·생성/수정 다이얼로그 라벨이 묶음처방', () => {
    expect(SETS_TAB).toContain('묶음처방 추가');
    expect(SETS_TAB).toContain('등록된 묶음처방이 없습니다.');
    // 생성/수정 다이얼로그 제목 묶음처방
    expect(SETS_TAB).toContain("editing ? '묶음처방 수정' : '묶음처방 추가'");
    expect(SETS_TAB).toContain("editingSetId != null ? '묶음처방 수정' : '묶음처방 만들기'");
  });
});

// ── G2: 우측 단 생성 묶음처방 수정 ────────────────────────────────────────────
test.describe('G2 — 우측 단 묶음처방 수정(생성 팝업 재사용)', () => {
  test('케밥에 "수정" 진입점 재도입 + openEditBundle 배선', () => {
    expect(SETS_TAB).toContain('data-testid="rx-set-action-edit"');
    expect(SETS_TAB).toContain('onEdit={() => openEditBundle(s)}');
    expect(SETS_TAB).toContain('function openEditBundle');
  });

  test('편집은 별도 컴포넌트 없이 생성 팝업 재사용 — editingSetId 모드', () => {
    expect(SETS_TAB).toMatch(/const \[editingSetId, setEditingSetId\] = useState<number \| null>\(null\)/);
    // 저장 시 editingSetId 있으면 update({id}), 없으면 insert
    expect(SETS_TAB).toMatch(/upsert\.mutateAsync\(\{\s*id: editingSetId \?\? undefined,/);
  });

  test('레거시(태그 없는) 세트도 name 을 태그라벨로 승계해 편집 가능(이름 보존)', () => {
    expect(SETS_TAB).toMatch(/tag_label: \(s\.tag_label \?\? ''\)\.trim\(\) !== '' \? \(s\.tag_label as string\) : s\.name/);
    // items 깊은복사(편집 중 원본 불변)
    expect(SETS_TAB).toMatch(/items: \(s\.items \?\? \[\]\)\.map\(\(it\) => \(\{ \.\.\.it \}\)\)/);
  });

  test('수정 저장은 기존 prescription_sets update 경로 재사용(신규 모델 X)', () => {
    // useUpsertSet update 분기 그대로 사용
    expect(SETS_TAB).toContain("supabase.from('prescription_sets').update(payload).eq('id', id)");
  });
});

// ── G3: 우측 단 무조건 전체 펼침 ──────────────────────────────────────────────
test.describe('G3 — 우측 단 전체 펼침(미리보기/접힘 제거)', () => {
  test('slice(0, 3) 미리보기 절단 + "+N개 항목 더" 접힘 라벨 제거', () => {
    expect(CODE).not.toContain('s.items.slice(0, 3)');
    expect(CODE).not.toContain('개 항목 더');
  });

  test('포함 약 전체를 map 으로 전부 렌더', () => {
    expect(SETS_TAB).toContain('data-testid="rx-set-items-expanded"');
    expect(SETS_TAB).toMatch(/\{s\.items\.map\(\(item, idx\) =>/);
  });
});
