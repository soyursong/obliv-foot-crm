#!/usr/bin/env node
/**
 * T-20260724-foot-COSMETIC-SELLER-ATTRIB — FIELD-SOAK READ-ONLY 진단
 * 3가설 판정: H1(UI 컬럼) / H2(seller_staff_id write) / H3(COALESCE 폴백)
 * PHI 최소조회 — service catalog + check_in_services 화장품 라인 + check_ins 귀속만.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const URL_ = g('VITE_SUPABASE_URL');
const SR = g('SUPABASE_SERVICE_ROLE_KEY');
const REF = URL_.match(/https:\/\/([a-z0-9]+)\.supabase/)[1];
const admin = createClient(URL_, SR, { auth: { persistSession: false } });
console.log('=== project ref:', REF, '===\n');

// clinic 목록
const { data: clinics } = await admin.from('clinics').select('id, name, slug');
console.log('[clinics]', clinics?.map((c) => `${c.name}(${c.slug}) ${c.id.slice(0, 8)}`).join(' | '));

// ── H1/H3 근원: '풋화장품' 카테고리 서비스가 실제 존재하는가 ──
const { data: svcAll } = await admin
  .from('services')
  .select('id, clinic_id, name, category, category_label')
  .or('category.eq.풋화장품,category_label.eq.풋화장품');
console.log(`\n[화장품 서비스(services.category/category_label='풋화장품')]: ${svcAll?.length ?? 0}건`);
for (const s of svcAll ?? []) {
  console.log(`  ${s.name} | category=${s.category} | category_label=${s.category_label} | clinic=${s.clinic_id?.slice(0, 8)} | id=${s.id.slice(0, 8)}`);
}

// 참고: '화장품'류로 보이는데 category 다른 서비스 (오분류 탐지)
const { data: svcLike } = await admin
  .from('services')
  .select('id, clinic_id, name, category, category_label')
  .or('name.ilike.%화장품%,name.ilike.%크림%,name.ilike.%로션%,category.ilike.%화장품%,category_label.ilike.%화장품%');
console.log(`\n[이름/카테고리에 화장품류 포함 서비스(오분류 탐지)]: ${svcLike?.length ?? 0}건`);
for (const s of svcLike ?? []) {
  const flagged = (s.category === '풋화장품' || s.category_label === '풋화장품') ? 'OK' : '⚠️분류불일치';
  console.log(`  [${flagged}] ${s.name} | category=${s.category} | category_label=${s.category_label} | id=${s.id.slice(0, 8)}`);
}

const cosmeticIds = new Set((svcAll ?? []).map((s) => s.id));

// ── H2/H3: 최근(07-24~07-25) 화장품 check_in_services 라인 실측 ──
// service_id 기반 + 이름 기반 둘 다 조회 (분류불일치 커버)
const likeIds = new Set((svcLike ?? []).map((s) => s.id));
const allProbeIds = [...new Set([...cosmeticIds, ...likeIds])];
console.log(`\n[화장품 후보 service_id]: ${allProbeIds.length}개`);

if (allProbeIds.length > 0) {
  const { data: lines, error: lerr } = await admin
    .from('check_in_services')
    .select('id, service_id, service_name, price, seller_staff_id, check_in_id, created_at, check_ins!inner(id, therapist_id, clinic_id, checked_in_at, customer_id)')
    .in('service_id', allProbeIds)
    .gte('created_at', '2026-07-20T00:00:00+09:00')
    .order('created_at', { ascending: false });
  if (lerr) { console.error('lines query error', lerr); }
  console.log(`\n[07-20~ 화장품 라인(check_in_services)]: ${lines?.length ?? 0}건`);
  for (const l of lines ?? []) {
    const isCosmetic = cosmeticIds.has(l.service_id) ? '풋화장품OK' : '⚠️분류밖';
    const bucket = l.seller_staff_id ?? l.check_ins?.therapist_id ?? null;
    console.log(`  [${isCosmetic}] name=${l.service_name} price=${l.price} seller=${l.seller_staff_id ?? 'NULL'} therapist=${l.check_ins?.therapist_id?.slice(0, 8) ?? 'NULL'} bucket=${bucket ? bucket.slice(0, 8) : '★미상(집계제외)'} checked_in_at=${l.check_ins?.checked_in_at ?? 'NULL'} created=${l.created_at}`);
  }

  // 버킷 집계 시뮬레이션 (SalesStaffTab cosmeticBySeller 로직 재현) — 풋화장품OK 라인만
  const okLines = (lines ?? []).filter((l) => cosmeticIds.has(l.service_id) && (l.price ?? 0) > 0);
  const bySeller = new Map();
  let excluded = 0;
  for (const l of okLines) {
    const bucket = l.seller_staff_id ?? l.check_ins?.therapist_id ?? null;
    if (!bucket) { excluded++; continue; }
    bySeller.set(bucket, (bySeller.get(bucket) ?? 0) + (l.price ?? 0));
  }
  console.log(`\n[SalesStaffTab 집계 시뮬 — 풋화장품OK & price>0]: ${okLines.length}라인 → 버킷 ${bySeller.size}개, 미상제외 ${excluded}건`);
  for (const [b, amt] of bySeller) console.log(`  bucket=${b.slice(0, 8)} → ${amt}원`);
}

// ── checked_in_at 세팅률 (기간필터 실패 위험) ──
const { data: ciSample } = await admin
  .from('check_ins')
  .select('id, checked_in_at, created_at, status')
  .gte('created_at', '2026-07-24T00:00:00+09:00')
  .order('created_at', { ascending: false })
  .limit(20);
const nullCia = (ciSample ?? []).filter((c) => !c.checked_in_at).length;
console.log(`\n[최근 check_ins checked_in_at 세팅]: 표본 ${ciSample?.length ?? 0} 중 checked_in_at NULL ${nullCia}건`);

console.log('\n=== done ===');
