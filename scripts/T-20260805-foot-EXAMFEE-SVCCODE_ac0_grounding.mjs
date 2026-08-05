/**
 * T-20260805-foot-EXAMFEE-BILLING-SVCCODE-EXPLICIT-LIST — AC-0 READ-ONLY 그라운딩 (SELECT만, write 0)
 *
 * 목적: 명칭 정규식 → service_code 명시목록 교체의 판정 동치(100% 동일) 실증.
 *   ★ getTaxClass !== '급여' → return false (술어 1행 게이트)를 정확히 재현.
 *   두 인증 경로 모두 대조: (a) insuranceGrade=null (라이브 89% 케이스)  (b) grade='general'(+hira_code).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SURCHARGE_CODES = new Set(['AA154', 'AA254', 'AA222']);
const FLAT_CODES      = new Set(['AA154', 'AA254']);
const RX_SURCHARGE = /진찰|상담|초진|재진/;
const RX_FLAT      = /진찰료|상담/;
const COVERED_GRADES = new Set(['general','low_income_1','low_income_2','medical_aid_1','medical_aid_2','infant','elderly_flat']);

// getTaxClass 정밀 재현
function getTaxClass(s, grade) {
  if (grade && COVERED_GRADES.has(grade) && s.hira_code) return '급여';
  if (s.is_insurance_covered) return '급여';
  if (s.vat_type === 'exclusive' || s.vat_type === 'inclusive') return '비급여(과세)';
  return '비급여(면세)';
}
// 술어 재현 (현행 regex / 신규 code)
function curSurch(s, g){ if(getTaxClass(s,g)!=='급여')return false; if(s.hira_category)return s.hira_category==='consultation'; return s.category_label==='기본'&&RX_SURCHARGE.test(s.name??''); }
function curFlat(s, g){ if(getTaxClass(s,g)!=='급여')return false; if(s.hira_category)return s.hira_category==='consultation'; return s.category_label==='기본'&&RX_FLAT.test(s.name??''); }
function newSurch(s, g){ if(getTaxClass(s,g)!=='급여')return false; if(s.hira_category)return s.hira_category==='consultation'; return s.service_code!=null&&SURCHARGE_CODES.has(s.service_code); }
function newFlat(s, g){ if(getTaxClass(s,g)!=='급여')return false; if(s.hira_category)return s.hira_category==='consultation'; return s.service_code!=null&&FLAT_CODES.has(s.service_code); }

async function main() {
  const { data: svc, error } = await sb.from('services')
    .select('id,name,service_code,hira_code,hira_category,hira_score,category_label,is_insurance_covered,vat_type,price,active')
    .order('service_code', { nullsFirst: false });
  if (error) throw error;

  const codesOfInterest = new Set([...SURCHARGE_CODES, ...FLAT_CODES, 'AA155', 'AA157', '050']);
  const cand = svc.filter((s) =>
    s.category_label === '기본' || RX_SURCHARGE.test(s.name ?? '') ||
    (s.service_code && codesOfInterest.has(s.service_code)) || s.hira_category === 'consultation');

  let totalMismatch = 0;
  for (const grade of [null, 'general']) {
    console.log(`\n========== 인증경로 grade=${grade ?? 'null'} (후보 ${cand.length}건) ==========`);
    console.log('code | act | covered? | hira_code | cur(s/f) | new(s/f) | MATCH');
    let mismatch = 0, activeMismatch = 0;
    for (const s of cand) {
      const tax = getTaxClass(s, grade);
      const cs=curSurch(s,grade), cf=curFlat(s,grade), ns=newSurch(s,grade), nf=newFlat(s,grade);
      const ok = cs===ns && cf===nf;
      if (!ok) { mismatch++; if (s.active) activeMismatch++;
        console.log(`${s.service_code??'NULL'} | ${s.active?'A':'x'} | ${tax} | ${s.hira_code??'-'} | (${cs?'T':'F'}/${cf?'T':'F'}) | (${ns?'T':'F'}/${nf?'T':'F'}) | ### DIFF ${s.active?'(ACTIVE!)':'(inactive)'} ### ${s.name}`);
      }
    }
    console.log(`grade=${grade??'null'}: mismatch=${mismatch} (active=${activeMismatch})`);
    totalMismatch += activeMismatch;
  }
  console.log(`\n=== 결론: ACTIVE 행 mismatch 합계 = ${totalMismatch} (0 = 청구영향 회귀 없음) ===`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
