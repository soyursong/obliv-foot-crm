/**
 * T-20260725-foot-MEDIREC-ROOMCAPTURE-FIELD-CONFIRM — 백필 ROLLBACK
 *
 * archive JSON(backfill_freeze_archive.json)의 정확 id-set 만 room_id → NULL 복원.
 *   백필분(과거 전이)만 대상 — 캡처가 채운 신규 전이는 archive 에 없어 무접촉.
 *   안전 가드: 현재 값이 백필한 값과 동일할 때만 NULL (그 사이 수동 변경분 보호).
 * 실행: node supabase/migrations/20260730120000_foot_status_transitions_room_id_backfill.rollback.mjs
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

const arch = JSON.parse(readFileSync(ARCHIVE, 'utf8'));
if (arch.rows.length === 0) { console.log('archive 비어있음 — 롤백 no-op'); process.exit(0); }
const values = arch.rows.map((r) => `('${r.st_id}'::uuid, '${String(r.assigned_room).replace(/'/g, "''")}')`).join(',');
const res = await q(`
  WITH v(id, room) AS (VALUES ${values})
  UPDATE status_transitions st SET room_id = NULL
  FROM v WHERE st.id = v.id AND st.room_id = v.room
  RETURNING st.id;`);
console.log(`[ROLLBACK] archive ${arch.rows.length}건 中 ${res.length}건 room_id → NULL 복원 완료.`);
