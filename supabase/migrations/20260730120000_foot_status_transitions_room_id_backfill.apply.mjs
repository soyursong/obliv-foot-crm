/**
 * T-20260725-foot-MEDIREC-ROOMCAPTURE-FIELD-CONFIRM — 백필 APPLY (WRITE)
 *
 * 정본 마이그(20260730120000_..._backfill.sql)를 실행 → archive-first freeze-set 대조 검증.
 * 선행: dryrun.mjs 실행(archive JSON 생성 + 무영속·정합 PASS) 필수.
 * 실행: node supabase/migrations/20260730120000_foot_status_transitions_room_id_backfill.apply.mjs
 *
 * 순서: archive 로드 → pre-probe → 정본 .sql 실행(내부 rows-affected==freeze 가드) →
 *       post-verify(archive 각 id 가 정확히 채워졌는지 + in-window NOT NULL 증가분 == freeze) → fill률 리포트.
 */
import { readFileSync } from 'node:fs';
const ENV = '/Users/domas/GitHub/obliv-foot-crm/.env.local';
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DAYS = 60;
const ROOM_STATUSES = "('consultation','preconditioning','laser','heated_laser','examination')";
const DIR = '/Users/domas/GitHub/obliv-foot-crm/supabase/migrations';
const SQL_FILE = `${DIR}/20260730120000_foot_status_transitions_room_id_backfill.sql`;
const ARCHIVE = '/Users/domas/GitHub/obliv-foot-crm/db-gate/T-20260725-foot-MEDIREC-ROOMCAPTURE_freeze_archive.json';

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return t.trim() ? JSON.parse(t) : [];
}
const PROBE = `
  SELECT COUNT(*) FILTER (WHERE room_id IS NOT NULL)::int AS non_null_cnt
  FROM status_transitions
  WHERE clinic_id='${CLINIC}' AND to_status IN ${ROOM_STATUSES}
    AND transitioned_at >= now() - interval '${DAYS} days';`;

const arch = JSON.parse(readFileSync(ARCHIVE, 'utf8'));
console.log('════════════════════════════════════════════════════════════════');
console.log(' APPLY: status_transitions.room_id 60일 백필');
console.log(` archive freeze=${arch.freeze_count} · residual=${arch.residual_null} · total=${arch.total_room_null}`);
console.log('════════════════════════════════════════════════════════════════');

const pre = (await q(PROBE))[0];
console.log(`[pre] in-window room_id NOT NULL = ${pre.non_null_cnt}건`);

// 정본 마이그 실행(내부 freeze + UPDATE + rows-affected==freeze 가드 + COMMIT).
console.log('\n▶ 정본 .sql 실행 중…');
await q(readFileSync(SQL_FILE, 'utf8'));
console.log('  ✅ 마이그 COMMIT (내부 rows-affected==freeze 가드 통과)');

// post-verify ①: archive 각 id 가 정확히 채워졌는지.
if (arch.rows.length > 0) {
  const values = arch.rows.map((r) => `('${r.st_id}'::uuid, '${String(r.assigned_room).replace(/'/g, "''")}')`).join(',');
  const chk = (await q(`
    SELECT
      COUNT(*) FILTER (WHERE st.room_id = v.room)::int AS matched,
      COUNT(*) FILTER (WHERE st.room_id IS DISTINCT FROM v.room)::int AS mismatched
    FROM (VALUES ${values}) v(id, room)
    JOIN status_transitions st ON st.id = v.id;`))[0];
  console.log(`\n[verify①] archive id-set: 정확 채움 ${chk.matched} / 불일치 ${chk.mismatched}`);
  if (Number(chk.mismatched) !== 0 || Number(chk.matched) !== arch.freeze_count) {
    console.log('❌ ABORT: archive 대조 불일치 → rollback.mjs 검토');
    process.exit(1);
  }
}

// post-verify ②: in-window NOT NULL 증가분 == freeze.
const post = (await q(PROBE))[0];
const delta = Number(post.non_null_cnt) - Number(pre.non_null_cnt);
console.log(`[verify②] in-window room_id NOT NULL = ${post.non_null_cnt}건 (증가 ${delta}, 기대 ${arch.freeze_count})`);

const okDelta = delta === arch.freeze_count;
const total = Number(arch.total_room_null);
const fillPct = total > 0 ? ((arch.freeze_count / total) * 100).toFixed(1) : '0.0';
console.log('\n════════════════════════════════════════════════════════════════');
console.log(` 백필 완료: ${arch.freeze_count}건 fill · 잔차NULL(귀속불가) ${arch.residual_null}건`);
console.log(` room_id fill률(대상 룸수반 60일): ${arch.freeze_count}/${total} = ${fillPct}%`);
console.log(` rows-affected==count 검증: ${okDelta ? '✅ PASS' : '❌ FAIL'}`);
console.log('════════════════════════════════════════════════════════════════');
process.exit(okDelta ? 0 : 1);
