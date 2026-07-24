/**
 * T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL (B) 서류테스트2 —
 * READ-ONLY census: Q2b pure-test 판정 + CLEAR-B 노출창(마감 payload 발사여부) + flip 후보 SQL 캡처.
 *
 * planner NEW-TASK MSG-20260724-223114-zsah — DA disposition 확정(reporting-exclude, is_simulation flip).
 * hard-DELETE 폐기(ABORT). 본 러너는 모두 READ-ONLY. WRITE=HOLD(supervisor DB-GATE + 형 apply_gate 후).
 *
 * 요청 3항:
 *  1) Q2b pure-test — 서류테스트2 고객이 서류테스트2 case(check_in 7f3f8b79) 외 다른 실 활동이 전혀 없는가?
 *       YES → 1순위 경로(customers.is_simulation=TRUE 단건 flip, DDL 0·FK무접점·순소실0).
 *       NO  → 폴백(payments/service_charges is_simulation 컬럼 ADDITIVE = co-gate).
 *  2) CLEAR-B 노출창 — 07-24 서울오리진점(jongno-foot) 마감확정 payload 발사여부.
 *       (daily_closings status/closed_at + closing_confirmed_outbox status/sent_at)
 *       미발사=prevention / 발사=correction.
 *  3) flip 후보 — customers.is_simulation=TRUE UPDATE 문 + 롤백(FALSE) SQL dry-run 후보(실행 금지).
 *
 * 시크릿: SUPABASE_ACCESS_TOKEN or ~/.config/medibuilder-secrets/foot-supabase-pat
 */
import fs from 'node:fs';
import os from 'node:os';

const REF = 'rxlomoozakkjesdqjtvd';
const CHECK_IN = ['7f3f8b79-eb3d-45f2-afab-205d52bc4a70']; // 서류테스트2 완료건
const TARGET_DATE = '2026-07-24';
const JONGNO_FOOT_CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 서울오리진점(발톱)

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
try { if (!TOKEN) TOKEN = fs.readFileSync(os.homedir() + '/.config/medibuilder-secrets/foot-supabase-pat', 'utf8').trim(); } catch {}
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = l.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/); if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ PAT 미제공'); process.exit(1); }

const arr = (a) => `ARRAY[${a.map((x) => `'${x}'`).join(',')}]::uuid[]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function q(sql) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    const t = await r.text();
    if (r.status === 429 || /ThrottlerException|Too Many Requests/.test(t)) { await sleep(1500 * (attempt + 1)); continue; }
    let j = null; try { j = JSON.parse(t); } catch {}
    await sleep(300);
    if (!r.ok) console.error(`  [SQL ERR] ${t.slice(0, 200)}`);
    return { ok: r.ok, body: t, rows: Array.isArray(j) ? j : null };
  }
  return { ok: false, body: 'THROTTLED_GIVEUP', rows: null };
}
const has = (r) => (r.rows && r.rows.length ? r.rows : []);
const cnt = (r) => (r.rows && r.rows[0] ? Number(Object.values(r.rows[0])[0]) : null);

console.log(`# (B) 서류테스트2 pure-test census + CLEAR-B 노출창 · ${new Date().toISOString()} · READ-ONLY(WRITE 0)\n`);

// ── (0) canary — ROLLBACK 실효 선증명 ──────────────────────────────────────────
{
  const CAN = '__CENSUS_CANARY_ZSAH__';
  await q(`BEGIN; COMMENT ON TABLE public.customers IS '${CAN}'; ROLLBACK;`);
  const c = await q(`SELECT obj_description('public.customers'::regclass) AS c`);
  const persisted = c.rows?.[0]?.c === CAN;
  console.log(`── (0) canary ROLLBACK 실효: ${persisted ? '❌ 잔존(ABORT)' : '✅ 무영속(READ-ONLY 보장)'}`);
  if (persisted) { console.error('CANARY_PERSISTED — 중단'); process.exit(1); }
}

// ── resolve customer ────────────────────────────────────────────────────────────
const ciRow = await q(`SELECT id, customer_id, customer_name, clinic_id, status, visit_type, created_at
                       FROM public.check_ins WHERE id = ANY(${arr(CHECK_IN)})`);
console.log(`\n── 서류테스트2 check_in:\n${JSON.stringify(has(ciRow), null, 2)}`);
const CUSTOMER = [...new Set(has(ciRow).map((r) => r.customer_id).filter(Boolean))];
console.log(`\n── customer_id = ${JSON.stringify(CUSTOMER)}`);
if (!CUSTOMER.length) { console.error('customer_id resolve 실패 — 중단'); process.exit(1); }
const CID = arr(CUSTOMER);

