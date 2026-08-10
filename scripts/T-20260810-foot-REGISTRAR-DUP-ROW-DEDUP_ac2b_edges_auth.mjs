/**
 * AC-2b SURVIVOR CENSUS phase-2 (auth live-login + reference-edge 계수) — READ-ONLY
 * T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP
 *
 *   phase-1(A0b)에서 확정한 35 inbound FK 전수를 기계 열거해 4 staff id 참조 무게를 계수.
 *   + auth.users(user_id) last_sign_in_at 로 DA-dispositive "live-login" 축 확정.
 *   ⚠ SELECT only. WRITE0/DDL0/DML0.
 */
import { q } from './dryrun_lib.mjs';
import { writeFileSync } from 'node:fs';

const IDS = [
  '4bcf55a2-4472-48ac-86a1-fca4b576ac21', // 강다연 08-08 (user_id NULL)
  '0ff81a68-9696-4a3a-b7ce-38973e37ee36', // 강다연 08-10 (auth 08a68143)
  '9a429fb7-699b-4647-94da-c2ec1e61b3c9', // 이진석 08-08 (user_id NULL)
  '884b4571-fbfb-4aa7-871c-f555dc296956', // 이진석 08-10 (auth 7a5c7012)
];
const IDLIST = IDS.map((s) => `'${s}'`).join(',');
const AUTH_UIDS = ["08a68143-400d-4bc7-a2e1-c4c742b7c589", "7a5c7012-a328-4670-86fe-4f34d582a325"];

function assertReadOnly(sql) {
  const forbidden = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i;
  const stripped = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (forbidden.test(stripped)) throw new Error(`READ-ONLY 위반: ${sql.slice(0, 80)}`);
}

// 35 inbound FK (table, col) — phase-1 A0b 결과에서 기계 추출 (손열거 금지 원칙: FK 정의 그대로)
const EDGES = [
  ['assignment_actions', 'to_staff_id'], ['assignment_actions', 'from_staff_id'],
  ['attendance_audit', 'staff_id'], ['attendance_device', 'staff_id'],
  ['attendance_otp', 'staff_id'], ['attendance_punch', 'staff_id'],
  ['check_in_services', 'seller_staff_id'], ['check_ins', 'assigned_counselor_id'],
  ['check_ins', 'consultant_id'], ['check_ins', 'therapist_id'], ['check_ins', 'technician_id'],
  ['clinic_doctors', 'staff_id'], ['clinic_events', 'created_by'],
  ['customers', 'assigned_staff_id'], ['customers', 'assigned_consultant_id'],
  ['customers', 'designated_therapist_id'], ['daily_room_status', 'disabled_by'],
  ['duty_roster', 'doctor_id'], ['form_submissions', 'issued_by'],
  ['health_maintenance_balances', 'verified_by'], ['health_q_tokens', 'created_by'],
  ['insurance_documents', 'issued_by'], ['monthly_sales_targets', 'updated_by'],
  ['notices', 'created_by'], ['package_sessions', 'deleted_by'],
  ['package_sessions', 'performed_by'], ['packages', 'consultant_id'],
  ['prescriptions', 'prescribed_by'], ['reservation_memo_history', 'created_by'],
  ['reservation_registrars', 'staff_id'], ['reservations', 'preferred_therapist_id'],
  ['room_assignments', 'staff_id'], ['staff_attendance', 'staff_id'],
  ['staff_temp_off', 'staff_id'], ['therapist_capabilities', 'staff_id'],
];

// 하나의 UNION ALL 로 전 edge 를 staff id 별 계수
const unions = EDGES.map(([t, c]) =>
  `SELECT '${t}' AS child_table, '${c}' AS child_col, ${c}::text AS sid, count(*) AS n
   FROM public.${t} WHERE ${c} IN (${IDLIST}) GROUP BY ${c}`
).join('\nUNION ALL\n');

const edgeSql = `WITH edges AS (\n${unions}\n)
  SELECT child_table, child_col, sid, n FROM edges ORDER BY sid, child_table, child_col;`;

const authSql = `SELECT id, email, last_sign_in_at, created_at, email_confirmed_at,
                        raw_user_meta_data->>'name' AS meta_name
                 FROM auth.users WHERE id IN ('${AUTH_UIDS[0]}','${AUTH_UIDS[1]}');`;

const out = { note: 'READ-ONLY phase-2', ref: 'rxlomoozakkjesdqjtvd', results: {} };

for (const [k, sql] of [['A3_edges', edgeSql], ['A2_auth', authSql]]) {
  assertReadOnly(sql);
  try {
    const rows = await q(sql);
    out.results[k] = { ok: true, rows };
    console.log(`\n── ${k} (${rows.length} rows)`);
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    out.results[k] = { ok: false, error: String(e).slice(0, 400) };
    console.error(`\n✗ ${k}: ${e}`);
  }
}

// per-staff edge 합계 롤업
if (out.results.A3_edges?.ok) {
  const roll = {};
  for (const r of out.results.A3_edges.rows) { roll[r.sid] = (roll[r.sid] || 0) + Number(r.n); }
  out.edge_totals = roll;
  console.log('\n── edge_totals(참조 무게):', JSON.stringify(roll, null, 2));
}

writeFileSync('scripts/out/T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP_ac2b_edges_auth.json',
  JSON.stringify(out, null, 2));
console.log('\n✅ written ac2b_edges_auth.json');
