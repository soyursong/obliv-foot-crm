/**
 * T-20260803-foot-RXSET-VERIFY-CACHE-AC3 — PROD APPLY (dev-foot, GO MSG-20260803-203220-qgzj)
 * ─────────────────────────────────────────────────────────────────────────────
 * 게이트: supervisor DDL-diff = PASS(GO, ADDITIVE) + DA GO/ADDITIVE 조건부 충족(wk4g) + §3.1 대표게이트 면제.
 * change-class = ADDITIVE : prescription_codes 에 nullable verify_* 6컬럼 ADD COLUMN IF NOT EXISTS.
 *   CHECK 無·FK 無·기존 RLS 상속·default NULL. backfill=N/A(첫 read recompute self-warmup).
 *
 * 정규 러너 규약(JUYEON 선례 계승):
 *   1) PRE 스냅샷 — 원장 미등록 확인 + prescription_codes 객체 baseline(컬럼/인덱스/제약/트리거/정책 카운트).
 *   2) 마이그 body(BEGIN..COMMIT + embedded verify DO-block) 그대로 apply.
 *      DO-block EXCEPTION(cnt<>6 or verified_at≠timestamptz) 시 txn 자동 롤백 → HTTP non-ok → 즉시 통지.
 *   3) 원장 기록(멱등) — supabase_migrations.schema_migrations INSERT ON CONFLICT DO NOTHING (management raw "때우기" 금지).
 *   4) POSTCHECK introspection — verify_* 6컬럼 실재 + verified_at data_type='timestamp with time zone'
 *      + prescription_codes 타 객체 무변경(baseline diff == +6 컬럼, index/constraint/trigger/policy 불변).
 */
