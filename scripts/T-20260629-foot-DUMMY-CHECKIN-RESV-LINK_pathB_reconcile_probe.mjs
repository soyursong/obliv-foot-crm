/**
 * T-20260629-foot-DUMMY-CHECKIN-RESV-LINK — Path B 상태 재조정 read-only probe (dev-foot)
 * 사유: BEFORE probe 에서 medical_charts.check_in_id = 실재(true) 확인 → supervisor 실측(ABSENT)과 divergence.
 *       prior apply 가능성 → 파괴적 재실행 전 정직 reconcile (Ledger Reconciliation SOP).
 * write 0.
 */
import { query } from './lib/foot_migration_ledger.mjs';

const rows = async (sql) => { const r = await query(sql); return Array.isArray(r) ? r : []; };
const scalar = async (sql) => { const r = await rows(sql); const o = r[0] || {}; return o[Object.keys(o)[0]]; };

console.log('══ Path B reconcile probe (read-only) ══\n');

// 1) DDL 상태
console.log('[1] DDL 상태');
console.log('  column:', await scalar("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='medical_charts' AND column_name='check_in_id');"));
console.log('  FK    :', await scalar("SELECT EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE table_name='medical_charts' AND constraint_name='medical_charts_check_in_id_fkey' AND constraint_type='FOREIGN KEY');"));
console.log('  index :', await scalar("SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE tablename='medical_charts' AND indexname='idx_mc_check_in_id');"));

// 2) FK delete rule (SET NULL 확인)
const fkRule = await rows("SELECT rc.delete_rule FROM information_schema.referential_constraints rc WHERE rc.constraint_name='medical_charts_check_in_id_fkey';");
console.log('  FK delete_rule:', JSON.stringify(fkRule));

// 3) 원장 기록 여부
console.log('\n[2] 마이그 원장(schema_migrations)');
console.log('  20260629170000 기록:', await scalar("SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260629170000');"));

// 4) 실 링크 상태 — 이미 apply 된 흔적?
console.log('\n[3] medical_charts.check_in_id 실 링크 상태');
console.log('  전체 medical_charts:', await scalar('SELECT count(*)::int FROM public.medical_charts;'));
console.log('  check_in_id NOT NULL(링크됨):', await scalar('SELECT count(*)::int FROM public.medical_charts WHERE check_in_id IS NOT NULL;'));
console.log('  sim medical_charts 총:', await scalar('SELECT count(*)::int FROM public.medical_charts m JOIN public.customers c ON c.id=m.customer_id WHERE c.is_simulation=true;'));
console.log('  sim medical_charts 링크됨:', await scalar('SELECT count(*)::int FROM public.medical_charts m JOIN public.customers c ON c.id=m.customer_id WHERE c.is_simulation=true AND m.check_in_id IS NOT NULL;'));
console.log('  sim medical_charts orphan(NULL):', await scalar('SELECT count(*)::int FROM public.medical_charts m JOIN public.customers c ON c.id=m.customer_id WHERE c.is_simulation=true AND m.check_in_id IS NULL;'));

// 5) 이미 링크된 sim MC 상세 (있다면 = prior apply 증거)
const linked = await rows("SELECT m.id, m.customer_id, m.visit_date, m.check_in_id, c.name FROM public.medical_charts m JOIN public.customers c ON c.id=m.customer_id WHERE c.is_simulation=true AND m.check_in_id IS NOT NULL ORDER BY m.visit_date;");
console.log('\n[4] 이미 링크된 sim MC 상세 (prior apply 흔적):');
linked.forEach(r => console.log(`  MC ${String(r.id).slice(0,8)} cust=${r.name} date=${r.visit_date} -> ci ${String(r.check_in_id).slice(0,8)}`));
if (!linked.length) console.log('  (없음 = orphan 전량, apply 미실행)');

// 6) 실고객 중 check_in_id NOT NULL 인 것 있나? (오염 확인)
console.log('\n[5] 실고객(non-sim) medical_charts 중 check_in_id NOT NULL:');
const realLinked = await scalar('SELECT count(*)::int FROM public.medical_charts m JOIN public.customers c ON c.id=m.customer_id WHERE (c.is_simulation=false OR c.is_simulation IS NULL) AND m.check_in_id IS NOT NULL;');
console.log('  count:', realLinked, realLinked > 0 ? '⚠ 실고객 링크 존재 — 조사 필요' : '(0 = 실고객 무접촉)');
