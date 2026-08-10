// READ-ONLY: F-4445 identity resolution. WRITE 0 · DDL 0 · void 0. Management API SELECT only.
// PHI-safe: query by chart_number + customer_id UUID (§4.3 UUID-PK-only). Run from repo root.
import { q } from './dryrun_lib.mjs';
const out = (l, r) => { console.log(`\n===== ${l} =====`); console.log(JSON.stringify(r, null, 2)); };
const F4445 = '66c08e48-c708-4e50-963d-aaa56b27d9ea';   // chart F-4445
const PARK  = '1c61bad2-ad49-4e7d-92ae-2d132aae95cb';   // roster chart F-4790

out('1_resolve_F4445', await q(`SELECT id AS customer_id, chart_number, clinic_id, is_test, created_at
  FROM customers WHERE chart_number ~ '4445';`));
out('2_roster_probe', await q(`SELECT id AS customer_id, chart_number, is_test, created_at
  FROM customers WHERE id IN ('${F4445}','${PARK}');`));
for (const t of ['reservations','check_ins','payments','package_payments','service_charges','form_submissions','medical_charts','packages','notification_logs'])
  out(`F4445_${t}`, await q(`SELECT count(*) n FROM ${t} WHERE customer_id='${F4445}';`).catch(e=>({skip:1})));
out('F4445_cis', await q(`SELECT cis.id, cis.service_name, cis.is_package_session, cis.package_session_id, cis.voided_at
  FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id WHERE ci.customer_id='${F4445}';`));
out('BABSENT34_total', await q(`SELECT count(*) n FROM check_in_services
  WHERE is_package_session=true AND package_session_id IS NULL AND voided_at IS NULL;`));
out('BABSENT34_by_target', await q(`SELECT ci.customer_id, count(*) orphan_rows
  FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
  WHERE cis.is_package_session=true AND cis.package_session_id IS NULL AND cis.voided_at IS NULL
    AND ci.customer_id IN ('${F4445}','${PARK}') GROUP BY 1;`));