import { readFileSync } from 'node:fs';
const REF = 'rxlomoozakkjesdqjtvd';
const VERSION = '20260803210000';
const NAME = 'prescription_codes_verify_cache';
const MIG = '/Users/domas/GitHub/obliv-foot-crm/supabase/migrations/20260803210000_prescription_codes_verify_cache.sql';
const NEW_COLS = ['verify_status','verify_ingredient','verify_matched_code','verified_at','verify_input_hash','verify_model_version'];

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { try { TOKEN = (readFileSync('/Users/domas/GitHub/obliv-foot-crm/.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,''); } catch {} }
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미로드'); process.exit(1); }

async function q(sql){ const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})}); return {ok:r.ok,status:r.status,body:await r.text()}; }
async function qok(sql){ const r=await q(sql); if(!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0,1500)}`); const j=JSON.parse(r.body); return Array.isArray(j)?j:(j.result??[]); }
let pass=true; const chk=(ok,m)=>{console.log(`  ${ok?'✅':'❌'} ${m}`); pass=ok&&pass;};

const OBJ_SNAP = `
  SELECT 'cols' k, count(*)::text v FROM information_schema.columns WHERE table_schema='public' AND table_name='prescription_codes'
  UNION ALL SELECT 'idx', count(*)::text FROM pg_indexes WHERE schemaname='public' AND tablename='prescription_codes'
  UNION ALL SELECT 'con', count(*)::text FROM pg_constraint WHERE conrelid='public.prescription_codes'::regclass
  UNION ALL SELECT 'trg', count(*)::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='prescription_codes' AND NOT t.tgisinternal
  UNION ALL SELECT 'pol', count(*)::text FROM pg_policies WHERE schemaname='public' AND tablename='prescription_codes'`;

// ── PRE ──
console.log('── PRE (baseline 스냅샷) ──');
const pre = await qok(`${OBJ_SNAP}
  UNION ALL SELECT 'ledger_'||'${VERSION}', count(*)::text FROM supabase_migrations.schema_migrations WHERE version='${VERSION}'
  UNION ALL SELECT 'newcols_pre', count(*)::text FROM information_schema.columns WHERE table_schema='public' AND table_name='prescription_codes' AND column_name = ANY(ARRAY['${NEW_COLS.join("','")}']);`);
const P = k => pre.find(x=>x.k===k)?.v;
console.log('  '+JSON.stringify(pre));
const preCols = Number(P('cols'));
const newColsPre = Number(P('newcols_pre'));  // 멱등 재실행 시 이미 존재할 수 있음
chk(P(`ledger_${VERSION}`)==='0','PRE 원장 미등록 (version 20260803210000)');
if(!pass){ console.error('\n❌ PRE 원장 이미 등록됨 — 재실행이면 정상, 확인 요망. abort.'); process.exit(1); }

// ── 1) 마이그 body apply (BEGIN..COMMIT + embedded verify DO-block) ──
console.log(`\n── APPLY ${MIG} ──`);
const r = await q(readFileSync(MIG,'utf8'));
if(!r.ok){
  console.error(`\n❌ APPLY 실패 HTTP ${r.status} — embedded verify DO-block EXCEPTION 시 txn 자동 롤백됨.`);
  console.error(`   body: ${r.body.slice(0,2000)}`);
  console.error('   → supervisor 즉시 통지 필요 (rollback 완전가역, prod 무변경 상태).');
  process.exit(1);
}
console.log('  ✅ 마이그 body 적용 (COMMIT) — embedded DO-block verify PASS (6컬럼 + verified_at=timestamptz)');

// ── 2) 원장 기록 (멱등) ──
await qok(`INSERT INTO supabase_migrations.schema_migrations (version, name, created_by)
  VALUES ('${VERSION}','${NAME}','dev-foot:T-20260803-foot-RXSET-VERIFY-CACHE-AC3')
  ON CONFLICT (version) DO NOTHING;`);
console.log('  ✅ 원장 INSERT (ON CONFLICT DO NOTHING)');

// ── 3) POSTCHECK introspection ──
console.log('\n════ POSTCHECK (introspection) ════');
const post = await qok(OBJ_SNAP + ';');
const Q = k => post.find(x=>x.k===k)?.v;

// (a) verify_* 6컬럼 실재 + verified_at data_type
const colr = await qok(`SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='prescription_codes'
    AND column_name = ANY(ARRAY['${NEW_COLS.join("','")}'])
  ORDER BY column_name;`);
console.log('  verify_* 컬럼 introspection:');
for (const c of colr) console.log(`    · ${c.column_name}  type=${c.data_type}  nullable=${c.is_nullable}  default=${c.column_default??'NULL'}`);
chk(colr.length===6, `(a) verify_* 6컬럼 실재 (found ${colr.length})`);
const vat = colr.find(c=>c.column_name==='verified_at');
chk(!!vat && vat.data_type==='timestamp with time zone', `(a) verified_at data_type='timestamp with time zone' (got ${vat?.data_type})`);
const others = colr.filter(c=>c.column_name!=='verified_at');
chk(others.length===5 && others.every(c=>c.data_type==='text'), `(a) 나머지 5컬럼 = text (${others.map(c=>c.data_type).join(',')})`);
chk(colr.every(c=>c.is_nullable==='YES'), '(a) 6컬럼 전부 nullable');
chk(colr.every(c=>c.column_default===null), '(a) 6컬럼 전부 default NULL (backfill N/A)');

// (b) 타 객체 무변경 — baseline diff
const postCols = Number(Q('cols'));
const colDelta = postCols - preCols;              // 신규 실행이면 +6, 멱등 재실행이면 +0 (이미 존재)
const expectDelta = 6 - newColsPre;               // PRE에 이미 있던 신규컬럼 수 보정
chk(colDelta===expectDelta, `(b) 컬럼 delta = +${colDelta} (기대 +${expectDelta}: 6 신규 − ${newColsPre} 기존)`);
chk(postCols===preCols+colDelta, `(b) 총 컬럼수 ${preCols}→${postCols}`);
chk(Q('idx')===P('idx'), `(b) 인덱스 불변 ${P('idx')}→${Q('idx')}`);
chk(Q('con')===P('con'), `(b) 제약 불변 ${P('con')}→${Q('con')}`);
chk(Q('trg')===P('trg'), `(b) 트리거 불변 ${P('trg')}→${Q('trg')}`);
chk(Q('pol')===P('pol'), `(b) RLS 정책 불변 ${P('pol')}→${Q('pol')} (기존 RLS 상속)`);

// (c) 원장 등재
const lr = await qok(`SELECT version, name, created_by FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`);
chk(lr.length===1 && lr[0].version===VERSION, `(c) 원장 등재 version=${lr[0]?.version} name=${lr[0]?.name}`);

console.log(`\n${pass?'✅ PROD APPLY + POSTCHECK ALL PASS':'❌ POSTCHECK FAIL'}`);
console.log(JSON.stringify({ applied_version: VERSION, ledger: lr[0], verify_cols: colr.map(c=>({[c.column_name]:c.data_type})) }, null, 0));
process.exit(pass?0:1);
