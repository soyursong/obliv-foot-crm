/**
 * POSTCHECK (anon 세션 실효 실측): T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL
 * ─────────────────────────────────────────────────────────────────────────────
 * apply(GO-token 게이트) 이후 실행. 실제 anon-key REST 세션으로 PostgREST 를 때려
 * anon-도달이 실효로 차단됐는지 + 보류(HOLD) 테이블은 무접촉인지 실측한다.
 *
 * 기대(apply 후):
 *   · services       anon SELECT → 0 rows (RESTRICTIVE anon-deny 실효; 테이블은 service_role 로 비어있지 않음)
 *   · package_tiers  anon SELECT → 0 rows
 *   · waiting_board  anon SELECT → 여전히 정상 read (HOLD·무접촉 회귀 가드 — 공개 대기현황판 보존)
 *   · checklists     anon SELECT → 상태 변화 없음(HOLD·무접촉; 본 티켓 미봉쇄)
 *
 * 실행: (repo root) node scripts/T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL_postcheck.mjs
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

async function anonSelect(table) {
  const r = await fetch(`${URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, Prefer: 'count=exact' },
  });
  const body = await r.text();
  let rows = -1;
  const cr = r.headers.get('content-range'); // e.g. "0-0/12" or "*/0"
  if (cr) { const m = cr.match(/\/(\d+|\*)$/); rows = m && m[1] !== '*' ? Number(m[1]) : (cr.startsWith('*/') ? 0 : rows); }
  return { status: r.status, contentRange: cr, exactCount: rows, sample: body.slice(0, 120) };
}

(async () => {
  console.log('== POSTCHECK anon-key REST 실효 실측 ==', new Date().toISOString(), '\n');

  // service_role 실 row 수 대조(테이블 비어서 0이 아님을 확립)
  const totals = await q(`SELECT
      (SELECT count(*) FROM public.services) svc,
      (SELECT count(*) FROM public.package_tiers) pkg,
      (SELECT count(*) FROM public.waiting_board) wb,
      (SELECT count(*) FROM public.checklists) chk`);
  console.log('[service_role totals]', JSON.stringify(totals[0]), '\n');

  const seal = ['services', 'package_tiers'];
  const hold = ['waiting_board', 'checklists'];

  console.log('── SEAL 대상 (anon count = 0 기대) ──');
  const results = {};
  for (const t of seal) { const r = await anonSelect(t); results[t] = r; console.log(`  ${t.padEnd(16)} status=${r.status} anon_count=${r.exactCount} (range=${r.contentRange})`); }

  console.log('\n── HOLD 대상 (무접촉 회귀 가드) ──');
  for (const t of hold) { const r = await anonSelect(t); results[t] = r; console.log(`  ${t.padEnd(16)} status=${r.status} anon_count=${r.exactCount} (range=${r.contentRange})`); }

  // 판정
  console.log('\n── 판정 ──');
  const t0 = totals[0];
  const sealOk = seal.every(t => results[t].exactCount === 0);
  const contrastOk = Number(t0.svc) > 0 || Number(t0.pkg) > 0; // 대조: 최소 한쪽은 실 데이터 존재
  const wbOk = results['waiting_board'].exactCount !== 0 || Number(t0.wb) === 0; // 무접촉: 데이터 있으면 read 유지되어야
  console.log(`  SEAL anon-차단 실효 : ${sealOk ? 'PASS' : 'FAIL'} (services=${results.services.exactCount}, package_tiers=${results.package_tiers.exactCount})`);
  console.log(`  대조(빈테이블 아님) : ${contrastOk ? 'OK' : 'WARN(둘다 0행 — 차단/공백 구분 불가)'}`);
  console.log(`  waiting_board 무접촉 : ${wbOk ? 'PASS' : 'FAIL(공개 대기현황판 회귀!)'}`);
  console.log(`  checklists(HOLD)     : anon_count=${results.checklists.exactCount} (본 티켓 미봉쇄 — 참고)`);
  if (!(sealOk && wbOk)) { console.log('\n❌ POSTCHECK FAIL'); process.exit(1); }
  console.log('\n✅ POSTCHECK PASS');
})();
