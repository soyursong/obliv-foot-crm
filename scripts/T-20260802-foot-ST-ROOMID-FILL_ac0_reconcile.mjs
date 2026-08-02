/**
 * T-20260802-foot-ST-ROOMID-FILL — AC0 leg 정합 reconcile (READ-ONLY, write0)
 *
 * 목적: CONFLICT-DETAIL(REDEFINITION_RISK) 해소 — 실쿼리로 판정.
 *   가설 A(별개 leg): check_ins.room_id 캡처(99.9%) ≠ status_transitions.room_id 전이스냅샷(45% NULL)
 *   가설 B(동일 leg, 분모차): 둘 다 status_transitions.room_id, 99.9%=룸수반 분모 / 45%NULL=전체 분모
 *
 * 산출: to_status별 NULL 분포 + 룸수반 vs 미수반 분해 + clinic/시간창 분해 →
 *   "45% NULL"이 (설계상 NULL인 미수반 전이) 때문인지, (진짜 귀속가능 잔차)인지 확정.
 *
 * 실행: node scripts/T-20260802-foot-ST-ROOMID-FILL_ac0_reconcile.mjs
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
const ROOM_STATUSES = "('consultation','preconditioning','laser','heated_laser','examination')";

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

const p = (label, rows) => { console.log(`\n── ${label} ──`); console.table(rows); };

(async () => {
  // 0) check_ins 에 room_id 컬럼 실재 여부 (가설 A 성립 가능성 확인)
  const ciCols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='check_ins' AND column_name ILIKE '%room%'
    ORDER BY 1;`);
  p('check_ins room-관련 컬럼 (room_id 실재 여부)', ciCols);

  // 1) status_transitions.room_id 전체 채움률
  const overall = await q(`
    SELECT COUNT(*) AS total,
           COUNT(room_id) AS filled,
           COUNT(*) - COUNT(room_id) AS null_cnt,
           ROUND(100.0*(COUNT(*)-COUNT(room_id))/NULLIF(COUNT(*),0),1) AS null_pct
    FROM status_transitions;`);
  p('status_transitions.room_id 전체 채움률 (45% NULL 검증)', overall);

  // 2) to_status별 NULL 분포 (룸수반/미수반 구분)
  const byStatus = await q(`
    SELECT to_status,
           to_status IN ${ROOM_STATUSES} AS is_room_status,
           COUNT(*) AS total,
           COUNT(*) - COUNT(room_id) AS null_cnt,
           ROUND(100.0*(COUNT(*)-COUNT(room_id))/NULLIF(COUNT(*),0),1) AS null_pct
    FROM status_transitions
    GROUP BY to_status
    ORDER BY is_room_status DESC, null_cnt DESC;`);
  p('to_status별 채움 (룸수반 vs 미수반)', byStatus);

  // 3) 룸수반 vs 미수반 집계 — "45% NULL"이 설계상 NULL(미수반) 때문인지 판정
  const split = await q(`
    SELECT CASE WHEN to_status IN ${ROOM_STATUSES} THEN 'room_accompanying' ELSE 'non_room(설계상NULL)' END AS leg,
           COUNT(*) AS total,
           COUNT(*) - COUNT(room_id) AS null_cnt,
           ROUND(100.0*(COUNT(*)-COUNT(room_id))/NULLIF(COUNT(*),0),1) AS null_pct
    FROM status_transitions
    GROUP BY 1 ORDER BY 1;`);
  p('룸수반 vs 미수반 분해 (핵심 판정)', split);

  // 4) 룸수반 전이 한정 — clinic별 NULL 잔차 (다지점 잔여 확인)
  const byClinic = await q(`
    SELECT clinic_id,
           COUNT(*) AS room_txn_total,
           COUNT(*) - COUNT(room_id) AS null_cnt,
           ROUND(100.0*(COUNT(*)-COUNT(room_id))/NULLIF(COUNT(*),0),1) AS null_pct
    FROM status_transitions
    WHERE to_status IN ${ROOM_STATUSES}
    GROUP BY clinic_id ORDER BY null_cnt DESC;`);
  p('룸수반 전이 clinic별 NULL 잔차 (다지점)', byClinic);

  // 5) 룸수반 NULL 잔차 — 60일 이내/이외 분해 (기존 60일 백필 커버범위 밖 확인)
  const byWindow = await q(`
    SELECT CASE WHEN transitioned_at >= now() - interval '60 days' THEN 'within_60d' ELSE 'older_than_60d' END AS window,
           COUNT(*) AS room_txn_total,
           COUNT(*) - COUNT(room_id) AS null_cnt
    FROM status_transitions
    WHERE to_status IN ${ROOM_STATUSES}
    GROUP BY 1 ORDER BY 1;`);
  p('룸수반 NULL — 60일 window 분해 (기존 백필 커버 밖 잔차)', byWindow);

  // 6) 룸수반 NULL 잔차 중 실제 귀속가능(check_in_room_logs 매칭 존재) 건수 = 진짜 백필 대상
  const attributable = await q(`
    SELECT COUNT(*) AS null_room_txn,
           COUNT(*) FILTER (WHERE has_match) AS attributable,
           COUNT(*) FILTER (WHERE NOT has_match) AS unattributable
    FROM (
      SELECT st.id,
        EXISTS (
          SELECT 1 FROM check_in_room_logs r
          WHERE r.check_in_id = st.check_in_id
            AND r.room_type = CASE st.to_status
                  WHEN 'consultation' THEN 'consultation'
                  WHEN 'preconditioning' THEN 'treatment'
                  WHEN 'laser' THEN 'laser'
                  WHEN 'heated_laser' THEN 'laser'
                  WHEN 'examination' THEN 'examination' END
            AND ABS(EXTRACT(EPOCH FROM (r.logged_at - st.transitioned_at))) <= 300
        ) AS has_match
      FROM status_transitions st
      WHERE st.to_status IN ${ROOM_STATUSES} AND st.room_id IS NULL
    ) x;`);
  p('룸수반 NULL 잔차 — 귀속가능(±5분 room log 매칭) 여부 = 실 백필 대상', attributable);

  console.log('\n[AC0 판정 요약]');
  const o = overall[0], s = split;
  console.log(`  · 전체 NULL%: ${o.null_pct}% (${o.null_cnt}/${o.total})`);
  const roomLeg = s.find(r => r.leg === 'room_accompanying');
  const nonRoomLeg = s.find(r => r.leg.startsWith('non_room'));
  console.log(`  · 룸수반 leg NULL: ${roomLeg?.null_cnt}/${roomLeg?.total} (${roomLeg?.null_pct}%)`);
  console.log(`  · 미수반 leg NULL(설계상): ${nonRoomLeg?.null_cnt}/${nonRoomLeg?.total} (${nonRoomLeg?.null_pct}%)`);
  console.log(`  · check_ins.room_id 컬럼: ${ciCols.some(c=>c.column_name==='room_id') ? '실재' : '부재(가설A 불성립)'}`);
})();
