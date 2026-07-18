/**
 * T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE — ARCHIVE-FIRST APPLY (파괴적)
 *
 * ⚠ supervisor 최종 DML 게이트 승인 후에만 실행. 기본은 baseline/게이트 리포트만.
 *   실제 파괴(archive→delete)는 환경변수 DAEWOONG_APPLY=1 을 명시해야 실행.
 *
 * FIX-REQUEST 옵션① 반영(2026-07-19): 폴더 참조(prescription_code_folders '처방세트 이관')는
 *   조직용 배지(FK ON DELETE CASCADE)로 임상/청구 무결성과 무관 → abort 제외. 대신 archive-first 1단에서
 *   폴더 멤버십 행도 _backup 에 스냅샷 → DELETE CASCADE + archive = 가역(rollback 이 폴더 멤버십까지 원복).
 *
 * 절차(orphan-SOP §1 순소실0 + backfill §0-1 / WS-C 20260713140000 선례):
 *   (0) baseline 재검증(freeze drift abort): census=1 · 대상 식별 · 임상/청구 abort 4종=0(폴더 계측만)
 *   (1) archive-first (off-git _backup): 대상 prescription_codes 행 + prescription_code_folders 멤버십 행 선적재 (DA §4)
 *   (2) archive 정합 검증(약품 1 · 폴더 = 계측치)
 *   (3) applyMigration(20260718150000) = freeze/4종 재검증 + DELETE(폴더 CASCADE) + 원장 등재
 *   (4) post-verify: 대웅푸루나졸 잔존 0 · 폴더 멤버십 0(CASCADE) · archive 2종 보존 · 원장 등재
 *
 * 사용(게이트 후): SUPABASE_ACCESS_TOKEN=… DAEWOONG_APPLY=1 node scripts/T-20260718-...REMOVE_apply.mjs
 * 리포트만:       SUPABASE_ACCESS_TOKEN=… node scripts/T-20260718-...REMOVE_apply.mjs
 */
import { query, applyMigration } from './lib/foot_migration_ledger.mjs';

const VERSION = '20260718150000';
const FILE = '20260718150000_daewoong_pluranazole_remove.sql';
const ARC_CODES = '_backup.daewoong_pluranazole_20260718_removed';
const ARC_FOLDERS = '_backup.daewoong_pluranazole_folders_20260718_removed';
const APPLY = process.env.DAEWOONG_APPLY === '1';
const num = (rows, k = 'n') => Number(rows?.[0]?.[k] ?? -1);
const abort = (m) => { console.error(`\n🛑 ABORT: ${m}`); process.exit(2); };

// ── (0) baseline 재검증 ──
const census = num(await query(`SELECT count(*)::int AS n FROM public.prescription_codes WHERE name_ko LIKE '대웅푸루나졸%'`));
if (census !== 1) abort(`동명 census ${census} ≠ 1 (freeze drift — 규격 신규유입/재확인 필요)`);

const tgt = await query(`SELECT id, name_ko FROM public.prescription_codes
  WHERE code_source='custom' AND claim_code='LEGACY-12d7730e32e8' AND name_ko LIKE '대웅푸루나졸%'`);
if (!tgt?.[0]?.id) abort('대상 row(custom / LEGACY-12d7730e32e8) 미식별 — freeze 불일치');
const TID = tgt[0].id;

