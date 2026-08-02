/**
 * T-20260802-foot-ST-ROOMID-FILL — 잔여 백필 DRY-RUN (READ-ONLY)
 *
 * ⚠ SELECT/시뮬레이션만. write/UPDATE 0. status_transitions.room_id 미변경(non-persistence).
 *   본 마이그(20260802170000_..._remainder.sql)의 freeze 로직을 inline SELECT 로 재현 →
 *   백필이 무엇을 채울지 사전 증거화 + archive-first(freeze-set JSON 덤프 = 롤백 근거).
 *
 * 실행: node supabase/migrations/20260802170000_foot_status_transitions_room_id_backfill_remainder.dryrun.mjs
 * 산출:
 *   ① freeze-set — 백필이 채울 (st_id → assigned_room) : 건수 + to_status/60일window별 분포
 *   ② 잔차 NULL(귀속불가) — 룸수반 전이인데 매칭 room log 부재 → NULL 유지(계측)
 *   ③ 정합: freeze + 잔차 == 대상 룸수반 NULL 전이 전체
 *   + non-persistence pre/post-probe(room_id NOT NULL 카운트·서명 불변)
 *   + archive-first: freeze-set 을 db-gate/..._freeze_archive.json 으로 저장(롤백 근거).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const ENV = '/Users/domas/GitHub/obliv-foot-crm/.env.local';
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 오블리브의원 서울오리진점 (foot active)
const ROOM_STATUSES = "('consultation','preconditioning','laser','heated_laser','examination')";
const ARCHIVE = '/Users/domas/GitHub/obliv-foot-crm/db-gate/T-20260802-foot-ST-ROOMID-FILL_freeze_archive.json';

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

// freeze-set(마이그 본문과 동일 로직, inline SELECT = 무영속). st_id → 채울 assigned_room.
// all-time(60일 window 없음) = 기존 백필 커버 밖 older 잔여 포함.
const FREEZE_SQL = `
  SELECT st.id AS st_id, st.to_status, st.transitioned_at,
         (st.transitioned_at >= now() - interval '60 days') AS within_60d,
         m.assigned_room
  FROM status_transitions st
  JOIN LATERAL (
    SELECT r.assigned_room
    FROM check_in_room_logs r
    WHERE r.check_in_id = st.check_in_id
      AND r.room_type = CASE st.to_status
            WHEN 'consultation'    THEN 'consultation'
            WHEN 'preconditioning' THEN 'treatment'
            WHEN 'laser'           THEN 'laser'
            WHEN 'heated_laser'    THEN 'laser'
            WHEN 'examination'     THEN 'examination'
          END
      AND ABS(EXTRACT(EPOCH FROM (r.logged_at - st.transitioned_at))) <= 300
    ORDER BY ABS(EXTRACT(EPOCH FROM (r.logged_at - st.transitioned_at))) ASC, r.logged_at ASC, r.id ASC
    LIMIT 1
  ) m ON true
  WHERE st.clinic_id='${CLINIC}'
    AND st.room_id IS NULL
    AND st.to_status IN ${ROOM_STATUSES}
  ORDER BY st.transitioned_at;
`;

// 대상 룸수반 NULL 전이 전체(잔차 포함) — 정합 대조 분모.
const TOTAL_SQL = `
  SELECT COUNT(*)::int AS total_room_null
  FROM status_transitions st
  WHERE st.clinic_id='${CLINIC}'
    AND st.room_id IS NULL
    AND st.to_status IN ${ROOM_STATUSES};
`;

// non-persistence probe: room_id 상태 서명(룸수반 전이 대상 범위, all-time).
const PROBE_SQL = `
  SELECT COUNT(*) FILTER (WHERE room_id IS NOT NULL)::int AS non_null_cnt,
         COUNT(*)::int AS total_cnt,
         COALESCE(md5(string_agg(id::text || ':' || COALESCE(room_id,'∅'), ',' ORDER BY id)),'∅') AS sig
  FROM status_transitions
  WHERE clinic_id='${CLINIC}'
    AND to_status IN ${ROOM_STATUSES};
`;

console.log('════════════════════════════════════════════════════════════════');
console.log(' DRY-RUN: status_transitions.room_id 잔여 백필 (all-time, check_in_room_logs 소급)');
console.log(' clinic:', CLINIC, '· window: all-time(60일 커버 밖 포함)');
console.log('════════════════════════════════════════════════════════════════');

const pre = (await q(PROBE_SQL))[0];
console.log(`\n[pre-probe] 룸수반 전이 ${pre.total_cnt}건 中 room_id NOT NULL = ${pre.non_null_cnt}건 · sig=${pre.sig.slice(0, 12)}…`);

const freeze = await q(FREEZE_SQL);
const total = (await q(TOTAL_SQL))[0];
const residual = Number(total.total_room_null) - freeze.length;

// to_status 별 + 60일 window 별 분포
const dist = {};
let older = 0, within = 0;
for (const r of freeze) {
  dist[r.to_status] = (dist[r.to_status] || 0) + 1;
  if (r.within_60d) within++; else older++;
}
console.log('\n──── ① freeze-set — 백필이 채울 (st_id → assigned_room) ────');
console.log(`  대상 룸수반 NULL 전이 전체 : ${total.total_room_null}건`);
console.log(`  fill(매칭 room log 존재)   : ${freeze.length}건  (older_than_60d=${older} · within_60d=${within})`);
console.log(`  잔차 NULL(귀속불가)        : ${residual}건  (매칭 log 부재 → NULL 유지·계측)`);
console.log('  to_status별 fill 분포:');
for (const [k, v] of Object.entries(dist)) console.log(`    - ${k}: ${v}건`);
console.log('  샘플(최대 10):');
for (const r of freeze.slice(0, 10)) console.log(`    - ${r.st_id.slice(0, 8)} | ${r.to_status} | room=${r.assigned_room} | ${r.transitioned_at} | ${r.within_60d ? 'within60d' : 'older'}`);

// archive-first: freeze-set 을 evidence JSON 으로 덤프(롤백 근거 = 정확 id-set + 값).
mkdirSync(dirname(ARCHIVE), { recursive: true });
writeFileSync(ARCHIVE, JSON.stringify({
  ticket: 'T-20260802-foot-ST-ROOMID-FILL',
  clinic: CLINIC, window: 'all-time',
  captured_at_utc: new Date().toISOString(),
  freeze_count: freeze.length,
  total_room_null: Number(total.total_room_null),
  residual_null: residual,
  older_than_60d: older, within_60d: within,
  dist,
  rows: freeze.map((r) => ({ st_id: r.st_id, to_status: r.to_status, assigned_room: r.assigned_room })),
}, null, 2));
console.log(`\n[archive-first] freeze-set ${freeze.length}건 → ${ARCHIVE}`);

const post = (await q(PROBE_SQL))[0];
const noWrite = pre.non_null_cnt === post.non_null_cnt && pre.sig === post.sig;
console.log(`[post-probe] room_id NOT NULL = ${post.non_null_cnt}건 · sig=${post.sig.slice(0, 12)}…`);
console.log('[non-persistence]', noWrite ? '✅ room_id 무변경(dry-run write 0)' : '❌ 변경됨(HAZARD)');

const consistent = freeze.length + residual === Number(total.total_room_null);
console.log(`\n  정합: fill(${freeze.length}) + 잔차(${residual}) == 대상전체(${total.total_room_null}) → ${consistent ? '✅' : '❌'}`);
console.log('════════════════════════════════════════════════════════════════');
console.log(consistent && noWrite
  ? ' 결과: 백필 준비 OK — freeze 정합 + 무영속 + archive-first 확인 ✅ (supervisor dry-run 게이트 후 apply)'
  : ' 결과: ⚠ 정합/무영속 이상 → planner·supervisor flag');
console.log('════════════════════════════════════════════════════════════════');
