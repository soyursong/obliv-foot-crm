/**
 * POSTCHECK (anon 세션 behavioral 실측): T-20260812-foot-ANONREVOKE-REFTABLES-EFF3
 * ─────────────────────────────────────────────────────────────────────────────
 * AC4 supervisor DB-GATE POSTCHECK: apply 前/後 SEAL 실효 + 스태프 authed read 무손 실측.
 *
 * ── BEFORE (apply 前, EFFECTIVE 상태) 기대 ────────────────────────────────────
 *   3 target: anon REST → HTTP 200/206 + rows>0 (live-leak). ← EFFECTIVE 확증.
 *     (form_templates=35, redpay_terminal_registry=44, room_role_mapping=4 실측 2026-08-12.)
 *
 * ── AFTER (apply 後) 기대 ──────────────────────────────────────────────────────
 *   3 target: anon REST → 200/206 + anon_count=0 (RESTRICTIVE anon-deny = permissive AND false).
 *     ※ RESTRICTIVE 봉인은 grant 존치 → PostgREST 는 42501 이 아니라 0-row(RLS 필터) 반환.
 *       (grant REVOKE 방식이 아니므로 401/403 이 아님 — 정상. 봉인 판정 = anon_count 0.)
 *   staff(authed) read 무손: service_role introspection 으로 permissive `TO public` + authenticated
 *     정책 존치 확인 + restrictive anon-deny 3정책 실재.
 *
 * 실행:
 *   BEFORE: node scripts/T-20260812-foot-ANONREVOKE-REFTABLES-EFF3_postcheck.mjs --phase before
 *   AFTER : node scripts/T-20260812-foot-ANONREVOKE-REFTABLES-EFF3_postcheck.mjs --phase after
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

const TARGETS = ['form_templates', 'redpay_terminal_registry', 'room_role_mapping'];
const RESTRICTIVE = {
  form_templates: 'form_templates_anon_deny',
  redpay_terminal_registry: 'redpay_terminal_registry_anon_deny',
  room_role_mapping: 'room_role_mapping_anon_deny',
};
const PERMISSIVE = {
  form_templates: 'form_templates_read',
  redpay_terminal_registry: 'redpay_terminal_registry_read_all',
  room_role_mapping: 'room_role_read',
};

async function anonSelect(table) {
  const r = await fetch(`${URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, Prefer: 'count=exact' },
  });
  const body = await r.text();
  let rows = -1;
  const cr = r.headers.get('content-range');
  if (cr) { const m = cr.match(/\/(\d+|\*)$/); rows = m && m[1] !== '*' ? Number(m[1]) : (cr.startsWith('*/') ? 0 : rows); }
  const denied = r.status === 401 || r.status === 403 || /42501|permission denied/i.test(body);
  return { status: r.status, exactCount: rows, denied, sample: body.slice(0, 120) };
}

(async () => {
  console.log(`== POSTCHECK T-20260812-foot-ANONREVOKE-REFTABLES-EFF3 [phase=${phase}] ==`, new Date().toISOString(), '\n');

  // ── policy introspection (service_role) ──
  const pol = await q(`SELECT tablename, policyname, permissive, roles::text AS roles
    FROM pg_policies WHERE schemaname='public'
      AND tablename = ANY(ARRAY['form_templates','redpay_terminal_registry','room_role_mapping'])
    ORDER BY tablename, permissive, policyname`);
  console.log('[policies on 3 target]');
  for (const p of pol) console.log(`  ${p.tablename.padEnd(26)} ${String(p.permissive).padEnd(11)} ${p.policyname.padEnd(36)} ${p.roles}`);
  console.log('');

  // ── anon behavioral ──
  console.log('── TARGET 3 (anon REST behavioral) ──');
  const res = {};
  for (const t of TARGETS) { const r = await anonSelect(t); res[t] = r; console.log(`  ${t.padEnd(26)} status=${r.status} denied=${r.denied} anon_count=${r.exactCount}`); }

  // ── 판정 ──
  console.log('\n── 판정 ──');
  let ok = true;
  if (phase === 'before') {
    for (const t of TARGETS) {
      const leak = res[t].exactCount > 0;
      console.log(`  [BEFORE] ${t.padEnd(26)} EFFECTIVE(anon reads ${res[t].exactCount} rows) = ${leak ? 'CONFIRM' : 'UNEXPECTED(0 — 이미 봉인?)'}`);
      if (!leak) ok = false;
    }
  } else {
    // AFTER: restrictive 3정책 실재 + permissive 존치 + anon_count 0
    const restr = pol.filter(p => p.permissive === 'RESTRICTIVE' && Object.values(RESTRICTIVE).includes(p.policyname) && p.roles === '{anon}').length;
    const perm = pol.filter(p => Object.values(PERMISSIVE).includes(p.policyname)).length;
    console.log(`  [AFTER] restrictive anon-deny 3정책 실재 = ${restr}/3 ${restr === 3 ? 'OK' : 'FAIL'}`);
    console.log(`  [AFTER] permissive TO-public 3정책 존치(ADDITIVE 불변식) = ${perm}/3 ${perm === 3 ? 'OK' : 'FAIL'}`);
    if (restr !== 3 || perm !== 3) ok = false;
    for (const t of TARGETS) {
      const sealed = res[t].exactCount === 0;
      console.log(`  [AFTER] ${t.padEnd(26)} anon_count=${res[t].exactCount} = ${sealed ? 'SEALED(0-row)' : 'LEAK STILL OPEN — FAIL'}`);
      if (!sealed) ok = false;
    }
  }
  console.log(`\n== ${phase.toUpperCase()} ${ok ? 'PASS' : 'FAIL'} ==`);
  process.exit(ok ? 0 : 1);
})();
