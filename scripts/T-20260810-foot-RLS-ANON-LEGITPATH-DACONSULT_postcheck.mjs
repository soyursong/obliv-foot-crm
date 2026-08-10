/**
 * POSTCHECK (C5 — anon 세션 실효 + SECDEF RPC 회귀0 실측): T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT
 * ─────────────────────────────────────────────────────────────────────────────
 * apply(GO-token 게이트) 이후 실행. 실제 anon-key REST 세션으로 PostgREST 를 때려
 * checklists 직접 anon read+write 가 실효로 차단됐는지 + 셀프체크인 SECDEF RPC write 경로
 * 무회귀 + HOLD(waiting_board) 무접촉을 실측한다.
 *
 * 기대(apply 후):
 *   · checklists  anon SELECT       → 0 rows (RESTRICTIVE checklists_anon_read_deny 실효; 테이블은 service_role 로 조회)
 *   · checklists  anon INSERT(직접)  → 차단(RLS violation / 401·403) + 미영속(service_role 재-count 불변)
 *   · SECDEF fn_complete_prescreen_checklist anon RPC(비존재 check_in_id)
 *                                    → 200 + {success:false, error:'check_in_not_found'} (anon EXECUTE 보존·RLS-immune·zero-write) = 회귀0
 *   · SECDEF 구조 : has_function_privilege('anon', EXECUTE)=t · prosecdef=t · owner=postgres (C1 무접촉)
 *   · waiting_board anon SELECT      → 여전히 정상 read (HOLD·무접촉 회귀 가드 — 공개 대기현황판 보존)
 *
 * ⚠ zero-write 보장: (a)직접 INSERT 는 RLS 로 거부되어 미영속. (b)SECDEF RPC 는 존재하지 않는
 *    check_in_id → 함수 line 103-105 에서 'check_in_not_found' 즉시 RETURN(INSERT 미도달) → PHI write 0.
 *
 * 실행: (repo root) node scripts/T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT_postcheck.mjs
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
const RANDOM_ABSENT_CHECKIN = '00000000-0000-0000-0000-0000000000ff'; // 존재하지 않는 check_in → INSERT 미도달

async function anonSelect(table) {
  const r = await fetch(`${URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, Prefer: 'count=exact' },
  });
  const body = await r.text();
  let rows = -1;
  const cr = r.headers.get('content-range');
  if (cr) { const m = cr.match(/\/(\d+|\*)$/); rows = m && m[1] !== '*' ? Number(m[1]) : (cr.startsWith('*/') ? 0 : rows); }
  return { status: r.status, contentRange: cr, exactCount: rows, sample: body.slice(0, 160) };
}

async function anonDirectInsert() {
  // 직접 anon .from('checklists').insert 시도 — RESTRICTIVE checklists_anon_write_deny 로 거부 기대.
  const r = await fetch(`${URL}/rest/v1/checklists`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      clinic_id: '00000000-0000-0000-0000-000000000000',
      check_in_id: '00000000-0000-0000-0000-000000000000',
      checklist_data: { _postcheck_probe: true },
    }),
  });
  return { status: r.status, sample: (await r.text()).slice(0, 200) };
}

async function anonSecdefRpc() {
  // 셀프체크인 SECDEF RPC — 존재하지 않는 check_in → zero-write. anon EXECUTE 보존 시 200 + check_in_not_found.
  const r = await fetch(`${URL}/rest/v1/rpc/fn_complete_prescreen_checklist`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_check_in_id: RANDOM_ABSENT_CHECKIN, p_checklist_data: {} }),
  });
  return { status: r.status, sample: (await r.text()).slice(0, 200) };
}

(async () => {
  console.log('== POSTCHECK C5 anon-key REST 실효 + SECDEF 회귀0 실측 ==', new Date().toISOString(), '\n');

  const before = await q(`SELECT
      (SELECT count(*) FROM public.checklists) chk,
      (SELECT count(*) FROM public.waiting_board) wb`);
  console.log('[service_role totals · before]', JSON.stringify(before[0]));

  const secdef = await q(`SELECT p.prosecdef, pg_get_userbyid(p.proowner) owner,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='fn_complete_prescreen_checklist'`);
  console.log('[SECDEF 구조 · C1]', JSON.stringify(secdef[0]), '\n');

  console.log('── SEAL: checklists 직접 anon read+write 차단 실효 ──');
  const read = await anonSelect('checklists');
  console.log(`  READ  checklists  status=${read.status} anon_count=${read.exactCount} (range=${read.contentRange})`);
  const ins = await anonDirectInsert();
  console.log(`  WRITE checklists  status=${ins.status} body=${ins.sample}`);

  console.log('\n── SECDEF 셀프체크인 RPC 회귀0 (anon EXECUTE·RLS-immune·zero-write) ──');
  const rpc = await anonSecdefRpc();
  console.log(`  RPC   fn_complete_prescreen_checklist  status=${rpc.status} body=${rpc.sample}`);

  console.log('\n── HOLD 무접촉 회귀 가드 ──');
  const wb = await anonSelect('waiting_board');
  console.log(`  READ  waiting_board  status=${wb.status} anon_count=${wb.exactCount} (range=${wb.contentRange})`);

  const after = await q(`SELECT (SELECT count(*) FROM public.checklists) chk`);
  console.log(`\n[service_role checklists · after]=${after[0].chk} (before=${before[0].chk} — 미영속 확인)`);

  // ── 판정 ──
  console.log('\n── 판정 ──');
  const s = secdef[0];
  const readSealed  = read.exactCount === 0;                         // anon read 0행 = 차단 실효
  const writeSealed = ins.status === 401 || ins.status === 403 || /row-level security|42501|permission denied/i.test(ins.sample);
  const notPersist  = Number(after[0].chk) === Number(before[0].chk);// 미영속
  const secdefOk    = s.prosecdef === true && s.owner === 'postgres' && s.anon_exec === true;
  const rpcReachable = rpc.status === 200 && /check_in_not_found/.test(rpc.sample); // anon EXECUTE 보존 + zero-write
  const wbUntouched = wb.exactCount !== 0 || Number(before[0].wb) === 0;

  console.log(`  READ 봉쇄 실효     : ${readSealed ? 'PASS' : 'FAIL'} (anon checklists=${read.exactCount}, service_role total=${before[0].chk})`);
  console.log(`  WRITE 봉쇄 실효    : ${writeSealed ? 'PASS' : 'FAIL'} (직접 anon INSERT status=${ins.status})`);
  console.log(`  미영속(no-write)   : ${notPersist ? 'PASS' : 'FAIL'} (checklists ${before[0].chk}→${after[0].chk})`);
  console.log(`  C1 SECDEF 구조 보존: ${secdefOk ? 'PASS' : 'FAIL'} (prosecdef=${s.prosecdef}, owner=${s.owner}, anon_exec=${s.anon_exec})`);
  console.log(`  SECDEF RPC 회귀0   : ${rpcReachable ? 'PASS' : 'FAIL'} (anon RPC status=${rpc.status}, check_in_not_found=${/check_in_not_found/.test(rpc.sample)})`);
  console.log(`  waiting_board 무접촉: ${wbUntouched ? 'PASS' : 'FAIL'}`);

  const ok = readSealed && writeSealed && notPersist && secdefOk && rpcReachable && wbUntouched;
  if (!ok) { console.log('\n❌ POSTCHECK FAIL'); process.exit(1); }
  console.log('\n✅ POSTCHECK PASS (checklists anon read+write 봉쇄 실효 · SECDEF 셀프체크인 회귀0 · HOLD 무접촉)');
})();
