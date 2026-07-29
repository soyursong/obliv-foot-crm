// Phase 1 진단 (읽기전용, SELECT only) — 송도/종로 풋센터 발송 연락처 전수 취합.
// 데이터 변경 없음. service_role.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const out = { generated_probe: 'T-20260729-BIZREG-SENDCONTACT-RECONCILE' };

// 1) clinics 전수 (name/slug/active)
{ const { data, error } = await sb.from('clinics').select('*').order('name');
  out.clinics_error = error?.message || null;
  out.clinics = (data ?? []).map(c => ({ id: c.id, name: c.name, slug: c.slug,
    is_active: c.is_active ?? c.active ?? null,
    address: c.address ?? null, phone: c.phone ?? null,
    biz_reg_no: c.business_registration_number ?? c.biz_reg_no ?? c.brn ?? null }));
}

// 2) clinic_messaging_capability 전수 (발신번호/vault/검증상태/enabled/표시명)
{ const { data, error } = await sb.from('clinic_messaging_capability').select('*');
  out.cmc_error = error?.message || null;
  out.clinic_messaging_capability = (data ?? []);
}

// 3) clinics.phone 등 대표번호 컬럼도 함께 (혹시 발신에 쓰이는지 대조용)
console.log(JSON.stringify(out, null, 2));
