/**
 * T-20260617 §9.1 검증 보강 (READ-ONLY)
 * NONE 19/19 결과가 정규화 과잉제거 false-negative 아님을 substring 교차검증.
 * 각 custom 상품명 코어/원문이 official name_ko 어디든 등장하는지 loose 스캔.
 * *** SELECT only ***
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
function strip(s){return (s||'').replace(/\([^)]*\)/g,'').replace(/\[[^\]]*\]/g,'').replace(/_.*$/,'').replace(/\s+/g,'');}
const FORM=/(외용액|점안액|크림|연고|로션|겔|시럽|현탁액|주사액|주사|산|정|캡슐|연질캡슐|좌제|패취|패치|점적|액)$/;
function brand(s){return strip(s).replace(FORM,'');}

async function main(){
  const {data:all}=await sb.from('prescription_codes').select('name_ko,claim_code,code_source,price_krw,classification');
  const custom=all.filter(r=>r.code_source==='custom');
  const official=all.filter(r=>r.code_source==='official');
  console.log('=== substring 교차검증 (false-negative 방지) ===\n');
  for(const c of custom){
    const b=brand(c.name_ko);
    // official name 안에 brand 코어가 부분문자열로라도 등장?
    const hits=official.filter(o=>b && o.name_ko && o.name_ko.replace(/\s+/g,'').includes(b));
    // 역방향: custom 코어가 너무 짧지 않은 경우만 의미
    console.log(`"${c.name_ko}" brand="${b}" → official substring hits: ${hits.length}` + (hits.length?'  ['+hits.slice(0,4).map(h=>h.name_ko).join(' | ')+']':''));
  }
  // price_krw 로 급여/비급여 추정 가능한지
  console.log('\n=== official price_krw / classification 분포 (급여여부 근거 탐색) ===');
  const withPrice=official.filter(o=>o.price_krw!=null).length;
  console.log('official with price_krw non-null:', withPrice, '/', official.length);
}
main().catch(e=>{console.error(e);process.exit(1);});
