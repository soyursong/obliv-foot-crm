// DRY-RUN (무영속) — T-20260808-foot-VISITTYPE-DEFAULT-SETNEW-REMEDIATE (a)
//   Migration Dry-Run No-Persistence Protocol 준수.
//   foot 는 Management API PAT 보유 → 무영속 검증 = plpgsql DO 블록 안에서 forward(SET DEFAULT) 실행 후
//     RAISE EXCEPTION 으로 전체 롤백(DO 블록 트랜잭션 abort) → 영속 0. in-txn 관측값은 예외 메시지로 회수.
//   INV-1: DO 블록 단일-statement 실행 → forward 파일의 top-level BEGIN;/COMMIT; 미사용 = 조기 COMMIT
//          sentinel-bypass 원천 부재(txn-control strip 등가).
//   INV-3 post-probe: 롤백 후 fresh 쿼리로 prod default 가 여전히 'returning'(비영속) 실측.
//
// usage: (repo root) node db-gate/T-20260808-foot-VISITTYPE-DEFAULT-SETNEW-REMEDIATE_dryrun.mjs
import { readFileSync } from 'node:fs';

const REF = 'rxlomoozakkjesdqjtvd';
const VERSION = '20260809120000';
function pat() {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (m) return m[1].trim().replace(/^"|"$/g, '');
  }
  return readFileSync(process.env.HOME + '/.config/medibuilder-secrets/foot-supabase-pat', 'utf8').trim();
}
const PAT = pat();
async function runq(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { ok: r.ok, status: r.status, json, text };
}

const DEF_SQL = `SELECT pg_get_expr(d.adbin,d.adrelid) AS def
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname='public' AND c.relname='reservations' AND a.attname='visit_type'`;

let fail = 0;
const chk = (cond, label, detail) => { console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`); if (!cond) fail++; };

// PRE
const pre = (await runq(DEF_SQL)).json?.[0]?.def;
console.log('PRE default:', pre);

// 무영속 forward: DO 블록 안 ALTER → in-txn 관측 → RAISE EXCEPTION 자동 롤백 (INV-1/INV-2)
const dryDo = `DO $$
DECLARE v_in text;
BEGIN
  ALTER TABLE public.reservations ALTER COLUMN visit_type SET DEFAULT 'new';
  SELECT pg_get_expr(d.adbin,d.adrelid) INTO v_in
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname='reservations' AND a.attname='visit_type';
  RAISE EXCEPTION 'DRYRUN_NOPERSIST in_txn_default=%', v_in;
END $$;`;
const res = await runq(dryDo);
const errMsg = res.json?.message || res.text || '';
console.log('DO-block response:', errMsg.slice(0, 200));
const inTxnMatch = errMsg.match(/in_txn_default=([^\s"\\]+)/);
const inTxn = inTxnMatch ? inTxnMatch[1] : null;
// 성공조건: 요청이 우리가 심은 sentinel 예외로 실패(=DO 블록 abort=무영속) + in-txn default='new'
chk(/DRYRUN_NOPERSIST/.test(errMsg), 'INV-1/2: DO 블록 RAISE EXCEPTION 자동 롤백(무영속·sentinel abort)', errMsg.slice(0, 120));
chk(inTxn === "'new'::text", "TEST A: in-txn default = 'new'::text", `got=${inTxn}`);

// post-probe (INV-3): 롤백 후 default 여전히 'returning'
const post = (await runq(DEF_SQL)).json?.[0]?.def;
console.log('POST(rollback) default:', post);
chk(post === "'returning'::text", "TEST B: post-probe default = 'returning'::text (비영속 실증)", `got=${post}`);

// TEST C: CHECK 3-type 'new' 포함
const chkDef = (await runq(`SELECT pg_get_constraintdef(oid) def FROM pg_constraint
  WHERE conrelid='public.reservations'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%visit_type%'`)).json?.[0]?.def || '';
chk(/'new'/.test(chkDef), "TEST C(VG2): CHECK 제약에 'new' 포함(SET DEFAULT 'new' 통과 보장)", chkDef);

// TEST D: 원장 미적용 유지
const led = (await runq(`SELECT version FROM supabase_migrations.schema_migrations WHERE version='${VERSION}'`)).json || [];
chk(Array.isArray(led) && led.length === 0, `TEST D: schema_migrations 에 ${VERSION} 부재(미적용 유지)`, `rows=${led.length}`);

console.log(`\n==== DRY-RUN ${fail === 0 ? 'PASS — 무영속(DO 블록 RAISE EXCEPTION 롤백 · post-probe 비영속)' : 'FAIL(' + fail + ')'} ====`);
process.exit(fail === 0 ? 0 : 1);
