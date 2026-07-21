/**
 * T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL — DIAGNOSE-FIRST census (READ-ONLY)
 *
 * gate_hold: APPLY(customers.name UPDATE)는 DA CONSULT-REPLY(GO) 수신 전 절대 금지.
 *   본 스크립트는 approved 상태 (a)DIAGNOSE-FIRST 전수 census 전용 — READ-ONLY.
 *   ⛔ customers.name UPDATE/INSERT/DELETE 절대 금지. 순수 SELECT 만.
 *
 * 산출 (DA CONSULT 근거):
 *   1) NFD 지문 전수 census: char_length(name) <> char_length(normalize(name,NFC)) 교집합
 *   2) freeze-set PK + before(raw NFD)/after(NFC) + rollback 원값 스냅샷
 *   3) is_simulation / clinic / visit_route 분포
 *   4) seed 3건(백민석/강승은/천승환) 확증
 *   5) 이름검색 실패 재현 (LIKE '%강승은%' pre-backfill count)
 *   6) FK/파생 영향: reservations.customer_name denormalize 사본 NFD 여부
 *
 * 실행: SUPABASE_ACCESS_TOKEN=… node scripts/T-...BACKFILL_census.mjs
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd'; // foot prod

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }

// READ-ONLY 가드: write/DDL 키워드 감지 시 REFUSE.
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i;
async function q(sql) {
  if (FORBIDDEN.test(sql)) throw new Error(`REFUSE write/DDL: ${sql.slice(0, 80)}`);
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}

const out = [];
const log = (s = '') => { console.log(s); out.push(s); };

try {
  log('═══════════════════════════════════════════════════════════');
  log('T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL — DIAGNOSE-FIRST census');
  log('DB: foot prod / ref=' + REF + ' / read_only:true / write·DDL 0');
  log('═══════════════════════════════════════════════════════════\n');

  // ── STEP 1. NFD 지문 전수 census (freeze-set 후보) ──────────────
  log('━━ STEP 1. NFD 지문 전수 census: char_length(name) <> char_length(normalize(name,NFC)) ━━');
  const nfd = await q(`
    SELECT id, chart_number, clinic_id, is_simulation, visit_route,
           name AS name_raw, lead_source, inflow_source,
           normalize(name, NFC) AS name_nfc,
           char_length(name) AS raw_len,
           char_length(normalize(name, NFC)) AS nfc_len,
           encode(convert_to(name, 'UTF8'), 'hex') AS name_hex_raw
    FROM customers
    WHERE name IS NOT NULL
      AND char_length(name) <> char_length(normalize(name, NFC))
    ORDER BY is_simulation, clinic_id, chart_number`);
  log(`전수 NFD 대상: ${nfd.length}건\n`);
  log('id(8)    | chart    | sim   | visit_route | raw_len | nfc_len | name_raw -> name_nfc');
  log('---------|----------|-------|-------------|---------|---------|---------------------');
  for (const r of nfd) {
    log(`${String(r.id).slice(0,8)} | ${String(r.chart_number ?? '-').padEnd(8)} | ${String(r.is_simulation).padEnd(5)} | ${String(r.visit_route ?? '-').padEnd(11)} | ${String(r.raw_len).padEnd(7)} | ${String(r.nfc_len).padEnd(7)} | ${r.name_raw} -> ${r.name_nfc}`);
  }
  log('');

  // ── STEP 2. is_simulation / clinic / visit_route 분포 ──────────
  log('━━ STEP 2. 분포 (freeze-set 격리 근거) ━━');
  const dist = await q(`
    SELECT is_simulation, clinic_id, visit_route, count(*) AS n
    FROM customers
    WHERE name IS NOT NULL
      AND char_length(name) <> char_length(normalize(name, NFC))
    GROUP BY is_simulation, clinic_id, visit_route
    ORDER BY is_simulation, clinic_id, visit_route`);
  for (const r of dist) {
    log(`  is_simulation=${r.is_simulation} clinic=${String(r.clinic_id).slice(0,8)} visit_route=${r.visit_route ?? '-'} → ${r.n}건`);
  }
  log('');

  // ── STEP 3. seed 3건 확증 ──────────────────────────────────────
  log('━━ STEP 3. seed 3건(백민석/강승은/천승환) 확증 ━━');
  const seed = await q(`
    SELECT id, chart_number, name AS name_raw, lead_source, inflow_source, normalize(name,NFC) AS name_nfc,
           char_length(name) AS raw_len, is_simulation, clinic_id, visit_route
    FROM customers
    WHERE left(id::text,8) IN ('b734f069','f137fe98','0fc0752c')
    ORDER BY chart_number`);
  for (const r of seed) {
    log(`  ${String(r.id).slice(0,8)} chart=${r.chart_number ?? '-'} raw='${r.name_raw}'(len${r.raw_len}) nfc='${r.name_nfc}' sim=${r.is_simulation} via=${r.visit_route ?? '-'}`);
  }
  log('');

  // ── STEP 4. 이름검색 실패 재현 (pre-backfill) ──────────────────
  log('━━ STEP 4. 이름검색 실패 재현 (백필 전 기대: NFC 리터럴 검색 0건) ━━');
  for (const term of ['강승은', '백민석', '천승환']) {
    const rawHit = await q(`SELECT count(*) AS n FROM customers WHERE name LIKE '%${term}%'`);
    const nfcHit = await q(`SELECT count(*) AS n FROM customers WHERE normalize(name,NFC) LIKE '%${term}%'`);
    log(`  '${term}': raw LIKE=${rawHit[0].n}건 (백필 전 0 기대)  |  normalize(NFC) LIKE=${nfcHit[0].n}건 (백필 후 목표)`);
  }
  log('');

  // ── STEP 5. FK/파생 영향: reservations.customer_name 사본 NFD ──
  log('━━ STEP 5. 파생 denormalize 사본(reservations.customer_name) NFD 잔존 census ━━');
  const resvNfd = await q(`
    SELECT count(*) AS n
    FROM reservations
    WHERE customer_name IS NOT NULL
      AND char_length(customer_name) <> char_length(normalize(customer_name, NFC))`);
  log(`  reservations.customer_name NFD 사본: ${resvNfd[0].n}건 (백필 스코프 확정에 참고 — 본 티켓 1차 대상=customers.name)`);
  const ciNfd = await q(`
    SELECT count(*) AS n
    FROM check_ins
    WHERE customer_name IS NOT NULL
      AND char_length(customer_name) <> char_length(normalize(customer_name, NFC))`);
  log(`  check_ins.customer_name NFD 사본: ${ciNfd[0].n}건 (참고)`);
  log('');

  // ── STEP 6. freeze-set + rollback 원값 스냅샷 (JSON) ────────────
  log('━━ STEP 6. freeze-set PK + rollback 원값 스냅샷 → JSON 산출 ━━');
  const freeze = nfd.map((r) => ({
    id: r.id, chart_number: r.chart_number, clinic_id: r.clinic_id,
    is_simulation: r.is_simulation, visit_route: r.visit_route,
    name_before_nfd: r.name_raw, name_after_nfc: r.name_nfc,
    raw_len: r.raw_len, nfc_len: r.nfc_len, name_hex_raw: r.name_hex_raw,
  }));
  const snapshotPath = 'scripts/T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL_freeze.json';
  fs.writeFileSync(snapshotPath, JSON.stringify({ ref: REF, generated_by: 'census', count: freeze.length, freeze }, null, 2));
  log(`  freeze-set(${freeze.length}건) → ${snapshotPath} (before/after/rollback 원값 보존)`);
  log('');
  log('✅ census 완료 — write·DDL 0. gate_hold: DA CONSULT-REPLY(GO) 전 UPDATE 절대 금지.');

  fs.writeFileSync('scripts/T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL_census.out.txt', out.join('\n'));
} catch (e) {
  console.error('❌ census 실패:', e.message);
  process.exit(1);
}
