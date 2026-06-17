/**
 * T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL — Part C '이름 숨기기' 영속화
 *
 * 현장요청(문지은 대표원장, MSG-20260617-131918-mthl):
 *   "묶음처방 생성 팝업에서 이름 옆 '이름 숨기기 <' 토글 → 태그에 아이콘(이모지)+색상만, 이름 생략.
 *    목록 렌더 시 재현 필요" → 화면 표시만으로 불충분, 영속 저장(hide_name).
 *
 * data-architect CONSULT GO(MSG-20260617-203508-xyql):
 *   ADDITIVE 무조건 GO — prescription_sets = foot-local, cross_crm 미등재 → cross-product 영향 0.
 *   TAG tag_meta(8fdf5ab6) tag_label/tag_color/icon 위 4번째 동형 적층.
 *   NULL→false = 현행 OFF(이름 표시) 보존, 회귀 0, 안전 기본값. CHECK 불요. CEO 게이트 면제(§3.1).
 *
 * AC-1: 마이그 = ADDITIVE 1컬럼 hide_name BOOLEAN NULL DEFAULT false (멱등·완전가역)
 * AC-2: 생성 팝업·태그편집 양쪽 '이름 숨기기' 토글 + 미리보기(아이콘+색만)
 * AC-3: hide_name 영속(insert/update payload) + query select 포함
 * AC-4: 진료화면 칩 렌더 — hide_name ON 시 라벨 생략, icon-only(라벨 NULL) 태그도 노출
 *
 * 소스 정적 검사 + 마이그/정책(DA GO) 회귀가드 (TAG-QUICKTRIGGER spec 패턴 미러).
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

const MIG = read('supabase/migrations/20260617120000_rxset_hide_name.sql');
const ROLLBACK = read('supabase/migrations/20260617120000_rxset_hide_name.rollback.sql');
const SETS_TAB = read('src/components/admin/PrescriptionSetsTab.tsx');
const TAG_BAR = read('src/components/doctor/BundleRxTagBar.tsx');

// ── AC-1: 데이터 모델 ADDITIVE 1컬럼 (DA GO) ───────────────────────────────
test.describe('데이터 모델 ADDITIVE — AC-1 / DA GO', () => {
  test('마이그는 hide_name BOOLEAN을 ADD COLUMN IF NOT EXISTS DEFAULT false (멱등·비파괴·안전기본값)', () => {
    expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS hide_name boolean NULL DEFAULT false/i);
    // NULL→false = 현행 OFF(이름표시) 보존 → DEFAULT false 필수
    expect(MIG).toMatch(/DEFAULT false/i);
  });

  test('DB CHECK 미부여(표지 플래그) — 팔레트/상태머신 결합비용 회피', () => {
    expect(stripComments(MIG)).not.toMatch(/CHECK\s*\(/i);
  });

  test('완전 가역 — rollback 은 DROP COLUMN IF EXISTS hide_name', () => {
    expect(ROLLBACK).toContain('DROP COLUMN IF EXISTS hide_name');
  });
});

// ── AC-2: '이름 숨기기' 토글 UI + 미리보기 (PrescriptionSetsTab) ─────────────
test.describe("'이름 숨기기' 토글 UI — AC-2", () => {
  test('TagEditorFields 공통 컴포넌트 — 생성 팝업·태그편집 양쪽 재사용(분기 방지)', () => {
    expect(SETS_TAB).toContain('function TagEditorFields');
    expect(SETS_TAB).toContain('hidename-toggle');
    expect(SETS_TAB).toContain('hidename-wrap');
  });

  test('미리보기 칩이 hide_name 반영 — ON 시 아이콘+색만(라벨 생략)', () => {
    // 미리보기 라벨은 hide_name 일 때 미출력
    expect(SETS_TAB).toContain('{!value.hide_name && value.tag_label.trim()}');
    // 이름숨김+아이콘만 케이스도 미리보기 노출
    expect(SETS_TAB).toMatch(/value\.tag_label\.trim\(\)\s*\|\|\s*\(value\.hide_name && value\.icon\)/);
  });
});

// ── AC-3: hide_name 영속 + query select ────────────────────────────────────
test.describe('hide_name 영속 — AC-3', () => {
  test('query 가 hide_name 을 select (admin 목록)', () => {
    expect(SETS_TAB).toContain("'id, name, items, is_active, sort_order, folder, tag_label, tag_color, icon, hide_name'");
  });

  test('useUpsertSet insert/update payload 에 hide_name 포함', () => {
    expect(SETS_TAB).toMatch(/hide_name:\s*!!form\.hide_name/);
  });

  test('useUpdateSetTagMeta(경량 편집) payload 에도 hide_name 포함', () => {
    expect(SETS_TAB).toMatch(/hide_name:\s*!!meta\.hide_name/);
  });

  test('이름숨김+아이콘만 태그도 색 보존 — hasTag = 라벨 OR 아이콘(icon-only 칩 미렌더 회귀 방지)', () => {
    // 라벨만으로 판단하던 구버전 회귀 방지: 아이콘만 있어도 tag_color 보존
    expect(SETS_TAB).toMatch(/const hasTag = label !== '' \|\| (iconV|meta\.icon\.trim\(\)) !== '';/);
  });
});

// ── AC-4: 진료화면 칩 렌더 — hide_name ON 라벨 생략 + icon-only 노출 ──────────
test.describe('진료화면 칩 렌더 — AC-4', () => {
  test('BundleRxTagBar query 가 hide_name select + 라벨 OR 아이콘으로 넓게 읽기', () => {
    expect(TAG_BAR).toContain("'id, name, items, tag_label, tag_color, icon, hide_name'");
    // icon-only(라벨 NULL) 태그 포함 위해 OR 필터
    expect(TAG_BAR).toContain("'tag_label.not.is.null,icon.not.is.null'");
  });

  test('칩은 hide_name ON 시 라벨 텍스트 생략(아이콘+색만 렌더)', () => {
    expect(TAG_BAR).toContain('{!b.hide_name && labelText}');
    expect(TAG_BAR).toContain("data-hide-name={b.hide_name ? 'true' : 'false'}");
  });

  test('라벨 없는 icon-only 태그는 name 폴백으로 접근성/토스트 식별', () => {
    expect(TAG_BAR).toMatch(/const accName = labelText \|\| b\.name/);
    expect(TAG_BAR).toMatch(/const tagName = \(b\.tag_label && b\.tag_label\.trim\(\)\) \|\| b\.name/);
  });
});
