/**
 * T-20260710-foot-RRN-REGISTER-ERR-ISSUE-FROMCHART2 — AC1 진단 (READ-ONLY)
 * 목적: 주민번호 "등록 시 반복 에러"의 RC가 T-20260706 RRN 키 로테이션 컷오버 갭과
 *       동일 축인지 판별. FE 저장동선(saveRrn→confirmRrnSaved)은 encrypt 성공 후
 *       rrn_decrypt 재조회로 영속 자가검증 → 13자리 아니면 error toast.
 *       v2(신키) 암호화행을 구키로 복호 시 NULL → 자가검증 실패 → "저장되지 않았습니다" 반복.
 * 쓰기 없음: rrn_encrypt 미호출. SELECT + rrn_decrypt(read) 만.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// .env.local 로드 (VITE_SUPABASE_URL + SERVICE_ROLE)
for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.+)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const URL = process.env.VITE_SUPABASE_URL || 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error('❌ SUPABASE_SERVICE_ROLE_KEY 필요'); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// (1) rrn_encryption_version 분포 (rrn_enc 보유행 한정)
const { data: rows, error } = await sb
  .from('customers')
  .select('id, rrn_encryption_version, created_at, rrn_enc')
  .not('rrn_enc', 'is', null);
if (error) { console.error('customers 조회 실패:', error); process.exit(1); }

const byVer = {};
for (const r of rows) {
  const v = r.rrn_encryption_version ?? 'null';
  byVer[v] = (byVer[v] || 0) + 1;
}
console.log('=== (1) rrn_enc 보유행 버전 분포 ===');
console.log('총 RRN 보유행:', rows.length);
console.log(JSON.stringify(byVer, null, 2));

// 06-29 이후 신규(라이브 성장 갭) 버전 확인
const since = rows.filter(r => r.created_at >= '2026-06-29');
const sinceByVer = {};
for (const r of since) { const v = r.rrn_encryption_version ?? 'null'; sinceByVer[v] = (sinceByVer[v] || 0) + 1; }
console.log('\n2026-06-29 이후 생성 + RRN보유:', since.length, '버전분포:', JSON.stringify(sinceByVer));

// (2) 복호 자가검증 재현: v1 / v2 샘플별 rrn_decrypt 결과 (13자리 여부 = FE 영속판정)
const v1 = rows.filter(r => (r.rrn_encryption_version ?? 1) === 1).slice(0, 3);
const v2 = rows.filter(r => r.rrn_encryption_version === 2).slice(0, 5);
console.log('\n=== (2) rrn_decrypt 자가검증 재현 (FE confirmRrnSaved 등가) ===');
async function probe(label, sample) {
  for (const r of sample) {
    const { data, error } = await sb.rpc('rrn_decrypt', { customer_uuid: r.id });
    const digits = data ? String(data).replace(/\D/g, '') : '';
    const persisted = digits.length === 13; // FE 판정식과 동일
    console.log(`  [${label}] ver=${r.rrn_encryption_version ?? 1} decrypt.len=${digits.length} ` +
      `→ FE판정: ${persisted ? '영속OK(에러없음)' : '영속실패→"저장되지않았습니다" 토스트'}` +
      (error ? ` (rpc err: ${error.message})` : ''));
  }
}
await probe('v1', v1);
await probe('v2', v2);

console.log('\n=== 판정 ===');
console.log('v2행 decrypt가 NULL/13자리미만이면 → 등록 자가검증 실패 → 등록 반복에러 = T-20260706 컷오버 갭과 동일 축.');