const crow = await q(`SELECT id, name, phone, clinic_id, is_simulation, created_at, updated_at
                      FROM public.customers WHERE id = ANY(${CID})`);
console.log(`\n── customers 레코드 (is_simulation 현재값):\n${JSON.stringify(has(crow), null, 2)}`);

// ══════════════════════════════════════════════════════════════════════════════
// Q2b: pure-test 판정 — 서류테스트2 case 외 다른 활동?
// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n\n═══ Q2b: pure-test 판정 (서류테스트2 case 외 활동 census) ═══`);

const allCi = await q(`SELECT id, customer_name, clinic_id, status, visit_type, created_at,
                        (id = ANY(${arr(CHECK_IN)})) AS is_seoryu2_case
                       FROM public.check_ins WHERE customer_id = ANY(${CID}) ORDER BY created_at`);
console.log(`\n▶ check_ins 전체 ${has(allCi).length}건:`);
console.log(JSON.stringify(has(allCi), null, 2));
const otherCi = has(allCi).filter((r) => !r.is_seoryu2_case);

const resv = await q(`SELECT id, clinic_id, source_system, status, reservation_date, reservation_time,
                        visit_type, created_via, created_at, cancelled_at
                       FROM public.reservations WHERE customer_id = ANY(${CID}) ORDER BY created_at`);
console.log(`\n▶ reservations 전체 ${has(resv).length}건:`);
console.log(JSON.stringify(has(resv), null, 2));

const pays = await q(`SELECT id, check_in_id, amount, status, accounting_date, clinic_id, created_at
                      FROM public.payments WHERE customer_id = ANY(${CID}) ORDER BY created_at`);
console.log(`\n▶ payments 전체 ${has(pays).length}건:`);
console.log(JSON.stringify(has(pays), null, 2));
const payNotSeoryu = has(pays).filter((r) => !CHECK_IN.includes(r.check_in_id));

const sc = await q(`SELECT id, check_in_id, customer_id, base_amount, clinic_id
                    FROM public.service_charges WHERE customer_id = ANY(${CID})`);
console.log(`\n▶ service_charges 전체 ${has(sc).length}건:`);
console.log(JSON.stringify(has(sc), null, 2));

const pkg = await q(`SELECT id, customer_id, paid_amount, status, memo, created_at
                     FROM public.packages WHERE customer_id = ANY(${CID}) ORDER BY created_at`);
console.log(`\n▶ packages 전체 ${has(pkg).length}건:`);
console.log(JSON.stringify(has(pkg), null, 2));

// 활동 없는 곳 카운트만 (appointments 등 있으면)
for (const tbl of ['appointments', 'consultations']) {
  const ex = await q(`SELECT to_regclass('public.${tbl}') AS t`);
  if (ex.rows?.[0]?.t) {
    const c = await q(`SELECT count(*) FROM public.${tbl} WHERE customer_id = ANY(${CID})`);
    console.log(`\n▶ ${tbl} count = ${cnt(c)}`);
  }
}

console.log(`\n▶▶ Q2b 판정 재료:`);
console.log(`   · 서류테스트2 외 check_ins = ${otherCi.length}`);
console.log(`   · reservations 전체 = ${has(resv).length} (source_system 분포: ${JSON.stringify([...new Set(has(resv).map((r) => r.source_system))])})`);
console.log(`   · 서류테스트2 case 외 payments = ${payNotSeoryu.length}`);
console.log(`   · packages = ${has(pkg).length} (memo: ${JSON.stringify(has(pkg).map((r) => r.memo))})`);
const pureTest = otherCi.length === 0 && has(resv).length === 0 && payNotSeoryu.length === 0;
console.log(`   ⇒ 잠정 pure-test = ${pureTest ? 'YES (서류테스트2 case 단일 귀속)' : 'NO (case 외 활동 발견 → 폴백 검토)'}`);

// ══════════════════════════════════════════════════════════════════════════════
// CLEAR-B: 07-24 서울오리진점(jongno-foot) 마감 payload 발사여부
// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n\n═══ CLEAR-B: ${TARGET_DATE} 서울오리진점(jongno-foot=${JONGNO_FOOT_CLINIC}) 마감 payload 발사여부 ═══`);

