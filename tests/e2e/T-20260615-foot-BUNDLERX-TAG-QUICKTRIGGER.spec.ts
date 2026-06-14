/**
 * T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER
 * 묶음처방(prescription_sets) 태그/아이콘 부여 + 태그 클릭 = 빠른처방 트리거(A안 원클릭)
 *
 * 현장요청(문지은 대표원장, MSG-20260615-003419-lbkd):
 *   "묶음처방에 아이콘/태그를 추가 → 보라색 태그 [무좀]만 누르면 그 약이 뜨는 = 기존 빠른처방"
 *
 * data-architect CONSULT GO(MSG-20260615-005324-wrkc):
 *   Q1 옵션A — 이산 TEXT 3컬럼(tag_label/tag_color/icon, nullable). JSONB 아님.
 *   Q2 (a) — tag_color 는 표지 토큰. DB CHECK 미부여, FE-enforced palette(rxTagPalette.ts).
 *   Q3 — icon 은 quick_rx_buttons DRUG_ICON_OPTIONS vocab 재사용. 신규 enum/테이블 금지.
 *
 * AC-1: 묶음처방 태그/아이콘 부여 UI (PrescriptionSetsTab 케밥 '태그 편집')
 * AC-2: 태그 색상 칩(라벨+색) + 아이콘 노출
 * AC-3: 태그 클릭 = 묶음 약물 즉시 삽입(A안, 미리보기/확인팝업 없음) — quick_rx 미접촉
 * AC-4: 데이터 모델 = ADDITIVE 3컬럼(folder 선례 미러)
 *
 * 소스 정적 검사 + 정책 결정(DA GO) 회귀가드.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p: string) => resolve(__dirname, '../../', p);
const read = (p: string) => readFileSync(root(p), 'utf8');
// 부정(.not) 검증은 코드만 대상 — 설명 주석에 등장하는 단어(quick_rx_buttons/미리보기 등)로 인한
// 거짓 실패를 막기 위해 라인(//)·블록(/* */) 주석을 제거한 코드 본문으로 검사.
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MIG = read('supabase/migrations/20260615120000_rxset_tag_meta.sql');
const ROLLBACK = read('supabase/migrations/20260615120000_rxset_tag_meta.rollback.sql');
const PALETTE = read('src/lib/rxTagPalette.ts');
const SETS_TAB = read('src/components/admin/PrescriptionSetsTab.tsx');
const TAG_BAR = read('src/components/doctor/BundleRxTagBar.tsx');
const PANEL = read('src/components/doctor/DoctorTreatmentPanel.tsx');

