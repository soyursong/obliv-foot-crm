/**
 * POSTCHECK (anon 세션 behavioral 실측): T-20260812-foot-ANON-REVOKE-REFTABLES
 * ─────────────────────────────────────────────────────────────────────────────
 * DA AC-1 routing: supervisor 가 (1) apply 前 behavioral-401 선행 확증(§5⚠⚠⚠d — grant≠realized
 *   INERT false-positive 배제), (2) apply 後 REVOKE 실효 + KEEP 무회귀를 실측하는 데 쓴다.
 *
 * ── BEFORE (apply 前, INERT 상태) 기대 ────────────────────────────────────────
 *   8 target: anon REST → HTTP 200 + 0 rows (grant 존치·RLS deny = INERT). ← behavioral-401 선행:
 *     "grant≠realized" 확증(anon 이 실제로 데이터를 못 읽음). 200+0row 이면 REVOKE=회귀0 안전.
 *     (만약 BEFORE 에 0 아닌 row 가 나오면 = EFFECTIVE 오분류 → abort, DA re-CONSULT.)
 *
 * ── AFTER (apply 後) 기대 ──────────────────────────────────────────────────────
 *   8 target: anon REST → HTTP 401/403 + code 42501("permission denied for table") = grant 완전 회수.
 *   KEEP(clinics·waiting_board): anon REST → 여전히 정상(200) = 무회귀(본 티켓 미접촉 collateral 가드).
 *   relacl(service_role introspection): 8 target anon ACL 엔트리 = 0.
 *
 * 실행:
 *   BEFORE: node scripts/T-20260812-foot-ANON-REVOKE-REFTABLES_postcheck.mjs --phase before
 *   AFTER : node scripts/T-20260812-foot-ANON-REVOKE-REFTABLES_postcheck.mjs --phase after
 * 필요: .env.local VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_ACCESS_TOKEN.
 */
import { readFileSync } from 'node:fs';
import { q } from './dryrun_lib.mjs';

