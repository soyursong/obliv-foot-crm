/** T-20260723-foot-HIRA-SCORE-M0111-LOAD — 사후검증 (read-only).
 *  (A) calc_copayment(M0111) 공단부담 0→non-zero  (B) pay-mini computeFootBilling grain 대조
 *  (C) clinics.hira_unit_value=95.60 정합 재확인. */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const SID='03189fa2-0536-4676-bc5d-ad5283a48a0c';
const CID='74967aea-a60b-4da3-a0e7-9c997a930bc8';
const GEN='17d0d356-f1f9-491b-b8d6-f78ba5ffa2cc';   // general 대표 (BEFORE 캡처와 동일)
const UNV='698f744a-4419-44ac-a954-4ab793c0de20';   // unverified 대표

console.log('=== (A) calc_copayment AFTER (명세 grain) ===');
const g = await q(`SELECT * FROM calc_copayment('${SID}','${GEN}','${CID}');`);
const u = await q(`SELECT * FROM calc_copayment('${SID}','${UNV}','${CID}');`);
console.log('general  :', JSON.stringify(g[0]));
console.log('unverified:', JSON.stringify(u[0]));
console.log(`  → general 공단(covered) BEFORE=0 → AFTER=${g[0].insurance_covered_amount} ${g[0].insurance_covered_amount>0?'✅ non-zero':'❌'}`);

console.log('\n=== (B) pay-mini computeFootBilling grain 대조 (general, 급여 M0111 단일) ===');
// computeFootBilling: coveredTotal = price(7220), copay = FLOOR(coveredTotal*0.30/100)*100, covered = coveredTotal - copay
const price = 7220;
const pmCopay = Math.floor((price*0.30)/100)*100;
const pmCovered = price - pmCopay;
console.log(`  pay-mini(price ${price} 기반): copay=${pmCopay}, 공단(covered)=${pmCovered}`);
console.log(`  명세(hira base ${g[0].base_amount} 기반): copay=${g[0].copayment_amount}, 공단(covered)=${g[0].insurance_covered_amount}`);
const diff = Math.abs(pmCovered - g[0].insurance_covered_amount);
console.log(`  → 공단 divergence: BEFORE(명세0 vs pay-mini${pmCovered}=${pmCovered}) → AFTER 잔차 ${diff}원 (${diff<=1?'✅ 구조적 divergence 제거, 1원 반올림 잔차만':'⚠ '+diff+'원'})`);
console.log(`     (잔차 사유: price ${price} vs ROUND(75.51×95.60)=${g[0].base_amount}, 1원 = 소정점수 반올림 grain 차. 하드코딩 금지 준수.)`);

console.log('\n=== (C) clinics.hira_unit_value 정합 ===');
console.log(JSON.stringify(await q(`SELECT slug, hira_unit_value FROM clinics ORDER BY slug;`)));

console.log('\n=== 최종 타깃 상태 ===');
console.log(JSON.stringify(await q(`SELECT id, service_code, name, price, hira_score, is_insurance_covered, active FROM services WHERE id='${SID}';`),null,2));
