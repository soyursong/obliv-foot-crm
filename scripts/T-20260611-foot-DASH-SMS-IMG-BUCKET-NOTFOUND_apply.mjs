/**
 * T-20260611-foot-DASH-SMS-IMG-BUCKET-NOTFOUND — APPLY (영속)
 * 진단: prod 에 message-images 버킷 + image_path 컬럼 + msgimg RLS 미적용
 *       (마이그 20260609200000 가 prod 에 한 번도 안 올라감).
 * 조치: 기존 마이그(idempotent)를 prod 에 직접 적용 후 별도 연결로 영속 검증.
 * 롤백: supabase/migrations/20260609200000_notification_templates_image_mms.rollback.sql
 */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
for (const line of fs.readFileSync('.env','utf8').split('\n')){const m=line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)DB_PASSWORD=m[1].trim();}
const conn = () => new Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:DB_PASSWORD,ssl:{rejectUnauthorized:false}});
const sql = fs.readFileSync('supabase/migrations/20260609200000_notification_templates_image_mms.sql','utf8');

// ── 1) APPLY (transaction wrap) ──
const c1 = conn(); await c1.connect();
console.log('✅ DB 연결 (APPLY)', new Date().toISOString());
try {
  await c1.query('BEGIN');
  await c1.query(sql);
  await c1.query('COMMIT');
  console.log('✅ 마이그 실행 완료 (COMMIT).');
} catch (e) {
  await c1.query('ROLLBACK').catch(()=>{});
  console.error('❌ APPLY 실패:', e.message); await c1.end(); process.exit(1);
}
await c1.end();

// ── 2) 별도 연결로 영속 검증 ──
const c2 = conn(); await c2.connect();
let pass = true; const chk=(n,v)=>{console.log(`  ${v?'✅':'❌'} ${n}`); if(!v)pass=false;};
console.log('\n── 영속 회귀가드 ──');
const b = await c2.query(`SELECT public FROM storage.buckets WHERE id='message-images'`);
chk('message-images bucket exists', b.rows.length===1);
chk('bucket is private (public=false)', b.rows[0]?.public===false);
const pol = await c2.query(`SELECT policyname,cmd,roles FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'msgimg%'`);
const rd = pol.rows.find(r=>r.policyname==='msgimg_clinic_read');
const wr = pol.rows.find(r=>r.policyname==='msgimg_clinic_write');
chk('msgimg_clinic_read [SELECT] authenticated', rd && rd.cmd==='SELECT' && String(rd.roles).includes('authenticated'));
chk('msgimg_clinic_write [ALL] authenticated', wr && wr.cmd==='ALL' && String(wr.roles).includes('authenticated'));
// public 전체개방 금지 확인: anon/public role 없어야
const anyAnon = pol.rows.some(r=>String(r.roles).includes('anon')||String(r.roles)==='{public}');
chk('no anon/public open policy (PHI-인접 차단)', !anyAnon);
const col = await c2.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notification_templates' AND column_name='image_path'`);
chk('notification_templates.image_path exists', col.rows.length===1);
await c2.end();
console.log(pass ? '\n🎯 ALL PASS' : '\n💥 FAIL'); process.exit(pass?0:1);
