/**
 * T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI — §7 ADDENDUM 추가 VG READ-ONLY census
 *
 * *** READ-ONLY. prod write 0. exec_sql_readonly(SELECT-only) + PostgREST SELECT 만. ***
 *
 * DA CONSULT-REPLY §7 ADDENDUM (MSG-20260809-112911-vnjw) 추가 VG:
 *  VG-add-1 (Q2-tail-1) service_charges 무접촉: cis reinsert 가 service_charges 행 생성/변경 안 함
 *  VG-add-2 (Q2-tail-3, BLOCKING) outbox emit 결속: check_in_services INSERT 에 AFTER INSERT 트리거/
 *           outbox emit/도파민 push 결속 여부 (결속 시 emit-suppress 경로 필요)
 *  VG-add-3 (Q3) seller_staff_id 컬럼 실재: check_in_services.seller_staff_id 물리 존재
 *  VG-add-4 (Q4) evidentiary tier: Tier1(cis archive/audit before-image) 실재 여부 → tier 결정
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { q as mgmtQ } from './dryrun_lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
function envVal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    const p = join(ROOT, f);
    if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) {
      const m = l.match(new RegExp('^' + key + '=(.*)$'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}
const URL = envVal('VITE_SUPABASE_URL') || envVal('SUPABASE_URL');
const KEY = envVal('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !KEY) { console.error('missing env'); process.exit(1); }

// pg_catalog census via Management API (SELECT-only here — READ-ONLY, prod write 0).
async function sql(query) {
  try { return { data: await mgmtQ(query) }; }
  catch (e) { return { error: String(e.message || e) }; }
}
async function get(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) return { error: `${r.status} ${await r.text()}` };
  return { data: await r.json() };
}

const PARENT_CHECKIN = 'dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf';
const out = {};

// ── VG-add-3 (Q3) — check_in_services.seller_staff_id 컬럼 실재 ─────────────────
out.vg_add_3_seller_col = await sql(`
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema='public' and table_name='check_in_services'
    and column_name='seller_staff_id'`);

// ── VG-add-2 (Q2-tail-3) — check_in_services 에 결속된 트리거 census ────────────
//   AFTER/BEFORE INSERT 트리거 전량 열거. outbox/도파민 emit 결속 여부 판정.
out.vg_add_2_cis_triggers = await sql(`
  select t.tgname,
         case t.tgtype & 2 when 2 then 'BEFORE' else 'AFTER' end as timing,
         case when (t.tgtype & 4)=4 then 'INSERT' else '' end
           || case when (t.tgtype & 8)=8 then ' DELETE' else '' end
           || case when (t.tgtype & 16)=16 then ' UPDATE' else '' end as events,
         p.proname as fn, t.tgenabled
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  join pg_proc p on p.oid=t.tgfoid
  where n.nspname='public' and c.relname='check_in_services' and not t.tgisinternal
  order by t.tgname`);

//   대조군: payments 트리거(outbox emit 은 payments 에 결속됨을 실증) — cis 무관 확인.
out.vg_add_2_payments_triggers = await sql(`
  select t.tgname, p.proname as fn
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  join pg_proc p on p.oid=t.tgfoid
  where n.nspname='public' and c.relname='payments' and not t.tgisinternal
  order by t.tgname`);

// ── VG-add-1 (Q2-tail-1) — service_charges 무접촉 ──────────────────────────────
//   부모 check_in 의 현 service_charges 행 (화장품=비급여 → service_charges 미기록 기대).
out.vg_add_1_service_charges_current = await get(
  `service_charges?check_in_id=eq.${PARENT_CHECKIN}&select=id,service_id,is_insurance_covered,base_amount,insurance_covered_amount,copayment_amount`);
//   3 화장품 service 가 is_insurance_covered 인지 (FALSE 여야 service_charges 축 무관).
out.vg_add_1_cosmetic_service_flags = await get(
  `services?id=in.(89095450-223f-4863-89a9-c7f32f62809d,e17ba3a3-4842-4097-87bc-0778a64d2755,cb6443a3-fe53-40e7-bd51-a4444d8a8966)&select=id,name,is_insurance_covered,price`);

// ── VG-add-4 (Q4) — evidentiary tier: cis archive/audit before-image 실재 여부 ──
//   Tier1 = cis 소멸 前 원본 물리보존 테이블 존재? (archive/audit/history/soft-delete 저장소)
out.vg_add_4_archive_tables = await sql(`
  select table_name
  from information_schema.tables
  where table_schema='public'
    and (table_name ilike '%check_in_service%archive%'
      or table_name ilike '%check_in_service%audit%'
      or table_name ilike '%check_in_service%history%'
      or table_name ilike '%check_in_service%_del%'
      or table_name ilike '%cis%archive%')
  order by table_name`);
//   voided_at soft-void 컬럼은 08-05 신설(08-03 wipe=hard delete-all 이전엔 부재) → before-image 아님.
out.vg_add_4_softvoid_col_added = await sql(`
  select column_name from information_schema.columns
  where table_schema='public' and table_name='check_in_services' and column_name='voided_at'`);

console.log(JSON.stringify(out, null, 2));
