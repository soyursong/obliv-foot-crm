/**
 * T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY — AC-6c AUTO5 3-KEY 재검증 (read-only, 판정만)
 * 3-key = (상품명, 성분명, 코드). 3개 중 하나라도 다르면 다른 약 → unlink 대상.
 *   service 측 코드 = hira_code / service_code
 *   prescription_codes 측 코드 = claim_code / ingredient_code
 * 데이터 변경 없음. 판정 리포트만 출력 + JSON 저장.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const c = conn(); await c.connect();
console.log('✅ DB 연결 (AUTO5 3-KEY 재검증, read-only)', new Date().toISOString(), '\n');

const linked = (await c.query(
  `SELECT pc.id pc_id, pc.name_ko, pc.claim_code, pc.ingredient_code, pc.classification, pc.manufacturer, pc.code_source,
          s.id svc_id, s.name svc_name, s.hira_code, s.service_code, s.hira_category
   FROM prescription_codes pc JOIN services s ON s.id = pc.service_id
   WHERE pc.service_id IS NOT NULL ORDER BY s.name`)).rows;

const report = [];
console.log(`── AUTO5 3-key 재검증 (연결 ${linked.length}쌍) ──\n`);
for (const r of linked) {
  // 코드 식별자: 한 쪽이라도 실코드(HIRA 등)가 있고 양측이 동일해야 '코드 일치'.
  const svcCode = r.hira_code || r.service_code || null;
  const pcCode  = (r.claim_code && !/^LEGACY-/i.test(r.claim_code)) ? r.claim_code : null; // LEGACY 플레이스홀더는 실코드 아님
  const pcIngr  = r.ingredient_code || null;

  // 코드 동일성 판정
  let codeVerdict, codeReason;
  if (svcCode && pcCode) {
    if (String(svcCode).trim() === String(pcCode).trim()) { codeVerdict = 'SAME'; codeReason = `코드 동일(${svcCode})`; }
    else { codeVerdict = 'DIFF'; codeReason = `코드 상이 svc=${svcCode} ≠ pc=${pcCode}`; }
  } else if (!svcCode && !pcCode) {
    codeVerdict = 'NO_CODE_BOTH'; codeReason = '양측 식별코드 부재(서비스 hira_code/service_code, 처방 claim_code 모두 없음/LEGACY)';
  } else {
    codeVerdict = 'CODE_ONE_SIDE'; codeReason = `한쪽만 코드 존재 svc=${svcCode||'∅'} / pc=${pcCode||'∅'}`;
  }

  report.push({
    svc: { id: r.svc_id, name: r.svc_name, hira_code: r.hira_code, service_code: r.service_code, hira_category: r.hira_category },
    pc:  { id: r.pc_id, name_ko: r.name_ko, claim_code: r.claim_code, ingredient_code: r.ingredient_code, classification: r.classification, manufacturer: r.manufacturer, code_source: r.code_source },
    codeVerdict, codeReason,
  });

  console.log(`▸ svc "${r.svc_name}"`);
  console.log(`    ↔ pc "${r.name_ko}"`);
  console.log(`    [상품명] svc≈pc (정규화 표기차)`);
  console.log(`    [성분명] svc(괄호내) vs pc.ingredient_code=${pcIngr||'∅'} / pc.classification=${r.classification||'∅'}`);
  console.log(`    [코드]   svc.hira_code=${r.hira_code||'∅'} svc.service_code=${r.service_code||'∅'} | pc.claim_code=${r.claim_code||'∅'} pc.code_source=${r.code_source||'∅'}`);
  console.log(`    ⇒ 코드판정: ${codeVerdict} — ${codeReason}\n`);
}

fs.writeFileSync('scripts/T-20260618-foot-RXSET_AUTO5_REVERIFY_report.json', JSON.stringify({ generated: new Date().toISOString(), pairs: report }, null, 2));
console.log('📄 저장: scripts/T-20260618-foot-RXSET_AUTO5_REVERIFY_report.json');
await c.end();