const dc = await q(`SELECT id, clinic_id, close_date, status, closed_at, confirmed_by, unconfirmed_at, revision, dirty, updated_at
                    FROM public.daily_closings
                    WHERE clinic_id = '${JONGNO_FOOT_CLINIC}' AND close_date = '${TARGET_DATE}'`);
console.log(`\n▶ daily_closings (jongno-foot, ${TARGET_DATE}) — ${has(dc).length}건:`);
console.log(JSON.stringify(has(dc), null, 2));

// 인접 날짜도 참고 (소급 마감 여부)
const dcAll = await q(`SELECT close_date, status, closed_at, confirmed_by FROM public.daily_closings
                       WHERE clinic_id = '${JONGNO_FOOT_CLINIC}' AND close_date >= '${TARGET_DATE}'::date - 3
                       ORDER BY close_date`);
console.log(`\n▶ daily_closings (jongno-foot, 최근 D-3~) 참고:`);
console.log(JSON.stringify(has(dcAll), null, 2));

const cbo = await q(`SELECT id, clinic_slug, close_date, revision, superseded, status, attempts,
                      sent_at, dlq, last_error, event_id, created_at, updated_at
                     FROM public.closing_confirmed_outbox
                     WHERE clinic_id = '${JONGNO_FOOT_CLINIC}' AND close_date = '${TARGET_DATE}'
                     ORDER BY created_at`);
console.log(`\n▶ closing_confirmed_outbox (jongno-foot, ${TARGET_DATE}) — ${has(cbo).length}건:`);
console.log(JSON.stringify(has(cbo), null, 2));

const cboAll = await q(`SELECT clinic_slug, close_date, status, sent_at, dlq, created_at
                        FROM public.closing_confirmed_outbox ORDER BY created_at DESC LIMIT 8`);
console.log(`\n▶ closing_confirmed_outbox 최근 8건(전체 clinic) 참고:`);
console.log(JSON.stringify(has(cboAll), null, 2));

const dcConfirmed = has(dc).some((r) => r.status === 'confirmed' || r.closed_at);
const cboSent = has(cbo).some((r) => r.sent_at || r.status === 'sent' || r.status === 'delivered');
console.log(`\n▶▶ CLEAR-B 판정 재료:`);
console.log(`   · daily_closings 마감확정(status=confirmed OR closed_at) = ${dcConfirmed ? 'YES' : 'NO'}`);
console.log(`   · closing_confirmed_outbox payload 발사(sent_at OR status=sent) = ${cboSent ? 'YES' : 'NO'}`);
console.log(`   ⇒ ${!dcConfirmed && !cboSent ? 'PREVENTION (마감 미발사 → flip 외 조치 0)' : 'CORRECTION 후보 (마감/payload 발사 → 재대사 검토, 단 dev-sales fct lane 은 PREVENTION 확정)'}`);

// ══════════════════════════════════════════════════════════════════════════════
// flip 후보 SQL + 롤백 (실행 금지 · WRITE HOLD)
// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n\n═══ flip 후보 SQL (실행 금지 · dry-run 캡처만 · WRITE HOLD) ═══`);
console.log(`
-- ▶ FORWARD (reporting-exclude flip · 대상 customer_id = ${CUSTOMER.join(', ')})
UPDATE public.customers SET is_simulation = TRUE, updated_at = now()
WHERE id = ANY(${CID}) AND is_simulation IS DISTINCT FROM TRUE;
-- 예상 rows-affected = ${CUSTOMER.length}

-- ▶ ROLLBACK (원복 · is_simulation=FALSE 복원)
UPDATE public.customers SET is_simulation = FALSE, updated_at = now()
WHERE id = ANY(${CID});
`);

const dry = await q(`BEGIN;
  WITH upd AS (
    UPDATE public.customers SET is_simulation = TRUE
    WHERE id = ANY(${CID}) AND is_simulation IS DISTINCT FROM TRUE
    RETURNING id
  ) SELECT count(*) AS would_flip FROM upd;
ROLLBACK;`);
console.log(`▶ flip dry-run rows-would-affect = ${cnt(dry)}`);
const reverify = await q(`SELECT id, is_simulation FROM public.customers WHERE id = ANY(${CID})`);
console.log(`▶ dry-run 후 is_simulation 재확인(무영속 검증) = ${JSON.stringify(has(reverify))}`);

console.log(`\n✅ census 완료 · WRITE 0 · prod 무변경.`);
