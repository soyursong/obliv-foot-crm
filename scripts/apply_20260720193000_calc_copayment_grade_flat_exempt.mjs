/**
 * T-20260720-foot-COPAY-GRADE-BRANCH-MISSING — calc_copayment v1.5 → v1.6 (의원급 외래 등급요율 교정)
 *   차상위·의료급여 의원급(1차) 외래 본인부담을 정률(14%/15%)에서 정액/면제로 교정:
 *     · low_income_1  : 14% → 0원 면제 (copay=0 전용분기)         [시행령 별표2 3호 라목]
 *     · low_income_2  : 14% → 정액 LEAST(1,000, base)             [시행령 별표2 3호 라목]
 *     · medical_aid_2 : 15% → 정액 LEAST(1,000, base)             [의료급여법 시행령 별표1]
 *     · medical_aid_1 : LEAST(1,000, base) 유지 · general/infant/elderly/foreigner 유지 (회귀0)
 *   DA 재확정 GO (da_ratify_copayment_grade_rates_20260720). ADDITIVE(CREATE OR REPLACE 동일 signature).
 *
 * 흐름 (Migration Dry-Run No-Persistence Protocol / dryrun_lib.mjs 3요소):
 *   [BEFORE] prod calc_copayment 상태 캡처(COMMENT · 함수정의 요율마커)
 *   [DRY]    dryrun_lib.runDryrun — txn-control strip → plpgsql exception-handler EXECUTE → sentinel rollback
 *            → post-probe: v1.6 canon marker(COMMENT 'v1.6', low_income_2 IN-정액 분기) 무영속(BEFORE 유지) 실증
 *   [GATE]   dry-run FAIL 시 실적용 중단(exit 2)
 *   [APPLY]  foot_migration_ledger.applyMigration — DDL 적용 + schema_migrations 원장 기록(단일경로)
 *   [POST]   prod 실측 재확인(v1.6 COMMENT · low_income_1 면제분기 · 정액 IN 확장 · GRANT) + 원장 3자 대조
 *
 * 실행: node scripts/apply_20260720193000_calc_copayment_grade_flat_exempt.mjs           (BEFORE + DRY-only)
 *       node scripts/apply_20260720193000_calc_copayment_grade_flat_exempt.mjs --apply    (실적용)
 * author: dev-foot / 2026-07-21
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { q, runDryrun } from './dryrun_lib.mjs';
import { applyMigration, ledgerVersions, MIG_DIR } from './lib/foot_migration_ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const VERSION = '20260720193000';
const FILE = `${VERSION}_calc_copayment_grade_flat_exempt.sql`;
const UP_PATH = join(MIG_DIR, FILE);
const EVID_DIR = join(REPO, 'db-gate');
const EVID_FILE = join(EVID_DIR, 'T-20260720-foot-COPAY-GRADE-BRANCH-MISSING_apply_evidence.md');
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

const log = [];
const out = (s) => { console.log(s); log.push(s); };
const flush = () => { mkdirSync(EVID_DIR, { recursive: true }); writeFileSync(EVID_FILE, log.join('\n') + '\n'); };

// prod calc_copayment 상태: COMMENT + 함수정의 내 v1.6 마커(면제분기·정액 IN 확장) 존재여부
async function state() {
  const rows = await q(`
    SELECT COALESCE(obj_description(p.oid,'pg_proc'),'') AS comment,
           pg_get_functiondef(p.oid) AS def,
           has_function_privilege('authenticated','public.calc_copayment(uuid,uuid,uuid,date)','EXECUTE') AS auth_exec,
           has_function_privilege('anon','public.calc_copayment(uuid,uuid,uuid,date)','EXECUTE') AS anon_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='calc_copayment';`);
  const r0 = (Array.isArray(rows) && rows[0]) || {};
  const def = r0.def ?? '';
  return {
    fn_exists: !!(Array.isArray(rows) && rows.length),
    comment: r0.comment ?? '',
    auth_exec: r0.auth_exec ?? null,
    anon_exec: r0.anon_exec ?? null,
    // v1.6 마커: 정액 IN 확장(low_income_2/medical_aid_2 정액) + low_income_1 면제 rate 0.00
    has_flat_in_expand: /IN\s*\(\s*'medical_aid_1'\s*,\s*'low_income_2'\s*,\s*'medical_aid_2'\s*\)/.test(def),
    has_lowinc1_exempt: /WHEN\s*'low_income_1'\s*THEN\s*0\.00/.test(def),
    has_medaid2_flat: /WHEN\s*'medical_aid_2'\s*THEN\s*0\.00/.test(def),
    comment_v16: (r0.comment ?? '').includes('v1.6'),
  };
}

function report(label, s) {
  out(`\n### ${label}`);
  out(`  · 함수 존재            : ${s.fn_exists}`);
  out(`  · COMMENT             : ${s.comment ? s.comment.slice(0, 70) + '…' : '(none)'}`);
  out(`  · COMMENT 'v1.6'      : ${s.comment_v16}`);
  out(`  · 정액 IN 확장(v1.6)  : ${s.has_flat_in_expand}  (medical_aid_1,low_income_2,medical_aid_2 LEAST)`);
  out(`  · low_income_1 면제    : ${s.has_lowinc1_exempt} (rate 0.00)`);
  out(`  · medical_aid_2 정액   : ${s.has_medaid2_flat}   (rate 0.00, 종전 0.15)`);
  out(`  · authenticated EXEC  : ${s.auth_exec}  (true 기대)`);
  out(`  · anon EXEC           : ${s.anon_exec}  (false 기대 — surface 증가 0)`);
}

// v1.6 적용 후 PASS 판정
function v16Ok(s) {
  return s.fn_exists && s.comment_v16 && s.has_flat_in_expand
    && s.has_lowinc1_exempt && s.has_medaid2_flat
    && s.auth_exec === true && s.anon_exec === false;
}

(async () => {
  out(`═══ T-20260720-foot-COPAY-GRADE-BRANCH-MISSING  MIG ${VERSION} (ref=rxlomoozakkjesdqjtvd) ═══`);
  out(`시각: ${nowKst()} · mode=${APPLY ? 'APPLY(실적용)' : 'DRY-only'}`);
  out(`calc_copayment v1.5→v1.6 · ADDITIVE(CREATE OR REPLACE 동일 signature·7컬럼) · DA GO · forward-only(소급0).`);

  // ── BEFORE ──
  const before = await state();
  out(`\n## [BEFORE] prod calc_copayment 상태 (v1.5 기대)`);
  report('[BEFORE]', before);

  // ── DRY-RUN (무영속, v1.6 canon-marker absence probe) ──
  out(`\n## [DRY-RUN] dryrun_lib 무영속 harness (txn-strip → exception-handler → sentinel rollback)`);
  out(`  post-probe(함수 pre-exist → procAbsent 부적): v1.6 마커가 rollback 후 미영속(BEFORE=v1.5 유지)임을 실증.`);
  const absentProbes = [
    { label: "v1.6 COMMENT 무영속(rollback 후 미존재)",
      sql: `SELECT NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='calc_copayment'
                AND COALESCE(obj_description(p.oid,'pg_proc'),'') LIKE '%v1.6%') AS absent;` },
    { label: "정액 IN 확장(low_income_2,medical_aid_2) 무영속",
      sql: `SELECT NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='calc_copayment'
                AND pg_get_functiondef(p.oid) ~ 'IN\\s*\\(\\s*''medical_aid_1''\\s*,\\s*''low_income_2''') AS absent;` },
  ];
  const dry = await runDryrun({ upPath: UP_PATH, assertAbsent: absentProbes, exitProcess: false,
    passNote: '(v1.6 요율교정 무영속 — BEFORE v1.5 정의 유지)' });
  out(`  · dry-run 결과 = ${dry.pass ? '✅ PASS' : '❌ FAIL(code=' + dry.code + ')'}`);
  if (!dry.pass) {
    out(`\n❌ DRY-RUN GATE 실패 — 실적용 중단.`);
    flush();
    process.exit(2);
  }
  // 무영속 이중확인: dry-run 후 prod 는 여전히 BEFORE(v1.5) 상태여야 함.
  const afterDry = await state();
  const stillBefore = !afterDry.comment_v16 && !afterDry.has_flat_in_expand;
  out(`  · [POST-DRY 무영속 실측] v1.6 COMMENT 미존재=${!afterDry.comment_v16} · 정액IN확장 미존재=${!afterDry.has_flat_in_expand} ⇒ 무영속=${stillBefore ? '✅' : '❌'}`);
  if (!stillBefore) { out('\n❌ 무영속 실측 실패(dry-run 이 prod 를 변경).'); flush(); process.exit(2); }
  out(`\n✅ DRY-RUN GATE 통과 (무영속 확인).`);

  if (!APPLY) {
    flush();
    out(`\n(dry-only: 실적용 생략 — --apply 로 실행)  evidence → ${EVID_FILE}`);
    return;
  }

  // ── APPLY (foot_migration_ledger: 적용=원장 기록 단일경로) ──
  out(`\n## [APPLY] 실적용 (applyMigration → DDL + schema_migrations 원장 기록)`);
  const ledgerBefore = await ledgerVersions();
  out(`  · 원장 pre: ${VERSION} 등재=${ledgerBefore.has(VERSION)}`);
  const res = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'dev-foot/COPAY-GRADE-BRANCH-MISSING' });
  out(`  · applyMigration 결과: ${JSON.stringify(res)}`);

  // ── POSTCHECK ──
  const after = await state();
  out(`\n## [POSTCHECK] prod 실측 (v1.6 기대)`);
  report('[POSTCHECK]', after);
  const ledgerAfter = await ledgerVersions();
  out(`\n  · 원장 post: ${VERSION} 등재=${ledgerAfter.has(VERSION)} (3자 대조: 파일 존재 ✅ / 원장 ${ledgerAfter.has(VERSION) ? '✅' : '❌'} / prod-def v1.6 ${after.comment_v16 ? '✅' : '❌'})`);
  const ok = v16Ok(after) && ledgerAfter.has(VERSION);
  out(`\n${ok ? '✅ POSTCHECK ALL-GREEN — calc_copayment v1.6 실적용 확인.' : '❌ POSTCHECK 실패 — 즉시 확인 필요.'}`);
  flush();
  out(`\nevidence → ${EVID_FILE}`);
  if (!ok) process.exit(3);
})().catch((e) => { out(`\n💥 ERROR: ${e.message}`); flush(); process.exit(1); });
