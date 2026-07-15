/**
 * T-20260715-foot-WRITEPATH-MASK-SOURCE-CLOSE-R2 — PROD APPLY (DB-only)
 *
 * 게이트: supervisor DDL-diff = PASS (ticket §125~131) + DA CONSULT-REPLY GO
 *         (MSG-20260715-001514-b6jm) + supervisor PUSH-ESCALATION apply 지시
 *         (MSG-20260715-182431-m3do). ADDITIVE → 대표 게이트 면제(§3.1).
 *
 * 확장 = 2경로: fn_dashboard_reissue_health_q_token / upsert_reservation_from_source.
 * 판정자 = 旣GO 공유 helper public._fn_is_masked_pii(text,text) (20260714120000, prod n=1).
 *
 * MIG-GATE 프로토콜:
 *   1) 멱등 apply — 마이그 body(자체 BEGIN..COMMIT), 2함수 CREATE OR REPLACE → 재실행 안전.
 *   2) 원장 자동 기록 — supabase_migrations.schema_migrations version=20260715120000
 *      (forward-only, last=20260714120000). ON CONFLICT DO NOTHING(멱등).
 *   3) post-probe introspection — 2함수 가드 지문(_fn_is_masked_pii) present + 가드 22023 발화.
 *   4) 신규 masked customers write 0 — 소스차단 사후 확증(마스킹 payload → reject, 무삽입).
 * author: dev-foot / 2026-07-15 · Management API
 */
import { readFileSync } from 'node:fs';

