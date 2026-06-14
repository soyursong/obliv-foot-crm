/**
 * T-20260614-foot-RXSET-BUNDLE-MERGE — DRY-RUN 실행 러너 (READ-ONLY, NO WRITE)
 *
 * supervisor 데이터게이트(MSG-20260614-235533-otel) 요구:
 *   운영 DB에서 supabase/ops/rxset_bundle_dryrun_20260614.sql 의 4개 SELECT 를
 *   실제 실행해 출력 원문 + 실행시각/DB환경을 공유. (will_update=19, already=0, multi=0 확인)
 *
 * 이 러너는 해당 dry-run SQL 의 4개 쿼리를 supabase-js 로 1:1 재현한다.
 *   - supabase 풀러에 DATABASE_URL 미설정 → raw SQL psql 직접 실행 불가.
 *   - service_role 로 read-only SELECT 만 수행. *** 어떤 write 도 하지 않는다. ***
 *   - jsonb_array_length(items)/folder IS DISTINCT FROM '약' 는 JS 로 동일 판정.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const PROJECT_REF = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./) || [])[1] || '?';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const arrLen = (items) => (Array.isArray(items) ? items.length : 0);
// folder IS DISTINCT FROM '약'  (NULL 도 DISTINCT → true)
const distinctFromDrug = (folder) => folder !== '약';

async function main() {
  const { data: sets, error } = await sb
    .from('prescription_sets')
    .select('id, name, items, folder, sort_order')
    .order('sort_order', { nullsFirst: false })
    .order('name');
  if (error) {
    console.error('LOAD ERROR (prescription_sets):', error.message);
    process.exit(1);
  }

  const single = sets.filter((s) => arrLen(s.items) === 1);
  const multi = sets.filter((s) => arrLen(s.items) > 1);
  const willUpdate = single.filter((s) => distinctFromDrug(s.folder));
  const alreadyDrug = single.filter((s) => s.folder === '약');

  console.log('═══════════════════════════════════════════════════════════');
  console.log('T-20260614-foot-RXSET-BUNDLE-MERGE — DRY-RUN (READ-ONLY) 실행 결과');
  console.log('실행시각 :', new Date().toISOString());
  console.log('DB 환경  : foot prod / project_ref=' + PROJECT_REF + ' (' + SUPABASE_URL + ')');
  console.log('실행방식 : supabase-js service_role SELECT (raw SQL psql 미가용 → JS 1:1 재현, write 없음)');
  console.log('대조원천 : supabase/ops/rxset_bundle_dryrun_20260614.sql');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // (1) 영향 범위 집계 — dry-run SQL (1) 과 동일 컬럼
  console.log('-- (1) 영향 범위 집계');
  console.log('  total_sets   =', sets.length);
  console.log('  single_item  =', single.length);
  console.log('  multi_item   =', multi.length, '   (기대 0)');
  console.log('  will_update  =', willUpdate.length, '   (기대 19)');
  console.log('  already_drug =', alreadyDrug.length, '   (기대 0)');
  console.log('');

  // (2) UPDATE 대상 샘플 5건 — dry-run SQL (2)
  console.log('-- (2) UPDATE 대상 샘플 (최대 5건; cur_folder → new_folder=약)');
  willUpdate.slice(0, 5).forEach((s) => {
    console.log(
      `  id=${s.id} name="${s.name}" cur_folder=${
        s.folder == null ? 'NULL' : `"${s.folder}"`
      } new_folder="약" item0_name="${s.items?.[0]?.name ?? ''}" item_count=${arrLen(s.items)}`
    );
  });
  console.log('');

  // (3) 무접촉 대상: 다종 묶음 (items != 1) — dry-run SQL (3)
  console.log('-- (3) 무접촉 대상: 다종/빈 묶음 (items<>1; 0건 기대)');
  const notSingle = sets.filter((s) => arrLen(s.items) !== 1);
  if (notSingle.length === 0) {
    console.log('  (없음)');
  } else {
    notSingle.forEach((s) =>
      console.log(`  id=${s.id} name="${s.name}" item_count=${arrLen(s.items)} folder=${s.folder ?? 'NULL'}`)
    );
  }
  console.log('');

  // (4) quick_rx_buttons FK 영향 — dry-run SQL (4)
  console.log('-- (4) quick_rx_buttons FK 영향 (단독약 세트 참조; 옵션A id불변→보존)');
  const singleIds = new Set(single.map((s) => s.id));
  const { data: qrx, error: qErr } = await sb
    .from('quick_rx_buttons')
    .select('id, name, prescription_set_id')
    .limit(1000);
  if (qErr) {
    console.log('  (조회 실패:', qErr.message, ')');
  } else {
    const refs = qrx.filter((q) => singleIds.has(q.prescription_set_id));
    console.log(`  단독약세트 참조 버튼 = ${refs.length}건`);
    refs.forEach((q) =>
      console.log(`    button_id=${q.id} name="${q.name}" prescription_set_id=${q.prescription_set_id}`)
    );
  }
  console.log('');

  // 게이트 판정
  const pass =
    willUpdate.length === 19 && alreadyDrug.length === 0 && multi.length === 0;
  console.log('═══════════════════════════════════════════════════════════');
  console.log('GATE 판정 :', pass ? 'MATCH ✅ (will_update=19, already=0, multi=0)' : 'MISMATCH ⚠️');
  if (!pass) {
    console.log('  불일치 — apply 보류, 원인분석 필요:');
    console.log(`    will_update=${willUpdate.length}(기대19) already_drug=${alreadyDrug.length}(기대0) multi_item=${multi.length}(기대0)`);
  }
  console.log('═══════════════════════════════════════════════════════════');
  process.exit(pass ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
