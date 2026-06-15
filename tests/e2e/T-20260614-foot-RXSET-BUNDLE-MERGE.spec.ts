/**
 * E2E spec — T-20260614-foot-RXSET-BUNDLE-MERGE
 *
 * 현장확정(문지은 대표원장, macro-A): 묶음처방(prescription_sets) 탭 유지.
 *   단독약(items 1종) 세트만 처방세트 '약' 폴더로 그룹핑. 다종 묶음세트는 대표원장이 직접 생성.
 *   → 옵션A: prescription_sets.folder='약' UPDATE (행 보존·posology 무손실·set id 불변·가역).
 *
 * AC-1 감사(2026-06-14, scripts/…_ac1_audit.mjs): total=19, single=19, multi=0, folder 전부 NULL.
 *
 * 본 spec 은 (a) 마이그 불변식(옵션A=folder UPDATE only·백업·rollback·posology 무손실·다종 무접촉),
 *   (b) FE 약폴더 그룹핑 표시(기존 folder 그룹핑 인프라가 '약' 폴더로 묶음),
 *   (c) QuickRxBar/처방선택 핵심경로 회귀(set id·items 불변 → join 보존)
 *   를 정본 소스에 정적 단언으로 인코딩한다(데이터/로그인 비의존, RXSET spec 컨벤션).
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const MIG = 'supabase/migrations/20260614120000_rxset_bundle_drugfolder.sql';
const ROLLBACK = 'supabase/migrations/20260614120000_rxset_bundle_drugfolder.rollback.sql';
const DRYRUN = 'supabase/ops/rxset_bundle_dryrun_20260614.sql';
const RXTAB = 'src/components/admin/PrescriptionSetsTab.tsx';
const QUICKBAR = 'src/components/doctor/QuickRxBar.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 옵션A 마이그레이션 불변식 (folder UPDATE only · 가역 · posology 무손실)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2a: 마이그/롤백/dry-run 3종 패키지 존재', () => {
  expect(existsSync(join(ROOT, MIG))).toBe(true);
  expect(existsSync(join(ROOT, ROLLBACK))).toBe(true);
  expect(existsSync(join(ROOT, DRYRUN))).toBe(true);
});

test('AC-2b: 단독약(items=1) & folder≠약 만 folder=약 으로 UPDATE (멱등·다종 무접촉)', () => {
  const src = read(MIG);
  // 대상 한정: 단독약만 + 이미 '약'이면 제외(멱등)
  expect(src).toContain('jsonb_array_length(items) = 1');
  expect(src).toContain("folder IS DISTINCT FROM '약'");
  // folder 백필 UPDATE
  expect(src).toMatch(/UPDATE\s+prescription_sets[\s\S]*SET\s+folder\s*=\s*'약'/);
});

test('AC-2c: posology/items 무손실 — items·dosage·route·frequency 컬럼 미변경(folder/updated_at만)', () => {
  const src = read(MIG);
  // 옵션A는 folder 만 바꾼다 — items 를 SET 하지 않음(posology 무손실의 핵심).
  expect(src).not.toMatch(/SET[\s\S]*\bitems\s*=/);
  // 스키마 변경(ALTER/DROP/신규컬럼) 없음 — folder 컬럼은 기존(20260603040000)에서 추가됨.
  expect(src).not.toMatch(/alter\s+table/i);
  expect(src).not.toMatch(/drop\s+table\s+prescription_sets\b/i);
});

test('AC-2d: 가역성 — 변경 전 folder 백업 + 롤백 복원 + 검증 DO', () => {
  const mig = read(MIG);
  const rb = read(ROLLBACK);
  // 백업: 변경 전 (id, folder) 보존
  expect(mig).toContain('prescription_sets_bundle_folder_backup_20260614');
  expect(mig).toMatch(/INSERT\s+INTO\s+prescription_sets_bundle_folder_backup_20260614/);
  // 롤백: 백업의 folder 로 원복
  expect(rb).toContain('prescription_sets_bundle_folder_backup_20260614');
  expect(rb).toMatch(/SET\s+folder\s*=\s*b\.folder/);
  // 양쪽 검증 DO(건수/불일치) — fail-closed
  expect(mig).toContain('RAISE EXCEPTION');
  expect(rb).toContain('RAISE EXCEPTION');
});

test('AC-2e: dry-run 은 READ-ONLY (will_update 건수 대조용 SELECT, 쓰기 없음)', () => {
  const src = read(DRYRUN);
  expect(src).toContain('will_update');
  expect(src).toMatch(/SELECT/i);
  expect(src).not.toMatch(/\bUPDATE\s+prescription_sets\b/i);
  expect(src).not.toMatch(/\bINSERT\s+INTO\s+prescription_sets\b/i);
  expect(src).not.toMatch(/\bDELETE\s+FROM\s+prescription_sets\b/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1+FE: 약폴더 그룹핑 표시 (기존 folder 그룹핑 인프라가 '약' 폴더로 묶어 렌더)
// ─────────────────────────────────────────────────────────────────────────────
test('FE-1: folder 값으로 폴더 그룹핑 — folder=약 세트가 단일 약 폴더 그룹으로 표시', () => {
  const src = read(RXTAB);
  // folder 기준 그룹핑 로직(미분류는 합성 버킷)
  expect(src).toContain('const grouped');
  expect(src).toContain("s.folder?.trim() ? s.folder.trim() : NO_FOLDER");
  // 폴더 헤더(이름·카운트) 렌더 — '약' 폴더가 헤더로 노출됨
  expect(src).toContain('rx-set-folder-group');
  expect(src).toContain('rx-set-folder-name');
  // 마이그가 채우는 folder 값을 FE 가 select 함(정합) — 부분 match(tag_label/tag_color/icon 등 추가 컬럼 무관, folder 포함만 보장)
  expect(src).toMatch(/\.select\('id, name, items, is_active, sort_order, folder[^']*'\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: QuickRxBar/처방선택 핵심경로 회귀 (set id·items 불변 → join 보존)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4a: quick_rx_buttons → prescription_sets 조인(id·items)이 옵션A 후에도 보존', () => {
  const src = read(QUICKBAR);
  // 빠른처방 바는 set id 로 prescription_sets(id, name, items) 를 조인 → 옵션A는 id·items 불변이라 무회귀.
  expect(src).toContain("prescription_set_id, sort_order, prescription_sets(id, name, items)");
  // 클릭 적용은 조인된 items 를 그대로 사용(folder 무관)
  expect(src).toContain('btn.prescription_sets?.items');
});

test('AC-4b: 처방선택(items) 경로는 folder 비의존 — 적용은 items 배열만 사용', () => {
  const src = read(QUICKBAR);
  // 빈 항목 가드 + onSelectItems/applyMut 모두 items 기준(folder 참조 없음)
  expect(src).toContain('items.length === 0');
  expect(src).toContain('onSelectItems(items)');
  // folder 컬럼을 QuickRxBar 가 참조하지 않음(그룹핑은 관리탭 전용 관심사)
  expect(src).not.toMatch(/\.folder\b/);
});