function env(k) {
  if (process.env[k]) return process.env[k].trim();
  const m = readFileSync('.env.local', 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm'));
  if (!m) throw new Error('missing ' + k + ' in env/.env.local');
  return m[1].trim();
}
const URL = env('VITE_SUPABASE_URL');
const ANON = env('VITE_SUPABASE_ANON_KEY');

const phase = (() => {
  const i = process.argv.indexOf('--phase');
  return i >= 0 ? (process.argv[i + 1] || 'after') : 'after';
})();

// ★ INERT subset 5/8 (behavioral-401 self-front). EFFECTIVE 3=DEFERRED(DA 재-CONSULT).
const TARGETS = [
  'call_type_codes', 'check_in_services', 'clinic_holidays', 'clinic_schedules', 'prescription_codes',
];
// DEFERRED (참고 관측만·본 티켓 미접촉): census 오분류로 anon-EFFECTIVE 확인된 3표.
const DEFERRED = ['form_templates', 'redpay_terminal_registry', 'room_role_mapping'];
const KEEP = ['clinics', 'waiting_board'];

async function anonSelect(table) {
  const r = await fetch(`${URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, Prefer: 'count=exact' },
  });
  const body = await r.text();
  let rows = -1;
  const cr = r.headers.get('content-range');
  if (cr) { const m = cr.match(/\/(\d+|\*)$/); rows = m && m[1] !== '*' ? Number(m[1]) : (cr.startsWith('*/') ? 0 : rows); }
  const denied = r.status === 401 || r.status === 403 || /42501|permission denied/i.test(body);
  return { status: r.status, exactCount: rows, denied, sample: body.slice(0, 140) };
}

(async () => {
  console.log(`== POSTCHECK T-20260812-foot-ANON-REVOKE-REFTABLES [phase=${phase}] ==`, new Date().toISOString(), '\n');

  // relacl introspection (§5 정본): 5 target anon ACL 엔트리 (anon 만 정확 필터).
  //   테이블별 anon 엔트리가 없으면 행이 안 나오므로, TARGETS 를 기준으로 없는 것은 '(none)' 처리.
  const aclRows = await q(`SELECT c.relname, string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS anon_privs
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r ON r.oid = a.grantee
    WHERE c.relnamespace = 'public'::regnamespace
      AND r.rolname = 'anon'
      AND c.relname = ANY(ARRAY['call_type_codes','check_in_services','clinic_holidays','clinic_schedules','prescription_codes'])
    GROUP BY c.relname ORDER BY c.relname`);
  const aclMap = Object.fromEntries(aclRows.map(r => [r.relname, r.anon_privs]));
  const acl = TARGETS.map(t => ({ relname: t, anon_privs: aclMap[t] || '(none)' }));
  console.log('[relacl anon privs on 5 target]');
  for (const row of acl) console.log(`  ${row.relname.padEnd(24)} ${row.anon_privs}`);
  console.log('');

  console.log('── TARGET 8 (anon REST behavioral) ──');
  const res = {};
  for (const t of TARGETS) { const r = await anonSelect(t); res[t] = r; console.log(`  ${t.padEnd(24)} status=${r.status} denied=${r.denied} anon_count=${r.exactCount}`); }

  console.log('\n── DEFERRED 3 (참고 관측·본 티켓 미접촉·DA 재-CONSULT 대상) ──');
  for (const t of DEFERRED) { const r = await anonSelect(t); console.log(`  ${t.padEnd(24)} status=${r.status} denied=${r.denied} anon_count=${r.exactCount} ${r.exactCount > 0 ? '← EFFECTIVE(anon reads rows)' : ''}`); }

  console.log('\n── KEEP (무회귀 가드·200 기대) ──');
  const keepRes = {};
  for (const t of KEEP) { const r = await anonSelect(t); keepRes[t] = r; console.log(`  ${t.padEnd(24)} status=${r.status} denied=${r.denied} anon_count=${r.exactCount}`); }

  console.log('\n── 판정 ──');
  // PostgREST: 행 반환 시 206(Partial Content), 빈 결과 200. 둘 다 접근가능(denied=false).
  //   회귀(regression) 신호 = 401/403/denied. → KEEP accessible = 2xx AND !denied.
  const accessible = (r) => (r.status >= 200 && r.status < 300) && !r.denied;
  const keepOk = KEEP.every(t => accessible(keepRes[t]));
  if (phase === 'before') {
    // INERT 확증: grant 존치(200) + 0 row (RLS deny). grant≠realized false-positive 배제.
    const inertOk = TARGETS.every(t => res[t].status === 200 && res[t].exactCount === 0);
    console.log(`  BEFORE INERT 확증(200+0row) : ${inertOk ? 'PASS' : 'FAIL(EFFECTIVE 오분류 의심 — abort/DA re-CONSULT)'}`);
    console.log(`  KEEP 정상(200)              : ${keepOk ? 'PASS' : 'FAIL'}`);
    if (!(inertOk && keepOk)) { console.log('\n❌ BEFORE POSTCHECK FAIL — REVOKE 착수 금지'); process.exit(1); }
    console.log('\n✅ BEFORE POSTCHECK PASS — behavioral-401 선행(INERT) 확증. REVOKE apply 안전.');
  } else {
    // AFTER: 8 target anon 차단(denied) + relacl 0 + KEEP 무회귀.
    const revokedOk = TARGETS.every(t => res[t].denied);
    const aclOk = acl.every(row => row.anon_privs === '(none)') && acl.length === TARGETS.length;
    console.log(`  TARGET anon 차단(401/42501) : ${revokedOk ? 'PASS' : 'FAIL — 잔존:' + TARGETS.filter(t => !res[t].denied).join(',')}`);
    console.log(`  relacl anon 엔트리 0        : ${aclOk ? 'PASS' : 'FAIL'}`);
    console.log(`  KEEP 무회귀(200)           : ${keepOk ? 'PASS' : 'FAIL(clinics/waiting_board 회귀!)'}`);
    if (!(revokedOk && aclOk && keepOk)) { console.log('\n❌ AFTER POSTCHECK FAIL'); process.exit(1); }
    console.log('\n✅ AFTER POSTCHECK PASS — anon REVOKE 실효 + KEEP 무회귀 확증.');
  }
})();
