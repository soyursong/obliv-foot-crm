/**
 * T-20260606-foot-RX-DRUG-WHITELIST — AC-0 READ-ONLY 그라운딩 (SELECT만, write 0)
 *
 * 목적: 진료차트 처방 약 출처를 prescription_codes(EDI 전체) → services 처방약(16건)으로
 *   제한할 때의 영향 실증.
 *   1. services 처방약(category_label='처방약', active=true) 건수 + prescription_codes FK/매핑 여부
 *   2. services 처방약 ↔ prescription_codes 매칭 가능성(service_code=claim_code / name 일치)
 *      → 매칭되면 prescription_code_id 보존 가능(금기/급여/role 게이트 유지) = Option C
 *      → 안 되면 null화(게이트 skip) = Option A
 *   3. prescription_contraindications 등록 건수(금기 게이트 영향)
 *   4. prescription_codes.insurance_status 차단상태 건수(급여 게이트 영향)
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const norm = (s) => (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, '');

async function main() {
  // 1. services 처방약
  const { data: svc, error: svcErr } = await sb
    .from('services')
    .select('id,name,service_code,category_label,active')
    .eq('category_label', '처방약')
    .eq('active', true);
  if (svcErr) throw svcErr;
  console.log(`\n=== 1. services 처방약(active) = ${svc.length}건 ===`);
  for (const s of svc) console.log(`  [${s.id}] ${s.name} | service_code=${s.service_code ?? 'NULL'}`);

  // 2. prescription_codes 전체 로드해서 매칭 시도
  const pc = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('prescription_codes')
      .select('id,name_ko,claim_code,code_source,insurance_status')
      .range(from, from + 999);
    if (error) throw error;
    pc.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`\n=== 2. prescription_codes 총 ${pc.length}건. services 처방약 매칭 시도 ===`);
  const pcByCode = new Map();
  const pcByName = new Map();
  for (const p of pc) {
    if (p.claim_code) pcByCode.set(norm(p.claim_code), p);
    if (p.name_ko) pcByName.set(norm(p.name_ko), p);
  }
  let codeMatch = 0, nameMatch = 0, noMatch = 0;
  for (const s of svc) {
    const byCode = s.service_code ? pcByCode.get(norm(s.service_code)) : null;
    const byName = pcByName.get(norm(s.name));
    const hit = byCode || byName;
    if (byCode) codeMatch++;
    else if (byName) nameMatch++;
    else noMatch++;
    console.log(
      `  ${s.name}: code매칭=${byCode ? `Y(pc.id=${byCode.id})` : 'N'} name매칭=${byName ? `Y(pc.id=${byName.id})` : 'N'} → ${hit ? 'MAPPABLE' : 'NO-MAP'}`,
    );
  }
  console.log(`  요약: service_code=claim_code 매칭 ${codeMatch} / name 매칭 ${nameMatch} / 매칭불가 ${noMatch}`);

  // 3. 금기 등록 건수
  const { data: contras, error: cErr } = await sb
    .from('prescription_contraindications')
    .select('id,prescription_code_id');
  if (cErr) throw cErr;
  const contraCodeIds = new Set(contras.map((c) => `${c.prescription_code_id}`));
  console.log(`\n=== 3. 금기(prescription_contraindications) = ${contras.length}건, distinct code ${contraCodeIds.size} ===`);

  // 4. 급여 차단상태
  const blocked = pc.filter((p) => ['non_covered', 'deleted', 'criteria_changed'].includes((p.insurance_status ?? '').trim()));
  console.log(`\n=== 4. 급여 차단상태 prescription_codes = ${blocked.length}건 ===`);

  // 5. 종합 판정 힌트
  console.log(`\n=== 종합 ===`);
  console.log(`  services 처방약 ${svc.length}건 중 prescription_codes 매핑가능 ${codeMatch + nameMatch}건 / 불가 ${noMatch}건`);
  console.log(`  → 매핑가능률 ${svc.length ? Math.round((codeMatch + nameMatch) / svc.length * 100) : 0}%`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
