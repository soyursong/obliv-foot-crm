/**
 * T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — §9.1 이름 완전일치 재실행 (READ-ONLY)
 *
 * 방법(§9 정본): custom 19종 약'이름' 기반으로 official 499건에서 이름 완전일치 약을 찾는다.
 *   - 성분/이름 다른 약 교체 절대금지 (성분만 같아도 이름 다르면 매칭 아님).
 *   - 매칭분 = 급여/비급여(insurance_status)로 분류.
 *   - 미매칭 = 강제매칭 금지 → 별도 목록.
 *
 * 매칭 정의(엄격, 다단계로 투명 보고):
 *   brand = custom name_ko 에서 (성분괄호)·용량·제형토큰 제거한 '상품명 코어'
 *   official 도 동일 정규화 후 비교.
 *   L1 EXACT      : 정규화 전체 문자열 완전일치
 *   L2 BRAND_EXACT : 상품명 코어가 official 상품명 코어와 완전일치
 *   L3 BRAND_PREFIX: official 상품명 코어가 custom 상품명 코어로 시작 (용량/제형만 다른 동일상품) — 참고용
 *   그 외          : 미매칭(NONE) → 별도 목록
 *
 * *** SELECT only / 적용 0건 ***
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 용량/제형/포장 토큰 + 괄호 안 성분/용량 제거 → 상품명 코어
const DOSAGE_RE = /\d+(\.\d+)?\s*(밀리그램|마이크로그램|그램|밀리리터|mg|㎎|mcg|㎍|ml|㎖|g|정|캡슐|연질캡슐|cc|단위|iu|%|％)?/gi;
function norm(s) {
  return (s || '')
    .replace(/\([^)]*\)/g, '')   // (성분) (용량) 괄호 제거
    .replace(/\[[^\]]*\]/g, '')  // [성분] 제거
    .replace(/_.*$/, '')          // _(...) 뒤 제거
    .replace(DOSAGE_RE, '')       // 용량 토큰 제거
    .replace(/\s+/g, '')          // 공백 제거
    .trim();
}
// 상품명 코어: norm 후에도 제형 접미어(크림/연고/외용액/정/캡슐/시럽 등)까지 떼서 브랜드만
const FORM_SUFFIX = /(외용액|점안액|크림|연고|로션|겔|시럽|현탁액|주사액|주사|산|정|캡슐|연질캡슐|좌제|패취|패치|점적|액)$/;
function brand(s) {
  let b = norm(s);
  // 제형 접미어 1회 제거(상품명 끝에 붙은 경우)
  b = b.replace(FORM_SUFFIX, '');
  return b;
}

async function main() {
  console.log('=== §9.1 이름 완전일치 재실행 (READ-ONLY) ' + new Date().toISOString() + ' ===\n');
  const { data: all, error } = await sb.from('prescription_codes')
    .select('id,name_ko,claim_code,classification,code_source,insurance_status,insurance_status_source,price_krw');
  if (error) { console.error(error); process.exit(1); }
  const custom = all.filter((r) => r.code_source === 'custom');
  const official = all.filter((r) => r.code_source === 'official');
  console.log(`custom=${custom.length} official=${official.length}\n`);

  // insurance_status distinct
  const insDist = {};
  official.forEach((r) => { const k = String(r.insurance_status); insDist[k] = (insDist[k] || 0) + 1; });
  console.log('official.insurance_status distinct:', JSON.stringify(insDist));
  const insSrc = {};
  official.forEach((r) => { const k = String(r.insurance_status_source); insSrc[k] = (insSrc[k] || 0) + 1; });
  console.log('official.insurance_status_source distinct:', JSON.stringify(insSrc), '\n');

  // official 정규화 인덱스
  const offNorm = official.map((o) => ({ o, n: norm(o.name_ko), b: brand(o.name_ko) }));

  const results = [];
  for (const c of custom) {
    const cn = norm(c.name_ko);
    const cb = brand(c.name_ko);
    const L1 = offNorm.filter((x) => x.n && x.n === cn);
    const L2 = offNorm.filter((x) => x.b && cb && x.b === cb);
    const L3 = offNorm.filter((x) => x.b && cb && (x.b.startsWith(cb) || cb.startsWith(x.b)) && x.b !== cb);
    let level = 'NONE', cands = [];
    if (L1.length) { level = 'L1_EXACT'; cands = L1; }
    else if (L2.length) { level = 'L2_BRAND_EXACT'; cands = L2; }
    else if (L3.length) { level = 'L3_BRAND_PREFIX'; cands = L3; }
    results.push({ c, cn, cb, level, cands });
  }

  const order = { L1_EXACT: 0, L2_BRAND_EXACT: 1, L3_BRAND_PREFIX: 2, NONE: 3 };
  results.sort((a, b) => order[a.level] - order[b.level]);

  console.log('═══ 결과 ═══');
  for (const r of results) {
    console.log(`\n[${r.level}] "${r.c.name_ko}"`);
    console.log(`   현 claim=${r.c.claim_code} | norm="${r.cn}" brand="${r.cb}"`);
    if (!r.cands.length) { console.log('   → 이름일치 official 없음 → 미매칭(별도목록)'); continue; }
    for (const x of r.cands.slice(0, 6)) {
      const ins = x.o.insurance_status ?? '-';
      console.log(`   → "${x.o.name_ko}" claim=${x.o.claim_code} | insurance_status=${ins} | code_id=${x.o.id}`);
    }
  }

  const cnt = {};
  results.forEach((r) => { cnt[r.level] = (cnt[r.level] || 0) + 1; });
  console.log('\n═══ 요약 ═══', JSON.stringify(cnt));
  console.log('L1/L2 = 이름매칭 성립 후보 / L3 = 동일상품 용량차(참고) / NONE = 미매칭(별도목록·강제매칭금지)');
}
main().catch((e) => { console.error(e); process.exit(1); });
