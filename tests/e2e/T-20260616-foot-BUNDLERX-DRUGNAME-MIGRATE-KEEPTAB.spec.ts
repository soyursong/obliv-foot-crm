/**
 * E2E spec — T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE-KEEPTAB
 *
 * 현장확정(문지은 대표원장 tiqy 직접정정, #foot thread 1781585999.455529):
 *   묶음처방(prescription_sets) 탭/데이터/FE 전부 **보존**하고, items[]의 "약 이름만"
 *   처방세트 카탈로그(prescription_codes) + 폴더트리(prescription_code_folders)로 이관.
 *   → supersedes T-20260614-foot-RXSET-BUNDLE-MERGE(folder='약' 백필 = 오방향).
 *
 * dry-run(2026-06-16, scripts/…_dryrun.mjs): sets=19, distinct=19, 이름매칭 0 → 신규 19, '이관약' 폴더 신규.
 *
 * 본 spec(정적 단언, 데이터/로그인 비의존 — RXSET spec 컨벤션):
 *   [A] 마이그 불변식 — prescription_sets READ-ONLY(탭/데이터 보존), 약 이름만(posology 미이관),
 *       이관 산출물(prescription_codes/folders/code_folders), 백업·롤백·멱등.
 *   [B] FE 보존 — 묶음처방 탭(value=prescriptions) / DoctorTreatmentPanel 묶음처방 불러오기 /
 *       BundleRxTagBar / QuickRxButtonsTab(prescription_set_id FK) 무삭제.
 *
 * 현장 클릭 시나리오 3종 매핑:
 *   S1 묶음처방 탭 클릭 → 19 세트 보존        ⇒ [B] FE-1(탭 보존) + [A] AC-2(prescription_sets 무변경)
 *   S2 처방세트 폴더트리 → '이관약'에 약 이름  ⇒ [A] AC-3(이관 산출물 + 폴더 배정)
 *   S3 진료패널 묶음처방 불러오기 동작        ⇒ [B] FE-2/3/4(불러오기·태그·빠른처방 보존)
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const MIG = 'supabase/migrations/20260616120000_bundlerx_drugname_migrate.sql';
const ROLLBACK = 'supabase/migrations/20260616120000_bundlerx_drugname_migrate.rollback.sql';
const DRYRUN = 'scripts/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_dryrun.mjs';
const APPLY = 'scripts/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_apply.mjs';
const CLINIC = 'src/pages/ClinicManagement.tsx';
const DRTREAT = 'src/components/doctor/DoctorTreatmentPanel.tsx';
const TAGBAR = 'src/components/doctor/BundleRxTagBar.tsx';
const QRXTAB = 'src/components/admin/QuickRxButtonsTab.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// [A] 마이그레이션 불변식
// ─────────────────────────────────────────────────────────────────────────────
test('A-1: 마이그/롤백/dry-run/apply 4종 패키지 존재', () => {
  expect(existsSync(join(ROOT, MIG))).toBe(true);
  expect(existsSync(join(ROOT, ROLLBACK))).toBe(true);
  expect(existsSync(join(ROOT, DRYRUN))).toBe(true);
  expect(existsSync(join(ROOT, APPLY))).toBe(true);
});

test('A-2: prescription_sets READ-ONLY — 묶음처방 데이터 무변경(write 0)', () => {
  const src = read(MIG);
  // 묶음처방 탭/데이터 보존의 핵심: prescription_sets 를 읽기만 한다.
  expect(src).not.toMatch(/\bUPDATE\s+prescription_sets\b/i);
  expect(src).not.toMatch(/\bINSERT\s+INTO\s+prescription_sets\b/i);
  expect(src).not.toMatch(/\bDELETE\s+FROM\s+prescription_sets\b/i);
  expect(src).not.toMatch(/\bTRUNCATE\s+prescription_sets\b/i);
  expect(src).not.toMatch(/\bDROP\s+TABLE\s+(IF\s+EXISTS\s+)?prescription_sets\b/i);
  // 읽기(jsonb_array_elements(items))는 존재해야 이관이 가능.
  expect(src).toContain('jsonb_array_elements(ps.items)');
});

test('A-3: 이관 산출물 — prescription_codes/folders/code_folders INSERT', () => {
  const src = read(MIG);
  // 신규 약 (이름매칭 0): prescription_codes INSERT (claim_code = RXMIG- 결정적 prefix)
  expect(src).toMatch(/INSERT\s+INTO\s+prescription_codes/i);
  expect(src).toContain("'RXMIG-' || upper(substr(md5(");
  // '이관약' 폴더 보장
  expect(src).toMatch(/INSERT\s+INTO\s+prescription_folders/i);
  expect(src).toContain("'이관약'");
  // 약↔폴더 매핑
  expect(src).toMatch(/INSERT\s+INTO\s+prescription_code_folders/i);
});

test('A-4: "약 이름만" — posology(dosage/route/frequency/days/notes) 이관 안 함', () => {
  const src = read(MIG);
  // 신규 prescription_codes INSERT 컬럼 = claim_code/name_ko/code_type/code_source 만.
  //   classification 등 누락필드는 컬럼 DEFAULT 의존(§1-safe 조건4 값 날조 금지).
  // posology 키를 items 에서 뽑아 어디에도 쓰지 않는다.
  expect(src).not.toMatch(/it->>'dosage'/);
  expect(src).not.toMatch(/it->>'route'/);
  expect(src).not.toMatch(/it->>'frequency'/);
  expect(src).not.toMatch(/it->>'days'/);
  // 이름만 추출
  expect(src).toContain("it->>'name'");
});

test('A-8: §1-safe 매핑 안전조건 4종 (case-fold / 모호 fail-closed / code_source / provenance)', () => {
  const mig = read(MIG);
  const dry = read(DRYRUN);
  const apply = read(APPLY);
  // 조건2 정규화 후 매칭 — 대소문자 통일(lower) 가 마이그/감사 양쪽에 적용
  expect(mig).toMatch(/lower\(btrim\(regexp_replace\(pc\.name_ko/);
  expect(apply).toMatch(/lower\(btrim\(regexp_replace\(pc\.name_ko/);
  // 조건3 모호 silent 금지 — 정확히 1건일 때만 자동해소, 2건+ 는 AMBIGUOUS 분리
  expect(mig).toContain("'AMBIGUOUS'");
  expect(mig).toMatch(/COALESCE\(nm\.n, ?0\) ?= ?1/);
  // 조건3 fail-closed — 모호 1건이라도 있으면 VERIFY RAISE
  expect(mig).toMatch(/v_ambiguous > 0[\s\S]*RAISE EXCEPTION/);
  // apply 게이트도 ambiguous=0 강제
  expect(apply).toMatch(/ambiguous === 0/);
  // 조건3 신규생성은 status='NEW' 에 한정(모호건 신규생성 금지)
  expect(mig).toMatch(/WHERE r\.status = 'NEW'/);
  // 조건4 code_source='custom'(자유텍스트 출신=정직값), code_type='이관약'(provenance 마커)
  expect(mig).toMatch(/'이관약', ?'custom'/);
  // 조건4 provenance 산출물 — 약별 출처(prescription_set_id/item idx) 기록
  expect(dry).toContain('provenance');
  expect(dry).toMatch(/set_id|item_idx/);
});

test('A-5: 백업 스냅샷 3종 + 롤백 식별(RXMIG/이관약) + 검증 DO', () => {
  const mig = read(MIG);
  const rb = read(ROLLBACK);
  expect(mig).toContain('prescription_codes_bundlerx_backup_20260616');
  expect(mig).toContain('prescription_folders_bundlerx_backup_20260616');
  expect(mig).toContain('prescription_code_folders_bundlerx_backup_20260616');
  expect(mig).toContain('RAISE EXCEPTION'); // fail-closed verify
  // 롤백: RXMIG 코드 삭제(CASCADE) + 이관약 폴더 삭제
  expect(rb).toMatch(/DELETE\s+FROM\s+prescription_codes[\s\S]*RXMIG-%/);
  expect(rb).toMatch(/DELETE\s+FROM\s+prescription_folders[\s\S]*'이관약'/);
});

test('A-6: 멱등 — ON CONFLICT DO NOTHING / NOT EXISTS (재실행 no-op)', () => {
  const src = read(MIG);
  expect(src).toContain('ON CONFLICT (claim_code) DO NOTHING');
  expect(src).toContain('ON CONFLICT (prescription_code_id) DO NOTHING');
  expect(src).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM prescription_folders WHERE name = '이관약'\)/);
});

test('A-7: dry-run/apply 안전장치 — dry-run READ-ONLY, apply 기본 audit-only', () => {
  const dry = read(DRYRUN);
  // dry-run 은 prescription_codes/folders 에 write 금지
  expect(dry).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  expect(dry).toContain('READ-ONLY');
  const apply = read(APPLY);
  // apply 는 --apply 플래그 없으면 적용 안 함(supervisor 게이트 GO 대기)
  expect(apply).toContain("includes('--apply')");
  expect(apply).toContain('audit-only');
  expect(apply).toContain('[GATE]');
});

// ─────────────────────────────────────────────────────────────────────────────
// [B] FE 보존 (묶음처방 탭/데이터/FE 전부 유지 — 제외 4종 무삭제)
// ─────────────────────────────────────────────────────────────────────────────
test('FE-1: 묶음처방 탭 보존 — value=prescriptions + data-testid 레거시 앵커', () => {
  const src = read(CLINIC);
  expect(src).toContain('value="prescriptions"');
  expect(src).toContain('data-testid="tab-prescription-sets-legacy"');
  expect(src).toContain('묶음처방');
});

test('FE-2: DoctorTreatmentPanel "묶음처방 불러오기" 섹션 보존', () => {
  const src = read(DRTREAT);
  expect(src).toContain('묶음처방 불러오기');
  expect(src).toContain("from('prescription_sets')");
  // 흡수 surface 의 태그바도 유지
  expect(src).toContain('BundleRxTagBar');
});

test('FE-3: BundleRxTagBar prescription_sets 읽기 보존(태그칩)', () => {
  const src = read(TAGBAR);
  expect(src).toContain("from('prescription_sets')");
});

test('FE-4: QuickRxButtonsTab prescription_set_id FK 보존', () => {
  const src = read(QRXTAB);
  expect(src).toContain('prescription_set_id');
  expect(src).toContain("from('prescription_sets')");
});
