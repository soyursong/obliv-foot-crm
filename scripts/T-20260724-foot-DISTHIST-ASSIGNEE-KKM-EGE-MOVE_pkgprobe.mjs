/**
 * T-20260724-foot-DISTHIST-ASSIGNEE-KKM-EGE-MOVE — AC8 잔존 정정 PROBE (READ-ONLY)
 * packages.consultant_id 강경민 잔존 1건(김종민 pkg aa11252f) 정정 전 결정적-링크 프로브.
 * DA-20260724-foot-PKG-CONSULTANT-ID-KKM-RESIDUE §실행지침 1:
 *   check_ins.package_id = aa11252f AND consultant_id = 엄경은 실재 확인 → 있으면 (a)엄경은, 없으면 (b)NULL.
 * WRITE 0. 분기 근거 evidence 스냅샷.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const KKM = '6ab26d9f-fd10-4042-9fd7-076f277be5d4'; // 강경민
const EGE = 'b311593d-9e46-4ac8-9424-6b0fa1689a06'; // 엄경은
const tag = (v) => v === KKM ? '★강경민' : v === EGE ? '엄경은' : (v || 'NULL');

// 1) pkg aa11252f 전체 컬럼 (김종민 고객 packages 전수 → prefix 매칭으로 단일행 확정)
const KIMJONGMIN_CUST = '9669f2c4-a490-41f8-885b-dc89ca54b46b';
const { data: allPkgs, error: pkgErr } = await supabase.from('packages')
  .select('*').eq('customer_id', KIMJONGMIN_CUST);
if (pkgErr) { console.log('packages err:', pkgErr.message); process.exit(1); }
const pkgs = (allPkgs ?? []).filter((p) => p.id.startsWith('aa11252f'));
console.log(`=== 김종민 packages 총 ${(allPkgs ?? []).length}건, aa11252f prefix 매칭: ${pkgs.length}건 ===`);
if (!pkgs?.length) { console.log('대상 없음 — abort'); process.exit(1); }
if (pkgs.length !== 1) { console.log('★ 1행 아님 — abort'); process.exit(1); }
const pkg = pkgs[0];
console.log('packages 컬럼:', Object.keys(pkg).join(', '));
console.log('\n=== pkg 현재 상태 ===');
console.log('id            :', pkg.id);
console.log('customer_id   :', pkg.customer_id);
console.log('consultant_id :', tag(pkg.consultant_id), `(raw=${pkg.consultant_id})`);
if ('consultant_name' in pkg) console.log('consultant_name:', pkg.consultant_name, '← paired 스냅샷 컬럼 존재');
else console.log('consultant_name: (컬럼 없음)');
console.log('status        :', pkg.status);
console.log('created_at    :', pkg.created_at);

// 고객 이름 확인 (김종민 기대)
const { data: cust } = await supabase.from('customers')
  .select('id, name, chart_number').eq('id', pkg.customer_id).maybeSingle();
console.log('\n=== 고객 ===');
console.log(`${cust?.name} (chart=${cust?.chart_number}) id=${cust?.id}`);

// 2) 결정적-링크 프로브: check_ins.package_id = <pkg.id> AND consultant_id = 엄경은
// check_ins 에 package_id 컬럼 존재 여부부터 확인
const { data: ciSample, error: ciSampleErr } = await supabase.from('check_ins')
  .select('*').limit(1);
const ciCols = ciSample?.length ? Object.keys(ciSample[0]) : [];
const hasPkgCol = ciCols.includes('package_id');
console.log('\n=== check_ins.package_id 컬럼 존재? ===', hasPkgCol);

let linkRows = [];
if (hasPkgCol) {
  const { data: link, error: linkErr } = await supabase.from('check_ins')
    .select('id, customer_name, consultant_id, package_id, status, checked_in_at')
    .eq('package_id', pkg.id);
  if (linkErr) console.log('link err:', linkErr.message);
  linkRows = link ?? [];
  console.log(`check_ins WHERE package_id=${pkg.id}: ${linkRows.length}건`);
  for (const r of linkRows) {
    console.log(`  ci=${r.id.slice(0,8)} ${r.customer_name} consultant=${tag(r.consultant_id)} status=${r.status}`);
  }
}

// 3) 보조 근거: 이 고객의 check_ins 전체 (package_id 결선 없을 때 판단 보조)
const { data: custCis } = await supabase.from('check_ins')
  .select('id, customer_name, consultant_id, status, checked_in_at' + (hasPkgCol ? ', package_id' : ''))
  .eq('customer_id', pkg.customer_id).order('checked_in_at', { ascending: true });
console.log(`\n=== 이 고객 check_ins 전체 (${(custCis ?? []).length}건) ===`);
for (const r of custCis ?? []) {
  console.log(`  ci=${r.id.slice(0,8)} consultant=${tag(r.consultant_id)} pkg=${hasPkgCol ? (r.package_id ? r.package_id.slice(0,8) : 'NULL') : 'n/a'} status=${r.status} at=${r.checked_in_at}`);
}

// 4) 원장 무접점 확인 — payments / package_payments 에 이 pkg/consultant 흔적
const { data: payProbe, error: payErr } = await supabase.from('payments').select('*').limit(1);
const payCols = payProbe?.length ? Object.keys(payProbe[0]) : [];
console.log('\n=== payments 컬럼 (원장 무접점 확인용) ===', payCols.join(', ') || `(0행/${payErr?.message ?? ''})`);
const { data: ppProbe, error: ppErr } = await supabase.from('package_payments').select('*').limit(1);
const ppCols = ppProbe?.length ? Object.keys(ppProbe[0]) : [];
console.log('=== package_payments 컬럼 ===', ppCols.join(', ') || `(0행/${ppErr?.message ?? ''})`);

// 5) 분기 판정
const linkToEge = linkRows.filter((r) => r.consultant_id === EGE);
console.log('\n========== 분기 판정 ==========');
console.log('결정적 링크 (check_ins.package_id=pkg AND consultant_id=엄경은):', linkToEge.length, '건');
if (linkToEge.length >= 1) {
  console.log('→ (a) 엄경은 백필 (결정적 fact 링크 확인)');
} else {
  console.log('→ (b) NULL revert (결정적 링크 없음 / package_id 결선 부재 → heuristic-launder 금지)');
}
console.log('현재 consultant_id 강경민?', pkg.consultant_id === KKM);
