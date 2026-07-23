/**
 * T-20260723-foot-HIRA-SCORE-M0111-LOAD — M0111 hira_score 확정값 적재 (data-correction SOP).
 * 확정값: hira_score = 75.51 (이은상 팀장 U09AT9ARHEF 고시 소정점수, 3중검증). ※HINT 75.52 아님.
 * 타깃 freeze: services id=03189fa2-...-a48a0c, service_code=M0111, active=true 3중조건.
 *   (DA CONSULT의 74967aea 는 jongno-foot CLINIC id — service id 아님. 실 M0111 service = 03189fa2.)
 * 안전: (1) before 스냅샷+freeze 재검증 (2) rows-affected=1 검증(≠1 abort) (3) 롤백값 NULL 보존
 *       (4) DDL 0 · 마이그 미생성 · RPC 무변경. --apply 없으면 DRY-RUN.
 * 사후: calc_copayment(M0111) 공단 0→non-zero + pay-mini grain 대조 → 별도 postverify 스크립트.
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
const NEW_SCORE = '75.51'; // 확정값. 임의 역산·하드코딩 금지 — planner 고시원문 대조 확정.

// 1) before 스냅샷 + freeze 3중 재검증
const before = await q(`
  SELECT id, service_code, name, hira_score, is_insurance_covered, active
  FROM services WHERE id = '${TARGET_ID}';
`);
console.log('BEFORE:', JSON.stringify(before, null, 2));
if (before.length !== 1) { console.error('ABORT: 대상 1건 아님'); process.exit(1); }
const row = before[0];
if (row.service_code !== 'M0111' || row.active !== true) {
  console.error('ABORT: freeze 불일치(code/active)'); process.exit(1);
}
if (row.hira_score !== null) {
  console.log(`NOOP/주의: hira_score 이미 세팅됨(${row.hira_score}) — 예상 NULL 아님. 수동 확인 필요.`);
  if (String(row.hira_score) === NEW_SCORE) { console.log('이미 확정값 = NOOP'); process.exit(0); }
  console.error('ABORT: 기존값이 NULL도 확정값도 아님 — 오염 의심, 수동 판단.'); process.exit(1);
}

console.log('\nROLLBACK SQL:');
console.log(`UPDATE services SET hira_score = NULL WHERE id = '${TARGET_ID}';`);

if (!APPLY) { console.log('\n[DRY-RUN] --apply 없음 → 미실행. 대상/롤백 확인 후 --apply.'); process.exit(0); }

// 2) UPDATE (id + code + hira_score IS NULL 3중 조건 = 멱등·오작동 방지)
const upd = await q(`
  UPDATE services SET hira_score = ${NEW_SCORE}
  WHERE id = '${TARGET_ID}' AND service_code = 'M0111' AND hira_score IS NULL
  RETURNING id, service_code, hira_score;
`);
console.log('\nUPDATED (rows-affected='+upd.length+'):', JSON.stringify(upd, null, 2));
if (upd.length !== 1) { console.error('ABORT: rows-affected ≠ 1 (silent write-failure 의심)'); process.exit(1); }

// 3) after 검증
const after = await q(`SELECT id, service_code, name, hira_score, is_insurance_covered, active FROM services WHERE id = '${TARGET_ID}';`);
console.log('AFTER:', JSON.stringify(after, null, 2));
console.log(String(after[0].hira_score) === NEW_SCORE ? '\n✅ 적용 완료 (hira_score='+after[0].hira_score+')' : '\n❌ 미반영');
