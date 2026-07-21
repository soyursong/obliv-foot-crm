#!/usr/bin/env node
/**
 * §2 복구 실증(READ-ONLY): 라이브 covered 체크아웃에서 스냅샷이 만들어질 근거 확인.
 *  - general/foreigner 등급 + covered 서비스 → calc_copayment data_incomplete=false (지속가능 = 스냅샷 INSERT됨)
 *  - unverified(NULL grade) + hira_score NULL covered → data_incomplete=true (스냅샷 skip = 금액 날조 금지, 설계대로)
 */
import { q } from './dryrun_lib.mjs';
const P = async (l, sql) => {
  try { const r = await q(sql); console.log(`\n=== ${l} ===\n` + JSON.stringify(r, null, 2)); }
  catch (e) { console.log(`\n=== ${l} ERR ===\n` + (e.message || e)); }
};
const CLINIC = "(SELECT id FROM clinics WHERE name LIKE '%송도%' LIMIT 1)";
const SVC = "(SELECT id FROM services WHERE is_insurance_covered AND name LIKE '%초진진찰료%' LIMIT 1)";
await P('general_covered',
  `SELECT c.* FROM calc_copayment(${SVC}, (SELECT id FROM customers WHERE insurance_grade='general' LIMIT 1), ${CLINIC}, CURRENT_DATE) c;`);
await P('foreigner_covered',
  `SELECT c.* FROM calc_copayment(${SVC}, (SELECT id FROM customers WHERE insurance_grade='foreigner' LIMIT 1), ${CLINIC}, CURRENT_DATE) c;`);
await P('nullgrade_covered',
  `SELECT c.* FROM calc_copayment(${SVC}, (SELECT id FROM customers WHERE insurance_grade IS NULL LIMIT 1), ${CLINIC}, CURRENT_DATE) c;`);
