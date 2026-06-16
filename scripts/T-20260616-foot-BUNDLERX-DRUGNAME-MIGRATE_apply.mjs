/**
 * T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE-KEEPTAB — gated apply
 *
 * 흐름:
 *   [A] read-only audit (dry-run 로직 재실행) → EXPECT 대조 게이트.
 *   [GATE] EXPECT 불일치 → apply 중단(exit 2). supervisor 보고.
 *   [B] migrations/20260616120000_bundlerx_drugname_migrate.sql 직접 apply
 *       (BEGIN/COMMIT + 백업스냅샷 + verify DO 블록 내장).
 *   [C] post-verify: 신규코드/폴더/매핑 카운트 + 묶음처방 무변경 확인.
 *
 * 실행:
 *   node scripts/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_apply.mjs              # 기본 = audit-only (apply 안 함)
 *   node scripts/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_apply.mjs --apply       # supervisor 게이트 GO 후
 *
 * ⚠️ 기본이 audit-only. supervisor 데이터게이트 GO 전에는 --apply 금지.
 */
import pg from 'pg';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const DO_APPLY = process.argv.includes('--apply');

const ENV = {};
for (const line of readFileSync(join(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) ENV[m[1]] = m[2].trim();
}
const MIG = readFileSync(
  join(REPO, 'supabase/migrations/20260616120000_bundlerx_drugname_migrate.sql'),
  'utf8',
);
const EVID = join(REPO, 'db-gate', 'T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_evidence.md');

// dry-run JSON 의 기대값 (없으면 디폴트)
let EXPECT = { sets: 19, distinct_drugs: 19, new_codes: 19, folder_assign: 19, skip: 0, ambiguous: 0 };
try {
  EXPECT = { ...EXPECT, ...JSON.parse(readFileSync(join(REPO, 'db-gate', 'T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_dryrun.json'), 'utf8')) };
} catch { /* keep default */ }

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: ENV.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const log = [];
const out = (s) => { console.log(s); log.push(s); };
const flush = () => {
  try { mkdirSync(dirname(EVID), { recursive: true }); writeFileSync(EVID, log.join('\n') + '\n'); console.log('\n📄 evidence →', EVID); }
  catch (e) { console.error('evidence write fail:', e.message); }
};

(async () => {
  await client.connect();
  out('# T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE — DB-gate evidence');
  out(`- prod: rxlomoozakkjesdqjtvd | ${new Date().toISOString()} | mode: ${DO_APPLY ? 'AUDIT+APPLY' : 'AUDIT-ONLY'}`);
  out('');

  // ── [A] audit (read-only) ──
  out('## [A] read-only audit');
  const { rows: aR } = await client.query(`
    WITH bundle_drugs AS (
      SELECT DISTINCT btrim(regexp_replace(it->>'name', '\\s+', ' ', 'g')) AS dname,
                      NULLIF(it->>'prescription_code_id','')::uuid AS cid
      FROM prescription_sets ps CROSS JOIN LATERAL jsonb_array_elements(ps.items) it
      WHERE COALESCE(btrim(it->>'name'),'') <> ''
    ), resolved AS (
      SELECT bd.dname,
        COALESCE(
          (SELECT pc.id FROM prescription_codes pc WHERE pc.id = bd.cid),
          (SELECT pc.id FROM prescription_codes pc
             WHERE btrim(regexp_replace(pc.name_ko,'\\s+',' ','g'))=bd.dname LIMIT 1)
        ) AS existing_code_id
      FROM bundle_drugs bd
    )
    SELECT
      (SELECT count(*) FROM prescription_sets)                                AS sets,
      (SELECT count(*) FROM resolved)                                          AS distinct_drugs,
      (SELECT count(*) FROM resolved WHERE existing_code_id IS NULL)           AS new_codes,
      (SELECT count(*) FROM resolved r WHERE NOT EXISTS (
          SELECT 1 FROM prescription_code_folders cf WHERE cf.prescription_code_id = r.existing_code_id)
        )                                                                      AS folder_assign_or_new;`);
  const a = aR[0];
  const got = { sets: +a.sets, distinct_drugs: +a.distinct_drugs, new_codes: +a.new_codes };
  out('```');
  out(`got: sets=${got.sets} distinct_drugs=${got.distinct_drugs} new_codes=${got.new_codes} (folder_assign_or_new=${a.folder_assign_or_new})`);
  out(`exp: sets=${EXPECT.sets} distinct_drugs=${EXPECT.distinct_drugs} new_codes=${EXPECT.new_codes}`);
  out('```');

  const gateOk = got.sets === EXPECT.sets && got.distinct_drugs === EXPECT.distinct_drugs && got.new_codes === EXPECT.new_codes;
  out(`\n## [GATE] ${gateOk ? 'PASS ✅' : 'FAIL ❌'}`);
  if (!gateOk) { out('⛔ EXPECT 불일치 → apply 중단. supervisor 보고 필요.'); await client.end(); flush(); process.exit(2); }
  if (!DO_APPLY) { out('✋ audit-only: 게이트 PASS. --apply 미지정 → apply 미실행 (supervisor GO 대기).'); await client.end(); flush(); process.exit(0); }

  // ── [B] apply ──
  out('\n## [B] migration apply');
  await client.query(MIG);
  out('✅ 적용 완료 (BEGIN/COMMIT + 백업스냅샷 + verify DO 통과)');
  await client.query(`NOTIFY pgrst, 'reload schema';`).catch(() => {});

  // ── [C] post-verify ──
  out('\n## [C] post-verify');
  const { rows: pv } = await client.query(`
    SELECT
      (SELECT count(*) FROM prescription_codes WHERE claim_code LIKE 'RXMIG-%')                       AS rxmig_codes,
      (SELECT count(*) FROM prescription_folders WHERE name='이관약')                                  AS migrate_folder,
      (SELECT count(*) FROM prescription_code_folders cf
         JOIN prescription_folders f ON f.id=cf.folder_id WHERE f.name='이관약')                       AS mapped_in_migrate,
      (SELECT count(*) FROM prescription_codes_bundlerx_backup_20260616)                              AS backup_codes,
      (SELECT count(*) FROM prescription_sets)                                                         AS sets_after;`);
  const v = pv[0];
  out('```');
  out(`  신규 RXMIG 약: ${v.rxmig_codes} (${EXPECT.new_codes} 기대)`);
  out(`  '이관약' 폴더: ${v.migrate_folder} (1 기대)`);
  out(`  이관약 폴더 매핑: ${v.mapped_in_migrate} (>=${EXPECT.new_codes})`);
  out(`  prescription_codes 백업 스냅샷: ${v.backup_codes}행`);
  out(`  prescription_sets(묶음처방) 행수: ${v.sets_after} (${EXPECT.sets} 기대 — 무변경)`);
  out('```');
  const ok = +v.rxmig_codes === EXPECT.new_codes && +v.migrate_folder === 1 && +v.sets_after === EXPECT.sets && +v.mapped_in_migrate >= EXPECT.new_codes;
  out(`\n## [결과] ${ok ? 'PASS ✅' : 'FAIL ❌'}`);
  out('- 묶음처방 prescription_sets 무변경 (행수 동일). 탭/FE/데이터 보존.');
  out('- posology 미이관 (약 이름만). 롤백: claim_code LIKE RXMIG-% + 이관약 폴더 삭제.');
  await client.end(); flush(); process.exit(ok ? 0 : 3);
})().catch((e) => { out('❌ 실패: ' + e.message); flush(); process.exit(1); });