// 임상/청구 abort 4종
const contra = num(await query(`SELECT count(*)::int AS n FROM public.prescription_contraindications WHERE prescription_code_id='${TID}'`));
const reg = async (t) => num(await query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='${t}'`));
const allow = (await reg('prescription_code_allowlist'))
  ? num(await query(`SELECT count(*)::int AS n FROM public.prescription_code_allowlist WHERE prescription_code_id='${TID}'`)) : 0;
const set = (await reg('prescription_sets'))
  ? num(await query(`SELECT count(*)::int AS n FROM public.prescription_sets s WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(s.items,'[]'::jsonb)) e WHERE e->>'prescription_code_id'='${TID}')`)) : 0;
const chart = (await reg('medical_charts'))
  ? num(await query(`SELECT count(*)::int AS n FROM public.medical_charts m WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(m.prescription_items,'[]'::jsonb)) e WHERE e->>'prescription_code_id'='${TID}')`)) : 0;
// 폴더 = 계측만(비-abort)
const folder = (await reg('prescription_code_folders'))
  ? num(await query(`SELECT count(*)::int AS n FROM public.prescription_code_folders WHERE prescription_code_id='${TID}'`)) : 0;

const abortRefTotal = contra + allow + set + chart;
console.log(`── (0) baseline: census=1 · 대상=${TID} (${tgt[0].name_ko})`);
console.log(`   임상/청구 abort 4종: 금기=${contra} 화이트=${allow} 묶음=${set} 처방이력=${chart} → abort 합계=${abortRefTotal}`);
console.log(`   폴더(비-abort·CASCADE): ${folder} → archive-first 스냅샷으로 롤백 원복 가역`);
if (abortRefTotal !== 0) abort(`임상/청구 참조 ${abortRefTotal}건 존재 — hard-DELETE 금지, soft-delete 재설계(planner FOLLOWUP)`);

if (!APPLY) {
  console.log('\n🔒 DAEWOONG_APPLY!=1 → 리포트 모드(파괴 미실행). supervisor DML 게이트 승인 후 DAEWOONG_APPLY=1 로 실행.');
  console.log(`   apply 시: archive(약품 1 + 폴더 ${folder}) → applyMigration(${VERSION}) → post-verify.`);
  process.exit(0);
}

// ═══ 파괴적 실행 (DAEWOONG_APPLY=1) ═══
console.log('\n═══ DAEWOONG_APPLY=1 — ARCHIVE-FIRST 파괴적 실행 ═══');

// ── (1) archive-first (off-git _backup) ── 대상행 + 폴더 멤버십 선적재
await query(`CREATE SCHEMA IF NOT EXISTS _backup`);
await query(`CREATE TABLE IF NOT EXISTS ${ARC_CODES} AS
  SELECT * FROM public.prescription_codes
   WHERE code_source='custom' AND claim_code='LEGACY-12d7730e32e8' AND name_ko LIKE '대웅푸루나졸%'`);
await query(`CREATE TABLE IF NOT EXISTS ${ARC_FOLDERS} AS
  SELECT * FROM public.prescription_code_folders
   WHERE prescription_code_id IN (SELECT id FROM ${ARC_CODES})`);

// ── (2) archive 정합 검증 ──
const arcC = num(await query(`SELECT count(*)::int AS n FROM ${ARC_CODES}`));
const arcF = num(await query(`SELECT count(*)::int AS n FROM ${ARC_FOLDERS}`));
console.log(`── (2) archive: 약품행=${arcC} (기대 1) · 폴더멤버십=${arcF} (기대 ${folder})`);
if (arcC !== 1) abort(`archive 약품행 ${arcC} ≠ 1`);
if (arcF !== folder) abort(`archive 폴더멤버십 ${arcF} ≠ ${folder}`);

// ── (3) applyMigration (freeze/4종 재검증 + DELETE + 폴더 CASCADE + 원장 등재) ──
const res = await applyMigration({
  version: VERSION, file: FILE, dryRun: false,
  createdBy: 'dev-foot:T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE',
});
console.log('── (3) applyMigration:', JSON.stringify(res));

// ── (4) post-verify ──
const left = num(await query(`SELECT count(*)::int AS n FROM public.prescription_codes WHERE name_ko LIKE '대웅푸루나졸%'`));
const folderLeft = num(await query(`SELECT count(*)::int AS n FROM public.prescription_code_folders WHERE prescription_code_id='${TID}'`));
const led = await query(`SELECT version, name, created_by FROM supabase_migrations.schema_migrations WHERE version='${VERSION}'`);
console.log(`\n── (4) post-verify ──`);
console.log(`   대웅푸루나졸 잔존 = ${left} (기대 0)`);
console.log(`   폴더 멤버십 잔존 = ${folderLeft} (기대 0, CASCADE 정리)`);
console.log(`   archive 보존 = 약품 ${arcC} · 폴더 ${arcF} (롤백 원복 원천)`);
console.log(`   원장 등재 = ${JSON.stringify(led)}`);

const ok = left === 0 && folderLeft === 0 && arcC === 1 && arcF === folder && Array.isArray(led) && led.length === 1;
console.log(`\n===== DAEWOONG-REMOVE APPLY 판정: ${ok ? '✅ GO (목록 비표시·폴더 CASCADE 정리·archive 보존·원장 등재)' : '❌ FAIL'} =====`);
process.exit(ok ? 0 : 1);