const REF = 'rxlomoozakkjesdqjtvd';
const VERSION = '20260715120000';
const NAME = 'maskreject_writepath_rescope_2paths';
const MIG = 'supabase/migrations/20260715120000_maskreject_writepath_rescope_2paths.sql';
const FNS = ['fn_dashboard_reissue_health_q_token', 'upsert_reservation_from_source'];
const SLUG = 'jongno-foot';

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  try { TOKEN = (readFileSync('.env.local', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, ''); } catch {}
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  return { ok: r.ok, status: r.status, body: t };
}
async function qok(sql) { const r = await q(sql); if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0,1500)}`); return JSON.parse(r.body); }
const rows = x => x.result ?? x;

let pass = true;
const chk = (ok, msg) => { console.log(`  ${ok ? '✅' : '❌'} ${msg}`); pass = ok && pass; };
const fnPredicate = `pg_get_functiondef(p.oid) ILIKE '%_fn_is_masked_pii%'`;

async function main() {
  const applyTs = (await qok(`SELECT now() AT TIME ZONE 'Asia/Seoul' AS kst, now() AS utc;`))[0] ?? rows(await qok(`SELECT now() AT TIME ZONE 'Asia/Seoul' AS kst, now() AS utc;`))[0];
  console.log('=== T-20260715 WRITEPATH-MASK-SOURCE-CLOSE-R2 PROD APPLY ===\n');

  // ── PRE ──
  console.log('── PRE ──');
  const preLedger = rows(await qok(`SELECT version FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`));
  console.log(`  원장 ${VERSION} 기존기록 n=${preLedger.length}`);
  const preGuard = rows(await qok(`SELECT p.proname, (${fnPredicate}) AS has_guard
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('${FNS.join("','")}') ORDER BY p.proname;`));
  preGuard.forEach(x => console.log(`  PRE ${x.proname} has_guard=${x.has_guard}`));
  const preHelper = rows(await qok(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='_fn_is_masked_pii';`))[0];
  console.log(`  helper _fn_is_masked_pii n=${preHelper.n}`);

  // ── 1) 멱등 apply (마이그 자체 BEGIN..COMMIT) ──
  console.log(`\n── APPLY ${MIG} ──`);
  const r = await q(readFileSync(MIG, 'utf8'));
  if (!r.ok) { console.error(`  ❌ 적용 실패 HTTP ${r.status}: ${r.body.slice(0,2000)}`); process.exit(1); }
  console.log(`  ✅ 마이그 적용 완료 (COMMIT) — apply_ts KST=${applyTs.kst} / UTC=${applyTs.utc}`);

  // ── 2) 원장 자동 기록 (멱등) ──
  await qok(`INSERT INTO supabase_migrations.schema_migrations (version, name, created_by)
             VALUES ('${VERSION}', '${NAME}', 'dev-foot:T-20260715-foot-WRITEPATH-MASK-SOURCE-CLOSE-R2')
             ON CONFLICT (version) DO NOTHING;`);
  const postLedger = rows(await qok(`SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`));

  // ── 3) post-probe: 2함수 가드 지문 present ──
  console.log('\n════ POST-PROBE INTROSPECTION ════');
  const postGuard = rows(await qok(`SELECT p.proname, (${fnPredicate}) AS has_guard
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('${FNS.join("','")}') ORDER BY p.proname;`));
  const gmap = Object.fromEntries(postGuard.map(x => [x.proname, x.has_guard]));
  FNS.forEach(fn => chk(gmap[fn] === true, `가드 지문 present: ${fn} (has_guard=${gmap[fn]})`));
  chk(postLedger.length === 1, `원장 기록 완료 version=${VERSION} name=${postLedger[0]?.name}`);

  const helper = rows(await qok(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='_fn_is_masked_pii';`))[0];
  chk(helper.n === 1, `공유 helper _fn_is_masked_pii 영속 (n=${helper.n})`);

  // ── 4) 가드 fail-closed 22023 발화 + 회귀 무 (무영속: BEGIN..ROLLBACK) ──
  console.log('\n── 가드 행위 확인 (masked→reject 22023 / legit→pass · 무영속 ROLLBACK) ──');
  const beh = rows(await qok(`
    BEGIN;
    CREATE TEMP TABLE _pp(t text, result text) ON COMMIT DROP;
    -- A: reissue masked → 가드 fire (기대 22023)
    DO $D$ BEGIN
      PERFORM public.fn_dashboard_reissue_health_q_token('7887','${SLUG}','접****1');
      INSERT INTO _pp VALUES('A_reissue_masked','NO_REJECT');
    EXCEPTION WHEN others THEN INSERT INTO _pp VALUES('A_reissue_masked','rejected '||SQLSTATE); END $D$;
    -- B: reissue legit (없는 clinic) → 가드 통과, clinic_not_found (false-reject 무)
    DO $D$ DECLARE j jsonb; BEGIN
      j := public.fn_dashboard_reissue_health_q_token('+821099998888','__pp_no_clinic__','홍길동');
      INSERT INTO _pp VALUES('B_reissue_legit','passed → '||COALESCE(j->>'error','ok'));
    EXCEPTION WHEN others THEN INSERT INTO _pp VALUES('B_reissue_legit','UNEXPECTED '||SQLSTATE); END $D$;
    -- C: upsert masked active → customers persist 경계 가드 fire (기대 22023)
    DO $D$ BEGIN
      PERFORM public.upsert_reservation_from_source('dopamine','__pp_c__','${SLUG}','7887','접****1',CURRENT_DATE+1,'10:00');
      INSERT INTO _pp VALUES('C_upsert_masked','NO_REJECT');
    EXCEPTION WHEN others THEN INSERT INTO _pp VALUES('C_upsert_masked','rejected '||SQLSTATE); END $D$;
    -- D: upsert masked 취소 fast-path (없는 external_id) → carve-out 무해 (no-reject NULL)
    DO $D$ DECLARE u uuid; BEGIN
      u := public.upsert_reservation_from_source('dopamine','__pp_d_absent__','${SLUG}','7887','접****1',CURRENT_DATE+1,'10:00','도파민','cancelled');
      INSERT INTO _pp VALUES('D_upsert_masked_cancel','no-reject, returned '||COALESCE(u::text,'NULL'));
    EXCEPTION WHEN others THEN INSERT INTO _pp VALUES('D_upsert_masked_cancel','UNEXPECTED '||SQLSTATE); END $D$;
    -- E: upsert legit active → 가드 통과, 예약 upsert 성공 (false-reject 무)
    DO $D$ DECLARE u uuid; BEGIN
      u := public.upsert_reservation_from_source('dopamine','__pp_e__','${SLUG}','+821077776666','김정상',CURRENT_DATE+1,'11:00');
      INSERT INTO _pp VALUES('E_upsert_legit','passed → '||CASE WHEN u IS NOT NULL THEN 'reservation ok' ELSE 'NULL' END);
    EXCEPTION WHEN others THEN INSERT INTO _pp VALUES('E_upsert_legit','UNEXPECTED '||SQLSTATE); END $D$;
    SELECT t, result FROM _pp ORDER BY t;
    ROLLBACK;`));
  const bmap = Object.fromEntries((Array.isArray(beh) ? beh : []).map(x => [x.t, x.result]));
  Object.entries(bmap).forEach(([k, v]) => console.log(`    [${k}] ${v}`));
  chk(/rejected 22023/.test(bmap.A_reissue_masked || ''), `A reissue masked → 22023 reject`);
  chk(/passed/.test(bmap.B_reissue_legit || ''), `B reissue legit → pass (false-reject 0)`);
  chk(/rejected 22023/.test(bmap.C_upsert_masked || ''), `C upsert masked → 22023 reject`);
  chk(/no-reject/.test(bmap.D_upsert_masked_cancel || ''), `D upsert masked 취소 fast-path → carve-out 무해`);
  chk(/passed/.test(bmap.E_upsert_legit || ''), `E upsert legit → pass (false-reject 0)`);

  // ── 5) 신규 masked customers write 0 (소스차단 사후 확증) ──
  console.log('\n── 신규 masked customers write 0 확증 ──');
  const masked = rows(await qok(`
    SELECT count(*)::int AS n
    FROM public.customers c
    WHERE public._fn_is_masked_pii(c.name, c.phone) = true
      AND c.created_at >= (now() - INTERVAL '10 minutes');`))[0];
  chk(masked.n === 0, `apply 직후 10분내 신규 masked customers = ${masked.n}건 (기대 0)`);
  const maskedTotal = rows(await qok(`
    SELECT count(*)::int AS n FROM public.customers c WHERE public._fn_is_masked_pii(c.name, c.phone) = true;`))[0];
  console.log(`  (참고) 잔존 masked customers 총 ${maskedTotal.n}건 — 정정은 CONTAM-BACKFILL 소관(소스차단=본 R2).`);

  console.log(`\n=== 판정: ${pass ? 'PASS ✅ (2경로 가드 present + fire + 회귀 0 + 신규 masked write 0)' : 'FAIL ⚠ — 위 결과 확인'} ===`);
  console.log(`apply_ts KST=${applyTs.kst}`);
  if (!pass) process.exit(2);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