// ── AC-4: 데이터 모델 ADDITIVE 3컬럼 (DA Q1 옵션A) ──────────────────────────
test.describe('데이터 모델 ADDITIVE — AC-4 / DA Q1', () => {
  test('마이그는 이산 TEXT 3컬럼을 ADD COLUMN IF NOT EXISTS (멱등·비파괴)', () => {
    expect(MIG).toContain('ADD COLUMN IF NOT EXISTS tag_label text');
    expect(MIG).toContain('ADD COLUMN IF NOT EXISTS tag_color text');
    expect(MIG).toContain('ADD COLUMN IF NOT EXISTS icon      text');
    // JSONB 아님(옵션A) — 단일 jsonb tag 컬럼 회귀 금지
    expect(MIG).not.toMatch(/tag\w*\s+jsonb/i);
  });

  test('DB CHECK 미부여(DA Q2 a) — tag_color 는 표지 토큰, FE-enforced', () => {
    expect(MIG).not.toMatch(/CHECK\s*\(/i);
  });

  test('완전 가역 — rollback 은 DROP COLUMN IF EXISTS 3종', () => {
    expect(ROLLBACK).toContain('DROP COLUMN IF EXISTS tag_label');
    expect(ROLLBACK).toContain('DROP COLUMN IF EXISTS tag_color');
    expect(ROLLBACK).toContain('DROP COLUMN IF EXISTS icon');
  });
});

// ── DA Q2 (a): FE-enforced canonical 팔레트 SSOT ────────────────────────────
test.describe('태그 색상 팔레트 FE-enforced SSOT — DA Q2 (a)', () => {
  test('rxTagPalette 가 canonical 토큰 + 리터럴 class 를 제공(tailwind JIT 안전)', () => {
    for (const tok of ['purple', 'teal', 'rose', 'amber', 'sky', 'emerald', 'slate']) {
      expect(PALETTE, `${tok} 팔레트 토큰`).toContain(`value: '${tok}'`);
      // chip 은 리터럴 class 여야 JIT 가 본다(동적 `bg-${x}` 금지) — 토큰별 리터럴 존재 확인
      expect(PALETTE, `${tok} 리터럴 chip class`).toContain(`bg-${tok}-100`);
    }
    // 코드 본문에는 동적 문자열 class 구성 금지(JIT 미탐지). 경고 주석은 허용 → stripComments.
    expect(stripComments(PALETTE)).not.toContain('bg-${');
    expect(PALETTE).toContain('export function tagChipClass');
    expect(PALETTE).toContain('DEFAULT_RX_TAG_COLOR');
  });
});

// ── AC-1 / AC-2: 태그 편집 UI + 칩 노출 (PrescriptionSetsTab) ───────────────
test.describe('태그 편집 UI + 칩 노출 — AC-1 / AC-2', () => {
  test('케밥에 "태그 편집" 진입점 + 경량 편집 mutation(기존 컬럼 무접촉)', () => {
    expect(SETS_TAB).toContain("data-testid=\"rx-set-action-edit-tag\"");
    expect(SETS_TAB).toContain('function useUpdateSetTagMeta');
    // 태그 메타만 UPDATE — items/name/folder 무접촉(payload 3+updated_at 만)
    expect(SETS_TAB).toMatch(/update\(payload\)\.eq\('id', id\)/);
  });

  test('태그 편집 다이얼로그: 라벨/색상팔레트/아이콘 + 미리보기', () => {
    expect(SETS_TAB).toContain("data-testid=\"rx-set-tag-dialog\"");
    expect(SETS_TAB).toContain("data-testid=\"rx-set-tag-label-input\"");
    expect(SETS_TAB).toContain("data-testid=\"rx-set-tag-color-palette\"");
    expect(SETS_TAB).toContain("data-testid=\"rx-set-tag-icon-palette\"");
    expect(SETS_TAB).toContain("data-testid=\"rx-set-tag-preview-chip\"");
  });

  test('색상/아이콘 picker 는 SSOT vocab 재사용 (RX_TAG_COLORS + DRUG_ICON_OPTIONS)', () => {
    expect(SETS_TAB).toContain("import { RX_TAG_COLORS, DEFAULT_RX_TAG_COLOR, tagChipClass } from '@/lib/rxTagPalette'");
    expect(SETS_TAB).toContain("import { DRUG_ICON_OPTIONS, IconRenderer } from '@/components/admin/QuickRxButtonsTab'");
    expect(SETS_TAB).toContain('RX_TAG_COLORS.map');
    expect(SETS_TAB).toContain('DRUG_ICON_OPTIONS.map');
  });

  test('AC-2: set 카드에 색상 칩(라벨+아이콘) 렌더 — tag_label 있을 때만', () => {
    expect(SETS_TAB).toContain("data-testid=\"rx-set-tag-chip\"");
    expect(SETS_TAB).toContain('tagChipClass(s.tag_color)');
  });

  test('라벨 비면 색까지 null 정규화(고아 색 방지)', () => {
    expect(SETS_TAB).toMatch(/tag_color:\s*label === '' \? null/);
  });

  test('query 가 신규 3컬럼을 select', () => {
    expect(SETS_TAB).toContain("'id, name, items, is_active, sort_order, folder, tag_label, tag_color, icon'");
  });
});

// ── AC-3: 태그 클릭 = 원클릭 즉시 삽입, quick_rx 미접촉 ──────────────────────
test.describe('태그 클릭 트리거 — AC-3 (A안)', () => {
  test('BundleRxTagBar 는 tag_label NOT NULL 활성 묶음만 읽는다', () => {
    expect(TAG_BAR).toContain("from('prescription_sets')");
    expect(TAG_BAR).toContain(".not('tag_label', 'is', null)");
    expect(TAG_BAR).toContain(".eq('is_active', true)");
  });

  test('A안 — onSelectItems 즉시 호출, 미리보기/확인 다이얼로그 없음', () => {
    expect(TAG_BAR).toContain('onSelectItems(items)');
    // 삽입 미리보기 모달/Dialog 없음(A안). window.confirm 은 급여 override 한정으로만 허용.
    const code = stripComments(TAG_BAR);
    expect(code).not.toContain('<Dialog');
    expect(code).not.toContain('preview');
  });

  test('게이트는 QuickRxBar 와 동일 SSOT 재사용(role + 급여)', () => {
    expect(TAG_BAR).toContain("from '@/lib/prescriptionGate'");
    expect(TAG_BAR).toContain('checkRxRoleGate');
    expect(TAG_BAR).toContain('evaluateRxInsuranceGate');
  });

  test('§B 격리 — quick_rx_buttons / QuickRxBar 미접촉(별도 prescription_sets 직접 읽기)', () => {
    // 코드 본문 기준(설명 주석 제외): quick_rx 테이블 쿼리·QuickRxBar import/render 없음.
    const code = stripComments(TAG_BAR);
    expect(code).not.toContain("from('quick_rx_buttons')");
    expect(code).not.toContain('import QuickRxBar');
    expect(code).not.toContain('<QuickRxBar');
  });

  test('진료 처방 패널에 BundleRxTagBar 가 동일 dedup 삽입 패턴으로 배선', () => {
    expect(PANEL).toContain("import BundleRxTagBar from './BundleRxTagBar'");
    expect(PANEL).toContain('<BundleRxTagBar');
    // 처방 확정 전에만 노출(빠른처방과 동일 가드)
    expect(PANEL).toMatch(/!confirmed\.doctor_confirm_prescription && \(\s*<BundleRxTagBar/);
  });
});
