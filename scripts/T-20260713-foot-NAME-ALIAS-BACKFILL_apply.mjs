/**
 * T-20260713-foot-NAME-ALIAS-BACKFILL — per-row apply (GATED)
 *
 * ⛔ 실행 전제 (모두 충족 시에만):
 *   1) 양쪽 가드 prod-LIVE (EF v27 + RPC-UPSERT) — bleed-stop 확정 ✅
 *   2) AC-B3 현장(박민지 TM팀장) 사람 GO 수신
 *   3) 확정 매핑 파일 db-gate/T-20260713-foot-NAME-ALIAS-BACKFILL_confirmed.json 존재
 *      형식: [{ "customer_id": "<uuid>", "current_alias": "<현재값>", "real_name": "<현장확정 본명>", "source": "field|crosscrm" }]
 *   4) rollback capture(_capture.csv) 선행 완료
 *
 * 안전장치 (SOP §2 / §3):
 *   · per-row UPDATE only (단일 count mass UPDATE 절대 금지)
 *   · 멱등 WHERE: name = current_alias (이미 정정됐거나 값이 바뀐 행은 skip = re-contam/경합 방지)
 *   · --dry (기본): count/plan 만, 실 UPDATE 없음.  --apply: 실제 실행.
 *   · 트리거 fn_sync_customer_name 이 reservations/check_ins.customer_name 자동 캐스케이드.
 *   · 복원 불가(real_name 비어있음) 행은 skip → 현장 재입력 대기(AC-B4).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const APPLY = process.argv.includes('--apply');
const MAP_PATH = 'db-gate/T-20260713-foot-NAME-ALIAS-BACKFILL_confirmed.json';
let map;
try { map = JSON.parse(readFileSync(MAP_PATH, 'utf8')); }
catch { console.error(`확정 매핑 파일 없음: ${MAP_PATH} — 현장 GO 후 생성 필요. 중단.`); process.exit(1); }

console.log(`=== NAME-ALIAS-BACKFILL apply (${APPLY ? '★ APPLY ★' : 'DRY-RUN'}) — 대상 ${map.length}행 ===`);
let applied = 0, skipped = 0, deferred = 0;
for (const m of map) {
  if (!m.real_name || !m.real_name.trim()) {
    console.log(`  DEFER ${m.customer_id.slice(0,8)}: real_name 미확정 → 현장 재입력 대기(AC-B4)`); deferred++; continue;
  }
  // 현재값 재확인 (멱등 + 경합 가드)
  const { data: cur, error: ce } = await supabase.from('customers')
    .select('id, name').eq('id', m.customer_id).maybeSingle();
  if (ce) { console.log(`  ERR ${m.customer_id.slice(0,8)}: ${ce.message}`); skipped++; continue; }
  if (!cur) { console.log(`  SKIP ${m.customer_id.slice(0,8)}: row 없음`); skipped++; continue; }
  if (cur.name !== m.current_alias) {
    console.log(`  SKIP ${m.customer_id.slice(0,8)}: 현재값(${cur.name?.length}자)이 예상 별칭과 불일치 → 경합/이미정정. abort-safe skip`); skipped++; continue;
  }
  if (!APPLY) { console.log(`  PLAN ${m.customer_id.slice(0,8)}: name 복원 예정 (별칭 ${cur.name.length}자 → 본명 ${m.real_name.length}자) [${m.source}]`); continue; }
  const { error: ue } = await supabase.from('customers')
    .update({ name: m.real_name }).eq('id', m.customer_id).eq('name', m.current_alias);
  if (ue) { console.log(`  FAIL ${m.customer_id.slice(0,8)}: ${ue.message}`); skipped++; continue; }
  console.log(`  ✅ APPLIED ${m.customer_id.slice(0,8)}: 트리거 캐스케이드로 reservations/check_ins 자동 정상화`); applied++;
}
console.log(`\n결과: applied=${applied} skipped=${skipped} deferred(현장재입력)=${deferred}`);
if (!APPLY) console.log('DRY-RUN — 실 UPDATE 없음. 현장 GO 후 --apply 로 실행.');
