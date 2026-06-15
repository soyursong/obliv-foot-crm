// T-20260615-foot-IS-HEALER-INTENT-BACKFILL — AC-1(dependency gate) + AC-2(backfill dry-run) READ-ONLY probe
// 데이터변경 없음. SELECT 전용.
//   AC-1: 부모 #7 컬럼 ADD(reservations.is_healer_intent, DEFAULT false)가 prod 적용됐는지 확인.
//   AC-2: backfill UPDATE 영향 row count + 분포 산출(적용 직전 ground-truth).
import pg from 'pg'; import { readFileSync } from 'node:fs';
const ROOT=process.env.HOME+'/Documents/GitHub/obliv-foot-crm';
let P=process.env.SUPABASE_DB_PASSWORD;
for(const l of readFileSync(ROOT+'/.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const c=new pg.Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
await c.connect();

let fail=0;

// ── AC-1: dependency gate — 컬럼 존재 + DEFAULT false 확인 ──────────────
console.log('=== AC-1 dependency gate: reservations.is_healer_intent 컬럼 ADD prod 적용 확인 ===');
const{rows:col}=await c.query(
  `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reservations' AND column_name='is_healer_intent'`);
if(col.length===0){
  fail++;
  console.log('  ❌ is_healer_intent 컬럼 부재 → 부모 #7 컬럼 ADD 미적용. dependency 미충족 → backfill 금지.');
}else{
  const r=col[0];
  const defFalse = r.column_default && /false/i.test(r.column_default);
  console.log(`  ✅ 컬럼 존재: ${r.data_type}, nullable=${r.is_nullable}, default=${r.column_default}`);
  if(!defFalse){ console.log('  ⚠️ DEFAULT false 아님 — 기대와 다름(정보성).'); }
  // healer_flag 컬럼도 존재 확인(backfill source)
  const{rows:hf}=await c.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='reservations' AND column_name='healer_flag'`);
  if(hf.length===0){ fail++; console.log('  ❌ healer_flag(backfill source) 컬럼 부재 → UPDATE WHERE 절 무효.'); }
  else console.log('  ✅ healer_flag(backfill source) 컬럼 존재.');
}

// ── AC-2: backfill dry-run (영향 row count + 분포) ──────────────────────
if(!fail){
  console.log('\n=== AC-2 backfill dry-run (READ-ONLY, UPDATE 영향 범위) ===');
  // 전체 분포
  const{rows:dist}=await c.query(
    `SELECT
       count(*)                                                  AS total,
       count(*) FILTER (WHERE healer_flag=true)                  AS hf_true,
       count(*) FILTER (WHERE is_healer_intent=true)             AS intent_true_now,
       count(*) FILTER (WHERE healer_flag=true
                          AND is_healer_intent IS DISTINCT FROM true) AS will_update
     FROM public.reservations`);
  const d=dist[0];
  console.log(`  전체 reservations            : ${d.total}`);
  console.log(`  healer_flag=true             : ${d.hf_true}`);
  console.log(`  is_healer_intent=true (현재) : ${d.intent_true_now}`);
  console.log(`  ▶ UPDATE 영향 row(승계 대상) : ${d.will_update}`);

  // 지점별 분포(참고) — reservations 는 clinic_id FK 기준(clinic_slug 컬럼 없음)
  const{rows:byClinic}=await c.query(
    `SELECT coalesce(cl.slug, r.clinic_id::text, '(null)') clinic, count(*) n
       FROM public.reservations r
       LEFT JOIN public.clinics cl ON cl.id = r.clinic_id
      WHERE r.healer_flag=true AND r.is_healer_intent IS DISTINCT FROM true
      GROUP BY 1 ORDER BY 2 DESC`);
  if(byClinic.length){
    console.log('  ─ 승계 대상 지점 분포 ─');
    for(const r of byClinic) console.log(`    ${r.clinic}: ${r.n}`);
  }else{
    console.log('  ─ 승계 대상 0건 (backfill no-op) ─');
  }
}

await c.end();
console.log(fail?`\n❌ PROBE FAIL (${fail}) — dependency 미충족 or source 부재. backfill 보류.`
                :'\n✅ PROBE CLEAN — AC-1 dependency 충족 + AC-2 dry-run 산출 완료. backfill 적용 GO 가능.');
process.exit(fail?1:0);
