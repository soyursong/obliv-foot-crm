/**
 * T-20260724-foot-DISTHIST-ASSIGNEE-KKM-EGE-MOVE — FORENSIC (READ-ONLY)
 * freeze 결과: 8 check_ins.consultant_id 가 이미 엄경은. 강경민(배분이력)이 어디에 남았는지 전수 추적.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const KKM = '6ab26d9f-fd10-4042-9fd7-076f277be5d4'; // 강경민
const EGE = 'b311593d-9e46-4ac8-9424-6b0fa1689a06'; // 엄경은
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const CIS = [
  { name: '엄상욱', ci: '976e2667-7d75-4c09-95e2-b6faa7d3a14d', cust: 'fd9417a3-ccaf-4323-a595-04204f6ee32a' },
  { name: '김종민', ci: 'c391f00b-c3ba-4860-9d15-d4a7f03bba0f', cust: '9669f2c4-a490-41f8-885b-dc89ca54b46b' },
  { name: '오정길', ci: '378e528e-1d2f-4d6e-9eea-a2147ef05643', cust: '95089fba-96a0-4226-b33c-065e82595626' },
  { name: '이민태', ci: '87411a19-6d65-4ea3-98bf-9b38348b2607', cust: '5659dad8-c486-465f-a842-a0f41dbd478c' },
  { name: '최강선', ci: '87426961-d3f0-4a4d-bae3-b5da9ee3c7ce', cust: 'c2df98b9-ebdc-413b-b40c-ee8ce023290f' },
  { name: '백영호', ci: '9b0daa11-f720-4719-afa2-61565f1b1613', cust: '106ecb06-168c-458b-aa11-9b77c83c0a06' },
  { name: '이재성', ci: '2f6b0e7c-0e75-4ec9-a508-c3ef0bee0c1c', cust: 'cbd71b52-6be8-432b-984e-1ee7599a4b0f' },
  { name: '이멋진', ci: 'e05cce94-5cc8-4c85-8f34-3355fd7c710c', cust: '8c525a72-0254-4d43-bb8d-d4d7388f3e3a' },
];
const ciIds = CIS.map((x) => x.ci);
const custIds = CIS.map((x) => x.cust);

// 1) check_ins 전체 컬럼 (therapist_id 포함 강경민 흔적)
const { data: cis } = await supabase.from('check_ins')
  .select('id, customer_name, consultant_id, therapist_id, status').in('id', ciIds);
console.log('=== check_ins (consultant/therapist) ===');
for (const c of cis ?? []) {
  console.log(`${c.customer_name}: ci=${c.id} consultant=${c.consultant_id === KKM ? '★강경민' : c.consultant_id === EGE ? '엄경은' : c.consultant_id} therapist=${c.therapist_id === KKM ? '★강경민' : c.therapist_id}`);
}

// 2) assignment_actions 전체 (이 8 check_in) — 강경민 흔적 추적
const { data: acts } = await supabase.from('assignment_actions')
  .select('*').in('check_in_id', ciIds).order('created_at', { ascending: true });
console.log(`\n=== assignment_actions (${(acts ?? []).length}건) ===`);
for (const a of acts ?? []) {
  const tag = (v) => v === KKM ? '★강경민' : v === EGE ? '엄경은' : (v || '-');
  console.log(`ci=${a.check_in_id.slice(0,8)} ${a.action_type}/${a.role} from=${tag(a.from_staff_id)} to=${tag(a.to_staff_id)} reason=${a.reason ?? '-'} at=${a.created_at}`);
}

// 3) customers 기본 담당 축
const { data: custs } = await supabase.from('customers')
  .select('id, name, assigned_consultant_id, assigned_counselor_id, designated_therapist_id').in('id', custIds);
console.log('\n=== customers (default 담당 축) ===');
for (const c of custs ?? []) {
  const tag = (v) => v === KKM ? '★강경민' : v === EGE ? '엄경은' : (v || '-');
  console.log(`${c.name}: assigned_consultant=${tag(c.assigned_consultant_id)} counselor=${tag(c.assigned_counselor_id)} designated_ther=${tag(c.designated_therapist_id)}`);
}

// 4) packages.consultant_id
const { data: pkgs } = await supabase.from('packages')
  .select('id, customer_id, consultant_id, created_at, status').in('customer_id', custIds);
console.log(`\n=== packages (${(pkgs ?? []).length}건) ===`);
for (const p of pkgs ?? []) {
  console.log(`cust=${p.customer_id.slice(0,8)} pkg=${p.id.slice(0,8)} consultant=${p.consultant_id === KKM ? '★강경민' : p.consultant_id === EGE ? '엄경은' : (p.consultant_id||'NULL')} status=${p.status} at=${p.created_at}`);
}

// 5) payments 이 8 check_in / 고객 — consultant_id 컬럼 존재 여부 탐지
const { data: pays, error: payErr } = await supabase.from('payments')
  .select('*').in('check_in_id', ciIds).limit(3);
console.log(`\n=== payments (probe, check_in_id in 8) — 컬럼 확인 ===`);
if (payErr) console.log('payments err:', payErr.message);
else if ((pays ?? []).length) console.log('payments 컬럼:', Object.keys(pays[0]).join(', '));
else console.log('payments 0건 (check_in_id 결선). customer_id 축으로 재확인 필요.');

// 6) 강경민 id 가 등장하는 임의 흔적: status_transitions changed_by 등은 스킵. 요약.
console.log('\n=== 요약: 8건 중 강경민 흔적 위치 ===');
console.log('consultant_id=강경민:', (cis ?? []).filter((c) => c.consultant_id === KKM).length);
console.log('therapist_id=강경민:', (cis ?? []).filter((c) => c.therapist_id === KKM).length);
console.log('assignment_actions to=강경민:', (acts ?? []).filter((a) => a.to_staff_id === KKM).length);
console.log('assignment_actions from=강경민:', (acts ?? []).filter((a) => a.from_staff_id === KKM).length);
console.log('customers.assigned_consultant=강경민:', (custs ?? []).filter((c) => c.assigned_consultant_id === KKM).length);
console.log('customers.assigned_counselor=강경민:', (custs ?? []).filter((c) => c.assigned_counselor_id === KKM).length);
console.log('packages.consultant_id=강경민:', (pkgs ?? []).filter((p) => p.consultant_id === KKM).length);
