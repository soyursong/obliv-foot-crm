/**
 * T-20260522-foot-PENCHART-REFUND-DB
 * T-20260522-foot-PENCHART-FORM-AUDIT
 *
 * form_templates audit fix:
 *   [WARN-1] visit_confirm sort_order 40 → 45 (treat_confirm=40 중복 해소)
 *   [WARN-2] referral_letter sort_order 90 → 96 (pen_chart=90 중복 해소)
 *   [CRIT-1] refund_consent 레코드 신규 INSERT (DB 미등록 정합성 보정)
 *
 * 멱등: UPDATE WHERE sort_order=구값, INSERT ON CONFLICT DO NOTHING
 *
 * 실행: node scripts/apply_20260522060000_form_templates_audit_fix.mjs
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const CLINIC_ID    = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

// ── 사전 검증 ──────────────────────────────────────────────────────────────
const SQL_VERIFY_BEFORE = `
SELECT form_key, sort_order, active
FROM form_templates
WHERE clinic_id = '${CLINIC_ID}'
  AND form_key IN ('visit_confirm', 'referral_letter', 'refund_consent')
ORDER BY sort_order;
`;

// ── [WARN-1] visit_confirm sort_order 40 → 45 ─────────────────────────────
const SQL_WARN1 = `
UPDATE form_templates
SET sort_order = 45
WHERE clinic_id = '${CLINIC_ID}'
  AND form_key   = 'visit_confirm'
  AND sort_order = 40;
`;

// ── [WARN-2] referral_letter sort_order 90 → 96 ───────────────────────────
const SQL_WARN2 = `
UPDATE form_templates
SET sort_order = 96
WHERE clinic_id = '${CLINIC_ID}'
  AND form_key   = 'referral_letter'
  AND sort_order = 90;
`;

// ── [CRIT-1] refund_consent INSERT ────────────────────────────────────────
const SQL_CRIT1 = `
INSERT INTO form_templates (
  clinic_id, category, form_key, name_ko,
  template_path, template_format,
  field_map, requires_signature, required_role, active, sort_order
) VALUES (
  '${CLINIC_ID}',
  'foot-service',
  'refund_consent',
  '환불동의서',
  '/forms/refund_consent.png',
  'png',
  '[]'::jsonb,
  true,
  'admin|manager|coordinator|director',
  true,
  93
)
ON CONFLICT (clinic_id, form_key) DO NOTHING;
`;

// ── 사후 검증 ──────────────────────────────────────────────────────────────
const SQL_VERIFY_AFTER = `
SELECT form_key, sort_order, active, template_format, requires_signature
FROM form_templates
WHERE clinic_id = '${CLINIC_ID}'
  AND form_key IN ('visit_confirm', 'referral_letter', 'refund_consent')
ORDER BY sort_order;
`;

async function runQuery(sql, label) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status} [${label}]: ${text}`);
  }
  return resp.json();
}

async function run() {
  console.log('🚀 T-20260522-foot-PENCHART-REFUND-DB: form_templates audit fix 시작...');
  console.log(`   clinic_id: ${CLINIC_ID}`);

  // ── 사전 확인 ───────────────────────────────────────────────────────────
  console.log('\n[0/4] 사전 상태 확인...');
  const before = await runQuery(SQL_VERIFY_BEFORE, 'verify-before');
  console.log('사전 상태:', JSON.stringify(before, null, 2));

  const hasRefund  = before.some(r => r.form_key === 'refund_consent');
  const vcOrder    = before.find(r => r.form_key === 'visit_confirm')?.sort_order;
  const rlOrder    = before.find(r => r.form_key === 'referral_letter')?.sort_order;

  // ── [WARN-1] visit_confirm ───────────────────────────────────────────────
  if (vcOrder === 40) {
    console.log('\n[1/4] [WARN-1] visit_confirm sort_order 40 → 45 ...');
    await runQuery(SQL_WARN1, 'warn1-visit_confirm');
    console.log('✅ visit_confirm sort_order 보정 완료');
  } else {
    console.log(`\n[1/4] [WARN-1] SKIP — visit_confirm sort_order = ${vcOrder} (이미 보정됨)`);
  }

  // ── [WARN-2] referral_letter ─────────────────────────────────────────────
  if (rlOrder === 90) {
    console.log('\n[2/4] [WARN-2] referral_letter sort_order 90 → 96 ...');
    await runQuery(SQL_WARN2, 'warn2-referral_letter');
    console.log('✅ referral_letter sort_order 보정 완료');
  } else {
    console.log(`\n[2/4] [WARN-2] SKIP — referral_letter sort_order = ${rlOrder} (이미 보정됨)`);
  }

  // ── [CRIT-1] refund_consent INSERT ──────────────────────────────────────
  if (!hasRefund) {
    console.log('\n[3/4] [CRIT-1] refund_consent INSERT ...');
    await runQuery(SQL_CRIT1, 'crit1-refund_consent');
    console.log('✅ refund_consent 레코드 INSERT 완료');
  } else {
    console.log('\n[3/4] [CRIT-1] SKIP — refund_consent 이미 존재');
  }

  // ── 사후 검증 ───────────────────────────────────────────────────────────
  console.log('\n[4/4] 사후 검증...');
  const after = await runQuery(SQL_VERIFY_AFTER, 'verify-after');
  console.log('사후 상태:', JSON.stringify(after, null, 2));

  // AC 검증
  const afterRefund = after.find(r => r.form_key === 'refund_consent');
  const afterVc     = after.find(r => r.form_key === 'visit_confirm');
  const afterRl     = after.find(r => r.form_key === 'referral_letter');

  const ac1 = !!afterRefund;
  const ac2 = afterRefund?.template_format === 'png' && afterRefund?.requires_signature === true;
  const vcOk = !afterVc || afterVc.sort_order !== 40;
  const rlOk = !afterRl || afterRl.sort_order !== 90;

  console.log('\n── AC 검증 결과 ──────────────────────────────────────────────');
  console.log(`AC-1 refund_consent DB 존재: ${ac1 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`AC-2 template_format=png, requires_signature=true: ${ac2 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`WARN-1 visit_confirm sort_order ≠ 40: ${vcOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`WARN-2 referral_letter sort_order ≠ 90: ${rlOk ? '✅ PASS' : '❌ FAIL'}`);

  if (!ac1 || !ac2) {
    throw new Error('AC 검증 실패! DB 상태를 확인하세요.');
  }

  console.log('\n🎉 T-20260522-foot-PENCHART-REFUND-DB: form_templates audit fix 완료');
  console.log('   - [CRIT-1] refund_consent: sort_order=93, png, requires_signature=true');
  console.log('   - [WARN-1] visit_confirm: sort_order 40→45 (멱등 처리)');
  console.log('   - [WARN-2] referral_letter: sort_order 90→96 (멱등 처리)');
}

run().catch(err => {
  console.error('❌ 예외:', err.message);
  process.exit(1);
});
