/**
 * T-20260802-foot-EXAMFEE-AA254-AA222-SEEDSCORE-VERIFY — READ-ONLY 정합 대조
 *
 * 목적: foot prod public.services 의 AA254(재진진찰료)·AA222(재진물리 동일처방)
 *       실측 hira_score 를 body에서 확정·배포된 national canonical 과 대조.
 *       - AA254 canonical = 139.85 (T-20260728-body-EXAMFEE-AA254-SEEDSCORE-CORRECT deployed)
 *       - AA222 canonical =  49.09 (T-20260729-body-EXAMFEE-AA222-SEEDSCORE-CORRECT DA-STAMP deployed)
 *       national-code 단일값 원칙 → body 확정값 = foot 정본.
 *
 * 인증컨텍스트: Supabase Management API /database/query = service_role 등가 (RLS bypass).
 *              anon 0-row wipe 오독 방지 — 본 쿼리는 RLS 미적용 컨텍스트임을 명시.
 *              (cross-CRM 진단 인증컨텍스트 표준 준수)
 *
 * READ-ONLY: SELECT only. 어떤 write 도 하지 않음.
 * author: dev-foot / 2026-08-02
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

const CANON = { AA254: 139.85, AA222: 49.09 };
const CONV = 95.6; // 상대가치점수 → 원 환산 (round_10)
const round10 = (n) => Math.round(n / 10) * 10;

const out = { auth_context: 'management-api /database/query = service_role (RLS bypass, NOT anon)' };

// 0) services 테이블에 hira 관련 컬럼 실재 확인
out.cols = await q(`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='services'
    AND (column_name ILIKE '%hira%' OR column_name ILIKE '%score%' OR column_name='name' OR column_name='code')
  ORDER BY column_name;
`);

// 1) AA254 / AA222 관련 행 전량 조회 (hira_code 매핑 유의 — service_code / hira_code / name 3중 매칭)
//    부모티켓 지문: hira_code=NULL 정식명 행이 canonical 가능성 → name LIKE 도 포함
//    실제 컬럼: service_code, hira_code, name, hira_score, active, is_insurance_covered, clinic_id
out.rows = await q(`
  SELECT id, clinic_id, service_code, hira_code, name, hira_score, hira_category,
         is_insurance_covered, active
  FROM public.services
  WHERE service_code IN ('AA254','AA222')
     OR hira_code IN ('AA254','AA222')
     OR name ILIKE '%재진%'
  ORDER BY COALESCE(hira_code, service_code), name;
`);

console.log(JSON.stringify(out, null, 2));

// 2) 판정 요약
console.log('\n===== 대조 판정 =====');
console.log(`auth_context: ${out.auth_context}`);
for (const [c, canon] of Object.entries(CANON)) {
  const matches = (out.rows || []).filter(
    (r) => r.service_code === c || r.hira_code === c
  );
  if (matches.length === 0) {
    console.log(`[${c}] canonical=${canon} → foot 행 미발견(code/hira_code 매칭 0). name LIKE 결과에서 수동 확인 필요.`);
    continue;
  }
  for (const m of matches) {
    const score = m.hira_score == null ? null : Number(m.hira_score);
    const eq = score === canon;
    const disp = score == null ? 'NULL' : round10(score * CONV).toLocaleString();
    const canonDisp = round10(canon * CONV).toLocaleString();
    console.log(
      `[${c}] id=${m.id} sc=${m.service_code} hira=${m.hira_code} name="${m.name}" active=${m.active} | foot=${score} vs canon=${canon} => ${eq ? 'MATCH ✅ (무정정)' : 'MISMATCH ❌ (정정필요)'} | 표시액 foot=${disp} vs canon=${canonDisp}`
    );
  }
}
