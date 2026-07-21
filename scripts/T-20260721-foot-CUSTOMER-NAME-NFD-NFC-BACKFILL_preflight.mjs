/**
 * T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL — DA GO 후 PREFLIGHT (READ-ONLY)
 *
 * DA CONSULT-REPLY(MSG-20260721-234423-xfat) 게이트 실행:
 *   §2-S 파생 동기필드 기계 완전열거 (손 열거 금지) — 3 customer_id 에 대해
 *          name 사본을 보유한 모든 text/varchar 컬럼 전수 NFD 지문 스캔 (단일 UNION 쿼리).
 *   §3-5 제약-도메인 프리플라이트 — touched 컬럼 CHECK/UNIQUE/NOT NULL verbatim + UNIQUE collision.
 *
 * ⛔ READ-ONLY. write/DDL 절대 금지. 429 백오프 재시도로 rate-limit 흡수.
 */
import fs from 'fs';
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }
const FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|grant|revoke)\b/i; // create 는 CREATE 없음(순수 SELECT)
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function q(sql, tries = 6) {
  if (FORBIDDEN.test(sql)) throw new Error(`REFUSE write/DDL: ${sql.slice(0, 80)}`);
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: true }),
    });
    const text = await r.text();
    if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
    return JSON.parse(text);
  }
  throw new Error('429 재시도 소진');
}
const IDS = ['b734f069-5a06-414b-9ad6-f32ee3b3bf2c','f137fe98-30b2-4a66-bcc0-73bc68277b58','0fc0752c-7ccd-4a71-85ec-b7e4e5f20527'];
const IDLIST = IDS.map(i => `'${i}'`).join(',');
const log = (...a) => console.log(...a);
const isNFD = "char_length(%C) <> char_length(normalize(%C,NFC))";

