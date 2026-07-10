/**
 * T-20260702-foot-CODY-PKG-CREATE-PERM — DESTRUCTIVE APPLY (계정 영구 삭제)
 * ⚠⚠ 게이트 통과 후에만 실행:
 *    (1) data-architect CONSULT GO
 *    (2) supervisor DB-gate 승인
 * 실행 조건: 환경변수 APPLY_CONFIRM=DA_AND_SUPERVISOR_GO 없으면 즉시 중단.
 *
 * 순서: archive 존재 재확인 → INV-4 id↔email TOCTOU 재검증 → in-txn DELETE+guard → COMMIT → post-verify freeze
 * 산출: db-gate/T-20260702-foot-CODY-PKG-CREATE-PERM_apply_evidence.log
 */
import fs from 'fs';

if (process.env.APPLY_CONFIRM !== 'DA_AND_SUPERVISOR_GO') {
  console.error('⛔ APPLY 차단: APPLY_CONFIRM=DA_AND_SUPERVISOR_GO 필요 (DA CONSULT GO + supervisor DB-gate 후에만).');
  process.exit(3);
}

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const URL = env.VITE_SUPABASE_URL;
const SRK = env.SUPABASE_SERVICE_ROLE_KEY;
const REF = URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)[1];
const TARGET_ID = 'd4c83d20-e8d6-4918-97ce-2cce68d444ae';
const TARGET_EMAIL = 'kyh3858@hanmail.net';
const T = `'${TARGET_ID}'`;

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`SQL → ${r.status} ${await r.text()}`);
  return r.json();
}
const lines = [];
const out = (...a) => { const s = a.join(' '); console.log(s); lines.push(s); };
const fail = (msg) => { out('❌ ABORT:', msg); fs.writeFileSync('db-gate/T-20260702-foot-CODY-PKG-CREATE-PERM_apply_evidence.log', lines.join('\n') + '\n'); process.exit(2); };

out('═══ T-20260702 계정삭제 APPLY (DESTRUCTIVE, COMMIT) ═══');

// 0) archive 존재 재확인
const archPath = 'rollback/T-20260702-foot-CODY-PKG-CREATE-PERM_archive_20260710.json';
const rbPath = 'rollback/T-20260702-foot-CODY-PKG-CREATE-PERM_rollback_20260710.sql';
if (!fs.existsSync(archPath) || !fs.existsSync(rbPath)) fail('archive/rollback 파일 부재 — archive-first 미충족');
out('  archive 확인:', archPath, '+', rbPath, '✅');

// 1) INV-4 TOCTOU 재검증 (destructive 직전 getUserById + DB 재조회)
const r = await fetch(`${URL}/auth/v1/admin/users/${TARGET_ID}`, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
if (!r.ok) fail(`getUserById HTTP ${r.status}`);
const u = await r.json();
if (u.id !== TARGET_ID || (u.email || '').trim().toLowerCase() !== TARGET_EMAIL) fail(`INV-4 불일치: id=${u.id} email=${u.email}`);
out('  INV-4 getUserById 재검증: id↔email 일치 ✅');
const dbchk = await sql(`SELECT count(*)::int AS n FROM auth.users WHERE id=${T} AND lower(trim(email))='${TARGET_EMAIL}';`);
if (dbchk[0].n !== 1) fail(`DB id+email 재검증 ≠ 1행 (${dbchk[0].n})`);
out('  DB id+email 재검증: 1행 ✅');

// 2) in-txn DELETE + guard + COMMIT (delete.sql 과 동일 로직)
const res = await sql(`BEGIN;
DO $$ DECLARE up int; au int; BEGIN
  SELECT count(*) INTO up FROM public.user_profiles WHERE id=${T};
  SELECT count(*) INTO au FROM auth.users WHERE id=${T} AND lower(trim(email))='${TARGET_EMAIL}';
  IF up<>1 OR au<>1 THEN RAISE EXCEPTION 'PRE-GUARD FAIL up=% au=%', up, au; END IF;
END $$;
DELETE FROM public.user_profiles WHERE id=${T};
DELETE FROM auth.users WHERE id=${T};
DO $$ DECLARE up int; au int; idc int; ott int; BEGIN
  SELECT count(*) INTO up FROM public.user_profiles WHERE id=${T};
  SELECT count(*) INTO au FROM auth.users WHERE id=${T};
  SELECT count(*) INTO idc FROM auth.identities WHERE user_id=${T};
  SELECT count(*) INTO ott FROM auth.one_time_tokens WHERE user_id=${T};
  IF up<>0 OR au<>0 OR idc<>0 OR ott<>0 THEN RAISE EXCEPTION 'POST-GUARD FAIL up=% au=% id=% ott=%', up, au, idc, ott; END IF;
END $$;
COMMIT;
SELECT
  (SELECT count(*)::int FROM public.user_profiles) AS up_total,
  (SELECT count(*)::int FROM auth.users) AS au_total,
  (SELECT count(*)::int FROM public.user_profiles WHERE id=${T}) AS up_target,
  (SELECT count(*)::int FROM auth.users WHERE id=${T}) AS au_target;`).catch(e => fail('DELETE TX 예외: ' + e.message));

const R = res[0];
out('\n[POST-COMMIT 검증]');
out('  user_profiles(target) =', R.up_target, '(기대 0)');
out('  auth.users(target)    =', R.au_target, '(기대 0)');
out('  user_profiles TOTAL   =', R.up_total, '(기대 46, baseline 47 - 1)');
out('  auth.users TOTAL      =', R.au_total, '(기대 46, baseline 47 - 1)');
const ok = R.up_target === 0 && R.au_target === 0 && R.up_total === 46 && R.au_total === 46;
out('\n═══ APPLY 결과:', ok ? '✅ 삭제 완료 (post-count=0, freeze diff=1)' : '❌ 검증 실패 — 조사 요망', '═══');
fs.writeFileSync('db-gate/T-20260702-foot-CODY-PKG-CREATE-PERM_apply_evidence.log', lines.join('\n') + '\n');
if (!ok) process.exit(2);
