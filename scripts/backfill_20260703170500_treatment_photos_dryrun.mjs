/**
 * T-20260703-foot-STAFFPHOTO-CHART-LINK — 레거시 backfill DRY-RUN + 행수 대조.
 * (supervisor DDL-diff PHI DB-GATE 검수 근거 — DA RECON 결정① "dry-run + 행수 대조 필수")
 *
 * 실행:  node scripts/backfill_20260703170500_treatment_photos_dryrun.mjs
 *   READ-ONLY. INSERT 하지 않음. 소스 항목수 vs 예상 삽입수 vs 이미삽입수 vs 고아수 대조표만 출력.
 * APPLY:  node scripts/backfill_20260703170500_treatment_photos_dryrun.mjs --apply
 *   → 20260703170500_..._legacy_copy.sql 실행. (테이블/버킷 마이그 20260703170000 선적용 전제)
 * ROLLBACK: --rollback
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: sql }),
  });
  const body = await r.json();
  if (!r.ok) { console.error('❌', JSON.stringify(body)); process.exit(1); }
  return body;
}

const apply = process.argv.includes('--apply');
const rollback = process.argv.includes('--rollback');

if (rollback) {
  const sql = readFileSync(join(__dir, '../supabase/migrations/20260703170500_foot_treatment_photos_legacy_copy.rollback.sql'), 'utf8');
  console.log('🔙 backfill ROLLBACK');
  console.log(JSON.stringify(await q(sql)));
  process.exit(0);
}

// ── 대조표 (READ-ONLY) ─────────────────────────────────────────────
const src = await q(`
  SELECT
    coalesce(sum(cardinality(treatment_photos)) FILTER (WHERE customer_id IS NOT NULL),0) AS source_items_matchable,
    coalesce(sum(cardinality(treatment_photos)) FILTER (WHERE customer_id IS NULL),0)     AS orphan_items_customer_null,
    count(*) FILTER (WHERE cardinality(treatment_photos) > 0)                             AS source_checkins
  FROM public.check_ins
  WHERE treatment_photos IS NOT NULL AND cardinality(treatment_photos) > 0
`);
const tableExists = (await q(`SELECT to_regclass('public.treatment_photos') AS t`));
const hasTable = (tableExists.result?.[0]?.t ?? tableExists[0]?.t) != null;
const already = hasTable
  ? await q(`SELECT count(*) AS n FROM public.treatment_photos WHERE source='legacy_string_array'`)
  : { result: [{ n: '(table not applied yet)' }] };

console.log('════ backfill DRY-RUN 대조표 ════');
console.log(JSON.stringify(src.result?.[0] ?? src[0] ?? src, null, 2));
console.log('이미 backfill 된 행(source=legacy_string_array):', JSON.stringify(already.result?.[0] ?? already[0] ?? already));
console.log('⇒ 예상 신규 삽입 = source_items_matchable − 이미삽입(중복 NOT EXISTS 가드). orphan 은 대상 제외.');

if (apply) {
  if (!hasTable) { console.error('❌ treatment_photos 테이블 미적용 — 20260703170000 마이그 선적용 필요.'); process.exit(1); }
  const sql = readFileSync(join(__dir, '../supabase/migrations/20260703170500_foot_treatment_photos_legacy_copy.sql'), 'utf8');
  console.log('\n🚀 backfill APPLY 실행…');
  console.log(JSON.stringify(await q(sql)));
  const post = await q(`SELECT count(*) AS n FROM public.treatment_photos WHERE source='legacy_string_array'`);
  console.log('APPLY 후 backfill 행수:', JSON.stringify(post.result?.[0] ?? post[0] ?? post));
  console.log('✅ 완료 — supervisor: source_items_matchable == APPLY후 행수 인지 대조.');
} else {
  console.log('\n(READ-ONLY. 실제 삽입하려면 --apply)');
}
