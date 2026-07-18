/**
 * P-B neg-window forensic (SOP §0-2 source-closure) — READ-only, tz-aware.
 * Confirms 0 new non-E.164 suspect rows landed AFTER enforcement went live (P-A ALL PASS).
 * author: dev-foot / 2026-07-18
 */
import { query } from './lib/foot_migration_ledger.mjs';
const one = (r) => (Array.isArray(r) ? r : r.result ?? []);
const EFFICACY = '2026-07-18T10:39:00Z'; // P-A 3항 ALL PASS = enforcement live (ticket L145)
console.log('══ P-B neg-window forensic (tz-aware, READ-only) ══');
console.log('enforcement-live 시각(UTC):', EFFICACY, '\n');
const susPred = (col) => `${col} IS NOT NULL AND ${col} NOT LIKE 'DUMMY-%' AND ${col} <> '+821000000000'
   AND ${col} !~ '^\\+82(1[016789]\\d{7,8})$' AND ${col} !~ '^\\+(?!82)[1-9]\\d{6,14}$'`;
let pass = true;
for (const [t,c] of [['customers','phone'],['reservations','customer_phone']]) {
  const newBad = one(await query(`SELECT count(*)::int AS n, max(created_at) AS mx FROM public.${t}
    WHERE (${susPred(c)}) AND created_at > timestamptz '${EFFICACY}';`))[0];
  const total = one(await query(`SELECT count(*)::int AS n FROM public.${t} WHERE ${susPred(c)};`))[0].n;
  const ok = newBad.n === 0;
  pass &&= ok;
  console.log(`${t}.${c}: suspect total=${total} | NEW after enforcement=${newBad.n} (max created_at=${newBad.mx||'none'}) → ${ok?'✅ PASS':'❌ FAIL'}`);
}
console.log(`\nP-B 종합: ${pass?'✅ 소스닫힘 확증 (0 신규, SOP §0-2 닫힘)':'❌ FAIL'}`);
process.exit(pass?0:1);
