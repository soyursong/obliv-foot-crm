/**
 * T-20260724-foot-DOCPUB-LINKAGE-EDITSCOPE — AC-2 RC PROBE (read-only, runtime 재현)
 *
 * 목적: 소견서 작성 폼 '환자 자동연동' 3필드(생년월일/당일시술/처방내역)가
 *   현재 배포본(loadOpinionAutofillRef, origin/main 5f72805)에서 실제로 채워지는지
 *   런타임으로 재현·확정. (추정 금지 — DOCPUB AC-2 는 DOCFORM-AUTOFILL 재결선과 수렴 여부 판정)
 *
 * loadOpinionAutofillRef 결선을 그대로 미러:
 *   birth  ← customers.birth_date OR rrn_decrypt 산출
 *   tx     ← check_in_services(check_in_id) OR 최신 medical_charts.treatment_record
 *   rx     ← check_ins.prescription_items(check_in_id) OR 최신 mc.prescription_items OR 최신 처방 check_in
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const today = "2026-07-11"; // 14일 window 시작
console.log('✅ DOCPUB AC-2 PROBE', new Date().toISOString(), 'todayKST=', today, '\n');

function summarizeRx(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const toks = items.map((it) => {
    if (it && typeof it === 'object') return String(it.name ?? it.drug_name ?? it.medication ?? it.label ?? '').trim();
    return String(it ?? '').trim();
  }).filter((s) => s.length > 0 && s !== '(이름 미입력)');
  return toks.length ? toks.join(', ') : null;
}

const { data: clinics } = await sb.from('clinics').select('id, name');
for (const clinic of clinics ?? []) {
  const clinicId = clinic.id;
  const { data: cis } = await sb
    .from('check_ins')
    .select('id, customer_id, customer_name, prescription_items, checked_in_at')
    .eq('clinic_id', clinicId)
    .gte("checked_in_at", `${today}T00:00:00+09:00`)
    .lte("checked_in_at", "2026-07-25T23:59:59+09:00")
    .neq('status', 'cancelled')
    .order('checked_in_at', { ascending: true });
  if (!cis || cis.length === 0) continue;
  console.log(`\n════ ${clinic.name} — 당일 내원 ${cis.length}건 (loadOpinionAutofillRef 미러) ════`);

  for (const ci of cis.slice(0, 15)) {
    const cid = ci.customer_id;
    if (!cid) { console.log(`  ${ci.customer_name} | (customer_id 없음)`); continue; }

    // birth
    const [{ data: cust }, { data: rrn }] = await Promise.all([
      sb.from('customers').select('birth_date').eq('id', cid).maybeSingle(),
      sb.rpc('rrn_decrypt', { customer_uuid: cid }).then(r => r).catch(() => ({ data: null })),
    ]);
    let birth = cust?.birth_date ?? null;
    let birthSrc = birth ? 'birth_date' : null;
    if (!birth && typeof rrn === 'string' && /^\d{6}/.test(rrn)) { birth = rrn.slice(0, 6); birthSrc = 'rrn파생'; }

    // tx
    const { data: svc } = await sb.from('check_in_services').select('service_name').eq('check_in_id', ci.id);
    let tx = (svc ?? []).map(r => String(r.service_name ?? '').trim()).filter(Boolean);
    let txSrc = tx.length ? 'check_in_services' : null;
    if (!tx.length) {
      const { data: mc } = await sb.from('medical_charts').select('treatment_record')
        .eq('clinic_id', clinicId).eq('customer_id', cid).not('treatment_record', 'is', null)
        .order('visit_date', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const tr = String(mc?.treatment_record ?? '').trim();
      if (tr) { tx = [tr.slice(0, 20)]; txSrc = 'mc.treatment_record(폴백)'; }
    }

    // rx
    let rx = summarizeRx(ci.prescription_items);
    let rxSrc = rx ? 'check_ins(당일)' : null;
    if (!rx) {
      const { data: mc } = await sb.from('medical_charts').select('prescription_items')
        .eq('clinic_id', clinicId).eq('customer_id', cid).not('prescription_items', 'is', null)
        .order('visit_date', { ascending: false }).order('created_at', { ascending: false }).limit(3);
      for (const row of mc ?? []) { const s = summarizeRx(row.prescription_items); if (s) { rx = s; rxSrc = 'mc(폴백)'; break; } }
    }
    if (!rx) {
      const { data: cis2 } = await sb.from('check_ins').select('prescription_items')
        .eq('clinic_id', clinicId).eq('customer_id', cid).not('prescription_items', 'is', null)
        .order('checked_in_at', { ascending: false }).limit(5);
      for (const row of cis2 ?? []) { const s = summarizeRx(row.prescription_items); if (s) { rx = s; rxSrc = 'check_in(폴백)'; break; } }
    }

    console.log(
      `  ${String(ci.customer_name).padEnd(6)} | ` +
      `생년월일=${birth ? `✅${birth}(${birthSrc})` : '❌없음'} | ` +
      `당일시술=${tx.length ? `✅${tx.join(',').slice(0,24)}(${txSrc})` : '❌없음'} | ` +
      `처방=${rx ? `✅${rx.slice(0,24)}(${rxSrc})` : '❌없음'}`
    );
  }
}
console.log('\n── DONE ──');
process.exit(0);
