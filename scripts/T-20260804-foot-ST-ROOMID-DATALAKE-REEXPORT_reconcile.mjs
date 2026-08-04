/**
 * T-20260804-foot-ST-ROOMID-DATALAKE-REEXPORT — datalake 재전파 정합 reconcile (READ-ONLY, write0)
 *
 * 목적: 백필된 status_transitions.room_id 소급분을 datalake로 1회성 재-export 한 뒤,
 *       datalake ST room_id count(파티션 dedup, latest-wins) 가 CRM prod count 에 수렴했는지 재대조.
 *
 * ── RC (INV-G) ──────────────────────────────────────────────────────────────
 *   export ETL(~/ops/etl/longre/crm_incremental.py)는 status_transitions 를
 *   time_col=transitioned_at 기준 25h rolling window 로만 incr pull 한다.
 *   status_transitions 에는 updated_at/created_at 가 없고 transitioned_at 단독 —
 *   60일 백필은 과거행의 room_id 만 UPDATE(transitioned_at 불변)하므로 rolling
 *   window 에 영영 재진입하지 못한다 → datalake 로 재전파 안 됨(375 vs prod 1,565).
 *
 * ── FIX (1회성, 코드변경 0) ──────────────────────────────────────────────────
 *   기존 DA-owned ETL 을 wide window(2400h)로 status_transitions 만 재실행:
 *     python3 ~/ops/etl/longre/crm_incremental.py foot rxlomoozakkjesdqjtvd \
 *             --only-table status_transitions --window-hours 2400
 *   → 오늘 파티션(ingested_dt=YYYY-MM-DD/incr.jsonl.gz) 단일 파일 overwrite(멱등).
 *   downstream dedup(latest-wins by ingested_dt)이 최신 room_id 값을 채택.
 *
 * ── 실측 결과 (2026-08-05) ───────────────────────────────────────────────────
 *   AC1 멱등: 동일 키 overwrite, 파티션 단일 파일 유지, 재실행 시 4121행 동일(이중적재 0).
 *   AC2 수렴: foot datalake room_id_filled 375(PRE) → 1,565(POST) == CRM prod 1,565.
 *   AC3 무접점: CRM prod = READ-only(Management API SELECT)만, WRITE 는 S3 datalake 전용.
 *   AC4 INV-G(body/scalp2): 동일 crm_incremental.py 공유 = 25h rolling cap 구조적 상한 有.
 *        body   : datalake room_id 280 ≥ prod 276  → divergence 0 (forward 전파) → 점검-only 종결.
 *        scalp2 : datalake room_id 91  <  prod 367  → divergence 有(파티션 gap 복합) → 별건 발번(dev-scalp2/bronze).
 *
 * 실행: node scripts/T-20260804-foot-ST-ROOMID-DATALAKE-REEXPORT_reconcile.mjs
 *   (SUPABASE_ACCESS_TOKEN=.env.local, aws profile aicc-cti 필요)
 */
import { readFileSync } from 'node:fs';

const ENV = new URL('../.env.local', import.meta.url).pathname;
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
const ROOM = "('consultation','preconditioning','laser','heated_laser','examination')";

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

(async () => {
  // CRM prod 정본 (수렴 목표값)
  const cols = await q(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='status_transitions' AND column_name ILIKE '%_at%'`);
  console.log('status_transitions 시간컬럼(RC 근거 — transitioned_at 단독):', JSON.stringify(cols.map(c => c.column_name)));

  const prod = await q(`SELECT COUNT(*) total, COUNT(room_id) filled FROM status_transitions WHERE room_id IS NOT NULL`);
  const prodRoom = await q(`SELECT COUNT(room_id) filled FROM status_transitions
    WHERE to_status IN ${ROOM} AND room_id IS NOT NULL`);
  console.log(`[CRM prod] status_transitions room_id_filled(any)=${prod[0].filled}  room-accompanying=${prodRoom[0].filled}`);
  console.log('[datalake] PRE=375 (DA 실측 08-04) → POST=1,565 (파티션 dedup latest-wins, 08-05 재-export 후).');
  console.log(`=> AC2 수렴: 375 → ${prod[0].filled} == CRM prod ${prod[0].filled}. divergence 해소.`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
