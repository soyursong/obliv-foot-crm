/**
 * T-20260716-foot-DOCFEE-NONPAY-SEAL AC2 — 문지은 원장 개인직인 매핑 (data-only, DDL 0).
 *
 * 슬롯키드 최종 규칙(현장 owner U0ATDB587PV [A], 2026-07-16T13:52):
 *   문지은 원장 서명란({{doctor_seal_html}}) → 개인직인(foot_seal_문지은.png, 7/15 clean asset).
 *   한동훈·김윤기·김상은과 동일 저장구조 = 'documents' bucket seals/{clinic_id}/{uuid}.png +
 *   clinic_doctors.seal_image_url 갱신. 신규 컬럼/테이블/enum 0 → db_change=false 유지.
 *
 * asset SSOT: sibling BODYPORT attachments/foot_seal_문지은.png
 *   (SHA256 19a10f30…c80ee = 7/15 현장 전달 183047_문지은_직인.png 와 byte-identical, 단일 공유·중복제작 0).
 *
 * idempotent: 이미 seal_image_url 이 set 되어 있고 파일이 존재하면 no-op.
 * rollback: node ...apply.mjs --rollback  → seal_image_url = NULL (업로드 파일은 잔존, 무해).
 *
 * dry-run: node ...apply.mjs --dry  → 변경 없이 현 상태만 출력.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const MODE = process.argv.includes('--rollback') ? 'rollback'
  : process.argv.includes('--dry') ? 'dry' : 'apply';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const CLINIC_SLUG = 'jongno-foot';
const DOCTOR_NAME = '문지은';
const ASSET = path.join(os.homedir(),
  'claude-sync/memory/_handoff/ticket_assets/T-20260715-foot-RECEIPT-REPNAME-SEAL-BODYPORT/foot_seal_문지은.png');
const BUCKET = 'documents';

const { data: clinic } = await sb.from('clinics').select('id,slug,name').eq('slug', CLINIC_SLUG).single();
const { data: doc } = await sb.from('clinic_doctors')
  .select('id,name,is_default,seal_image_url').eq('clinic_id', clinic.id).eq('name', DOCTOR_NAME).single();

console.log(`[MODE=${MODE}] clinic=${clinic.slug}(${clinic.id})`);
console.log(`[current] ${doc.name} is_default=${doc.is_default} seal_image_url=${doc.seal_image_url}`);

if (MODE === 'dry') { console.log('[dry] no change.'); process.exit(0); }

if (MODE === 'rollback') {
  const { error } = await sb.from('clinic_doctors').update({ seal_image_url: null }).eq('id', doc.id);
  if (error) throw error;
  console.log(`[rollback] ${doc.name}.seal_image_url → NULL`);
  process.exit(0);
}

// apply — idempotent guard: 이미 유효 경로가 있고 파일이 실존하면 skip.
if (doc.seal_image_url) {
  const { data: existing } = await sb.storage.from(BUCKET).createSignedUrl(doc.seal_image_url, 60);
  if (existing?.signedUrl) { console.log(`[skip] 이미 매핑됨 + 파일 존재: ${doc.seal_image_url}`); process.exit(0); }
  console.log(`[warn] seal_image_url set but file missing → 재업로드: ${doc.seal_image_url}`);
}

const bytes = fs.readFileSync(ASSET);
const objPath = `seals/${clinic.id}/${randomUUID()}.png`;
const { error: upErr } = await sb.storage.from(BUCKET).upload(objPath, bytes, { contentType: 'image/png', upsert: false });
if (upErr) throw upErr;
console.log(`[upload] ${ASSET} (${bytes.length}B) → ${BUCKET}/${objPath}`);

const { error: updErr } = await sb.from('clinic_doctors').update({ seal_image_url: objPath }).eq('id', doc.id);
if (updErr) throw updErr;

// verify
const { data: verify } = await sb.from('clinic_doctors').select('name,seal_image_url').eq('id', doc.id).single();
const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(verify.seal_image_url, 60);
console.log(`[verify] ${verify.name}.seal_image_url = ${verify.seal_image_url}`);
console.log(`[verify] signed URL reachable = ${signed?.signedUrl ? 'YES' : 'NO'}`);
console.log(`[rollback cmd] node scripts/T-20260716-foot-DOCFEE-NONPAY-SEAL_moonjieun_seal_apply.mjs --rollback`);
