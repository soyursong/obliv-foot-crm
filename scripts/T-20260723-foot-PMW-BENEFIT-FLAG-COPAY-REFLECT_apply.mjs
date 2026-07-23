/**
 * T-20260723-foot-PMW-BENEFIT-FLAG-COPAY-REFLECT — 급여 flag value-set UPDATE.
 * 실측(probe): AA154/AA254/AA222 = is_insurance_covered TRUE(기설정). M0111(id 03189fa2) = FALSE(미설정).
 * 조치: M0111 만 is_insurance_covered = TRUE 로 세팅(값 세팅, DDL 0). no-DDL·db_change=data-value-set.
 * 안전: (1) before 스냅샷 (2) 대상 freeze(id=03189fa2, code=M0111, active=true 확정) (3) rows-affected 검증
 *       (4) rollback SQL 동봉. --apply 없으면 DRY-RUN(변경 미실행).
 * ⚠ 선결 A: M0111 hira_score=NULL → 명세/EDI/매출 grain 은 전액본인 폴백. pay-mini(price-based split)와 divergence.
 *   본 스크립트는 flag 만 세팅(스코프). hira_score 적재는 별건 데이터정정(planner FOLLOWUP) — 상대가치점수 authoritative 소스 필요.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
const APPLY = process.argv.includes('--apply');
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

const TARGET_ID = '03189fa2-0536-4676-bc5d-ad5283a48a0c';

// 1) before 스냅샷 + freeze 대상 재검증
const before = await q(`
  SELECT id, service_code, name, is_insurance_covered, active
  FROM services WHERE id = '${TARGET_ID}';
`);
console.log('BEFORE:', JSON.stringify(before, null, 2));

if (before.length !== 1) { console.error('ABORT: 대상 1건 아님'); process.exit(1); }
const row = before[0];
if (row.service_code !== 'M0111' || row.active !== true) {
  console.error('ABORT: freeze 불일치(code/active)'); process.exit(1);
}
if (row.is_insurance_covered === true) {
  console.log('NOOP: 이미 TRUE — 변경 불요'); process.exit(0);
}

console.log('\nROLLBACK SQL:');
console.log(`UPDATE services SET is_insurance_covered = false WHERE id = '${TARGET_ID}';`);

if (!APPLY) { console.log('\n[DRY-RUN] --apply 없음 → 미실행. 위 대상/롤백 확인 후 --apply 로 실행.'); process.exit(0); }

// 2) UPDATE (id + code + 현재값 false 3중 조건 = 멱등·오작동 방지)
const upd = await q(`
  UPDATE services SET is_insurance_covered = true
  WHERE id = '${TARGET_ID}' AND service_code = 'M0111' AND is_insurance_covered = false
  RETURNING id, service_code, is_insurance_covered;
`);
console.log('\nUPDATED:', JSON.stringify(upd, null, 2));
if (upd.length !== 1) { console.error('ABORT: rows-affected ≠ 1 (silent write-failure 의심)'); process.exit(1); }

// 3) after 검증
const after = await q(`SELECT id, service_code, name, is_insurance_covered FROM services WHERE id = '${TARGET_ID}';`);
console.log('AFTER:', JSON.stringify(after, null, 2));
console.log(after[0].is_insurance_covered === true ? '\n✅ 적용 완료' : '\n❌ 미반영');
