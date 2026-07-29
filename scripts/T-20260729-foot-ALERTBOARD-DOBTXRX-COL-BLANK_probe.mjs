/**
 * T-20260729-foot-ALERTBOARD-DOBTXRX-COL-BLANK — RC PROBE (read-only)
 *
 * 목적: 진료 알림판 소견서·진단서 목록(처리대기 + 서류완료) 3컬럼
 *   (생년(만나이) / 오늘시술 / 처방내역) 전행 공란 RC를 런타임 데이터로 확정.
 *
 * 대조:
 *   - 현행 JINRYO-ALIMPAN 훅 소스: customers.birth_date(직접), check_ins TODAY-KST 글로벌, check_in_services 처방약
 *   - DOCFORM(loadOpinionAutofillRef) 소스: birth_date OR RRN 파생, 그 방문 check_in_id 스코프
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
console.log('✅ PROBE', new Date().toISOString(), 'todayKST=', today, '\n');

const { data: clinics } = await sb.from('clinics').select('id, name');
for (const clinic of clinics ?? []) {
  const clinicId = clinic.id;
  // 알림판 목록 = form_submissions (draft=처리대기, published=서류완료)
  const { data: subs } = await sb
    .from('form_submissions')
    .select('id, customer_id, check_in_id, field_data, status, created_at')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: false })
    .limit(80);
  if (!subs || subs.length === 0) continue;
  const opinionish = subs.filter((s) => {
    const fd = s.field_data || {};
    return fd.birth_date !== undefined || fd.doc_type !== undefined || fd.selected_keys !== undefined;
  });
  console.log(`\n===== clinic ${clinic.name} (${clinicId.slice(0,8)}) : form_submissions=${subs.length}, opinion-ish=${opinionish.length} =====`);

  let n = 0;
  for (const s of opinionish.slice(0, 6)) {
    n++;
    const cid = s.customer_id;
    const chkId = s.check_in_id;
    const fd = s.field_data || {};
    console.log(`\n[row ${n}] status=${s.status} customer_id=${cid?.slice(0,8)} check_in_id=${chkId?.slice(0,8) ?? 'NULL'} snapshot.birth_date=${JSON.stringify(fd.birth_date)}`);

    if (cid) {
      const { data: cust } = await sb.from('customers').select('birth_date').eq('id', cid).maybeSingle();
      const { data: rrn } = await sb.rpc('rrn_decrypt', { customer_uuid: cid });
      console.log(`  BIRTH: customers.birth_date=${JSON.stringify(cust?.birth_date)} | rrn_decrypt=${rrn ? '(present '+String(rrn).slice(0,6)+'..)' : 'NULL'}`);
    }

    // 현행 훅: 오늘(KST) check_ins 글로벌
    if (cid) {
      const { data: ciToday } = await sb.from('check_ins')
        .select('id, treatment_kind, treatment_category, checked_in_at')
        .eq('clinic_id', clinicId).eq('customer_id', cid)
        .gte('checked_in_at', `${today}T00:00:00+09:00`).lte('checked_in_at', `${today}T23:59:59+09:00`);
      console.log(`  TX(현행 today-glb): count=${ciToday?.length ?? 0} kinds=${JSON.stringify((ciToday??[]).map(r=>r.treatment_kind))}`);
    }
    // DOCFORM: 그 방문 check_in 스코프
    if (chkId) {
      const { data: ciRow } = await sb.from('check_ins').select('id, treatment_kind, treatment_category, checked_in_at, prescription_items').eq('id', chkId).maybeSingle();
      const { data: svc } = await sb.from('check_in_services').select('service_name, services:service_id(category_label)').eq('check_in_id', chkId);
      console.log(`  TX(방문 chkId): treatment_kind=${JSON.stringify(ciRow?.treatment_kind)} at=${ciRow?.checked_in_at}`);
      console.log(`  RX(방문 chkId): check_in_services=${JSON.stringify((svc??[]).map(r=>({n:r.service_name,c:Array.isArray(r.services)?r.services[0]?.category_label:r.services?.category_label})))}`);
      console.log(`  RX(check_ins.prescription_items)=${JSON.stringify(ciRow?.prescription_items)}`);
    } else {
      console.log(`  TX/RX(방문): check_in_id NULL → 방문 스코프 조회 불가`);
    }
    // 최신 medical_charts 폴백 확인
    if (cid) {
      const { data: mc } = await sb.from('medical_charts')
        .select('treatment_record, prescription_items, visit_date')
        .eq('clinic_id', clinicId).eq('customer_id', cid)
        .order('visit_date', { ascending: false }).limit(1).maybeSingle();
      console.log(`  MC(최신): treatment_record=${JSON.stringify(mc?.treatment_record)?.slice(0,60)} rx=${JSON.stringify(mc?.prescription_items)?.slice(0,80)}`);
    }
  }
}
console.log('\n✅ DONE');
