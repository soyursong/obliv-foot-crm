/**
 * T-20260702-dopamine-FOOTRESV-MEMO-REPROBE — 백필(idempotent) + 사후검증
 *
 * 근본원인(런타임 규명): 도파민→풋 예약 실 push 경로 = ingest EF `reservation-ingest-from-dopamine`
 *   (직접 insert). 이 EF 가 memo 를 reservations.memo(deprecated, FE 미read)에만 착지시켜, 7/1 02:00
 *   RPC 재타겟(rmh) 이 실 push 에 무효과 → rmh 공란 → 풋 팝업/hover 공란(둘 다 rmh read).
 * 해소: (1) EF 수정(memo→rmh, reservations.memo 매핑 제거) — 신규 push 착지 교정.
 *        (2) 본 스크립트 = 배포 前 stranded(memo-in-column·no-rmh) 도파민 예약을 rmh 로 backfill.
 * 멱등: uq_rmh_resv_source(reservation_id, source_system) partial unique(WHERE source_system IS NOT NULL)
 *        → ON CONFLICT ... WHERE 술어 명시 필수(supabase-js .upsert 는 술어 미표현). 재실행=no-op/갱신.
 * DDL 0 · 스키마 무변경(source_system 컬럼·인덱스 = 마이그 20260701020000 旣존). read+additive만.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: sql }),
  });
  const b = await r.json(); if (!r.ok) { console.error('ERR', JSON.stringify(b)); process.exit(1); } return b;
}

const BACKFILL = `
INSERT INTO reservation_memo_history (reservation_id, clinic_id, content, created_by_name, source_system)
SELECT r.id, r.clinic_id, btrim(r.memo), '도파민TM', r.source_system
FROM reservations r
WHERE r.source_system='dopamine' AND r.memo IS NOT NULL AND btrim(r.memo)<>''
  AND NOT EXISTS (SELECT 1 FROM reservation_memo_history h WHERE h.reservation_id=r.id AND h.source_system IS NOT NULL)
ON CONFLICT (reservation_id, source_system) WHERE source_system IS NOT NULL DO UPDATE SET content=EXCLUDED.content
RETURNING reservation_id, source_system, left(content,40) content;`;

console.log('[backfill] run(멱등):', JSON.stringify(await q(BACKFILL)));
console.log('[verify] stranded 잔여(0 기대):', JSON.stringify(await q(
  `SELECT count(*) stranded FROM reservations r WHERE r.source_system='dopamine' AND r.memo IS NOT NULL AND btrim(r.memo)<>''
     AND NOT EXISTS (SELECT 1 FROM reservation_memo_history h WHERE h.reservation_id=r.id);`)));