try {
  log('═══════════════════════════════════════════════════════════');
  log('PREFLIGHT — §2-S 완전열거 + §3-5 제약 (READ-ONLY, foot prod)');
  log('═══════════════════════════════════════════════════════════\n');

  // ── §2-S-A: customer_id 보유 테이블의 text/char 컬럼 기계열거 (1 call)
  const cols = await q(`
    SELECT c.table_name AS t, c.column_name AS c
    FROM information_schema.columns c
    WHERE c.table_schema='public'
      AND c.data_type IN ('text','character varying','character')
      AND c.table_name IN (
        SELECT table_name FROM information_schema.columns
        WHERE table_schema='public' AND column_name='customer_id')
    ORDER BY 1,2;`);
  log(`━━ §2-S-A. customer_id 보유 테이블 text/char 컬럼: ${cols.length}개 (기계열거) ━━`);

  // ── §2-S-B: 단일 UNION ALL 로 3 customer_id 행의 NFD 지문 count 를 한 번에 (1 call)
  const branches = cols.map(({ t, c }) =>
    `SELECT '${t}' t, '${c}' c, count(*)::int n FROM public."${t}" ` +
    `WHERE customer_id IN (${IDLIST}) AND "${c}" IS NOT NULL AND ` +
    isNFD.replace(/%C/g, `"${c}"`));
  const counts = await q(branches.join('\nUNION ALL\n') + '\nORDER BY n DESC;');
  const hits = counts.filter(r => Number(r.n) > 0);
  log(`\n━━ §2-S-B. 3 customer_id 대상 NFD 지문 hit 컬럼: ${hits.length}개 ━━`);
  hits.forEach(h => log(`   🔴 ${h.t}.${h.c}: ${h.n}건`));

  // ── §2-S-C: name/customer 계열 전 테이블 전역 NFD census (aggregate, 1 call)
  const nameCols = await q(`
    SELECT table_name AS t, column_name AS c FROM information_schema.columns
    WHERE table_schema='public' AND data_type IN ('text','character varying','character')
      AND (column_name ILIKE '%name%' OR column_name ILIKE '%customer%')
    ORDER BY 1,2;`);
  const gbranches = nameCols.map(({ t, c }) =>
    `SELECT '${t}' t, '${c}' c, count(*)::int n FROM public."${t}" ` +
    `WHERE "${c}" IS NOT NULL AND ` + isNFD.replace(/%C/g, `"${c}"`));
  const gcounts = (await q(gbranches.join('\nUNION ALL\n') + '\nORDER BY n DESC;')).filter(r => Number(r.n) > 0);
  log(`\n━━ §2-S-C. name/customer 계열 전 테이블 전역 NFD census: ${gcounts.length}개 컬럼 hit ━━`);
  gcounts.forEach(h => log(`   🔴 ${h.t}.${h.c}: ${h.n}건 (전역)`));

  // ── §2-S-D: reservations/check_ins/aicc 사본 PK+hex 확정 (freeze-set 확장, 1 call each)
  log('\n━━ §2-S-D. 사본 freeze PK + rollback hex 확정 ━━');
  // PHI 위생: hex(=name bytes)·실명 미출력. pk/cid8/len 만. hex 원값은 off-git freeze.json.
  const dump = async (label, sql) => { const r = await q(sql); log(`  ${label}: ${r.length}건`); r.forEach(x => log(`   pk=${x.pk} cid=${(x.cid||'').slice(0,8)} raw=${x.raw_len} nfc=${x.nfc_len}`)); return r; };
  const resv = await dump('reservations.customer_name', `
    SELECT id::text pk, customer_id::text cid, char_length(customer_name) raw_len,
           char_length(normalize(customer_name,NFC)) nfc_len, encode(convert_to(customer_name,'UTF8'),'hex') hex_raw
    FROM public.reservations WHERE customer_name IS NOT NULL AND ${isNFD.replace(/%C/g,'customer_name')} ORDER BY id;`);
  const chk = await dump('check_ins.customer_name', `
    SELECT id::text pk, customer_id::text cid, char_length(customer_name) raw_len,
           char_length(normalize(customer_name,NFC)) nfc_len, encode(convert_to(customer_name,'UTF8'),'hex') hex_raw
    FROM public.check_ins WHERE customer_name IS NOT NULL AND ${isNFD.replace(/%C/g,'customer_name')} ORDER BY id;`);

  // ── §3-5: 제약 프리플라이트 (1 call)
  log('\n━━ §3-5. 제약 프리플라이트 (name/customer_name 관련 CHECK/UNIQUE) ━━');
  const cons = await q(`
    SELECT conrelid::regclass::text tbl, conname, contype, pg_get_constraintdef(oid) def
    FROM pg_constraint
    WHERE conrelid::regclass::text = ANY(ARRAY['customers','reservations','check_ins','aicc_crm_phone_match'])
      AND pg_get_constraintdef(oid) ILIKE '%name%' ORDER BY 1,3;`);
  if (!cons.length) log('   name 관련 CHECK/UNIQUE 제약: 0건 (collision 위험 없음)');
  cons.forEach(c => log(`   [${c.contype}] ${c.tbl}.${c.conname}: ${c.def}`));

  const nn = await q(`
    SELECT table_name t, column_name c, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND (
      (table_name='customers' AND column_name='name') OR
      (table_name='reservations' AND column_name='customer_name') OR
      (table_name='check_ins' AND column_name='customer_name') OR
      (table_name='aicc_crm_phone_match' AND column_name='name')) ORDER BY 1;`);
  log('  NOT NULL 여부(touched 컬럼):');
  nn.forEach(r => log(`   ${r.t}.${r.c}: nullable=${r.is_nullable}`));

  // ── §3-5-④: NFC collision 시뮬레이션 (1 call) — PHI 위생: 실명 리터럴 미사용, id 기준 self-join.
  log('\n━━ §3-5-④. NFC 정규화 후 동명 collision 시뮬레이션 (clinic jongno, id 기준) ━━');
  const coll = await q(`
    WITH tgt AS (SELECT id, normalize(name,NFC) nfc FROM public.customers WHERE id IN (${IDLIST}))
    SELECT t.id::text pk, count(c.*)::int n_nfc_equal
    FROM tgt t
    JOIN public.customers c ON c.clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
      AND normalize(c.name,NFC)=t.nfc
    GROUP BY t.id ORDER BY t.id;`);
  coll.forEach(r => log(`   pk=${r.pk.slice(0,8)}: NFC-equal 총 ${r.n_nfc_equal}건 ${r.n_nfc_equal>1?'⚠ 기존 NFC 동명행 존재(정정 후 논리적 중복 주의)':'(NFD 1건뿐, collision 없음)'}`));

  log('\n═══════════════════════════════════════════════════════════');
  log('✅ PREFLIGHT 완료 — write·DDL 0.');
  const idHits = hits.map(h => `${h.t}.${h.c}(${h.n})`).join(', ');
  log(`   §2-S 3-id NFD hit: ${idHits}`);
  log(`   최종 freeze-set: customers ${IDS.length} + reservations ${resv.length} + check_ins ${chk.length} = ${IDS.length+resv.length+chk.length}`);
  const AICC = hits.find(h => h.t === 'aicc_crm_phone_match');
  const NLOG = hits.find(h => h.t === 'notification_logs');
  log(`   ⚠ 판정필요: aicc_crm_phone_match.name=${AICC?AICC.n:0} (identity 사본→FOLD 검토) / notification_logs.body_rendered=${NLOG?NLOG.n:0} (전송로그 embed→감사기록 불변, 정정제외 검토)`);
} catch (e) {
  console.error('❌ PREFLIGHT 실패:', e.message);
  process.exit(1);
}
