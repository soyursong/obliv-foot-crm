/**
 * T-20260727-foot-CHOI-PK-LOGIN-BLOCKED — VERDICT(b) 조치
 * 최필경(pk.choi@medibuilder.com) auth/profile 모두 정상 → 비밀번호 재설정 링크 발급.
 * admin.generateLink(type=recovery): 이메일 발송 없이 1회용 복구 링크만 생성(비파괴).
 * ★평문 비밀번호 미생성 — 재설정 링크 방식.
 * 발급 직전 id↔email 재검증(Identity Resolution 표준) 후에만 링크 생성.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const TARGET_EMAIL = 'pk.choi@medibuilder.com';
const TARGET_ID = 'd9bde8a8-887b-4c98-845e-fcc85d6d25af';
const REDIRECT_TO = 'https://obliv-foot-crm.pages.dev/login';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  // 발급 직전 id↔email 재검증 (변경/발급 직전 재검증 의무)
  const { data: byId, error: e0 } = await supabase.auth.admin.getUserById(TARGET_ID);
  if (e0) throw new Error('getUserById 실패: ' + e0.message);
  const email = byId?.user?.email;
  if (!email || email.toLowerCase() !== TARGET_EMAIL.toLowerCase()) {
    throw new Error(`id↔email 재검증 실패: id=${TARGET_ID} email=${email} — 발급 중단`);
  }
  console.log('[재검증 OK] id↔email 일치:', TARGET_ID, email);

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email: TARGET_EMAIL,
    options: { redirectTo: REDIRECT_TO },
  });
  if (error) throw new Error('generateLink 실패: ' + error.message);

  const p = data?.properties || {};
  console.log('\n=== 복구 링크 발급 완료 (비파괴) ===');
  console.log('action_link:', p.action_link);
  console.log('email_otp(참고):', p.email_otp);
  console.log('verification_type:', p.verification_type);
  console.log('redirect_to:', REDIRECT_TO);
  console.log('\n(주의: action_link 는 1회용. 만료 전 최필경 본인에게만 비공개 전달.)');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
