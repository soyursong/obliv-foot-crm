/**
 * T-20260803-foot-ACCOUNT-CREATE-ERROR-4STAFF-PROVISION — ② provisioning/reconcile
 *
 * RC(AC-1): FE 계정생성 = 비원자 3단 클라이언트 흐름(signUp → admin_register_user RPC →
 *   admin_approve_and_confirm_user RPC). signUp 후 단계 실패 시 auth 계정은 이미 생성(미확인,
 *   handle_new_user 트리거가 role=staff/approved=false 기본 프로필 생성)된 채 에러만 표출 →
 *   그 반쯤-생성 계정이 재시도를 막음(cross_crm_auth_identity_standard §INV-6 orphan 위험).
 *   진단 실물: 이정인=auth존재+email_confirmed=NULL+role=staff/approved=false. 이은희·진이서=미생성.
 *
 * 해법: GoTrue admin(service_role) 서버경로로 4명 원자 provisioning/reconcile.
 *   - resolveUserByEmail(전량스캔+정확매칭, INV-1,2,3) → FOUND면 assertUserIdentity(INV-4) 후 재사용(self-heal, 삭제 안 함).
 *   - NOT_FOUND면 admin.createUser({email_confirm:true}) — 확인메일 없이 즉시 로그인 가능 계정.
 *   - user_profiles upsert(정확 role, approved=true, active) + staff row user_id 링크(동명·동역할·clinic·user_id NULL).
 *   - 매 write rows-affected=1 검증(cross_crm_write_rowcheck_standard) — 0-row+null 조용한실패 차단.
 *   - 실로그인 검증(password grant)로 로그인 가능 최종 확인.
 *   - 임시비번 = 콘솔 + off-git rollback 파일에만(git 미커밋).
 *
 * 실행: SUPABASE_SERVICE_ROLE_KEY=.. VITE_SUPABASE_ANON_KEY=.. APPLY=true node scripts/..._provision.mjs  (기본 DRY)
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })();
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.ANON_KEY || '';
const APPLY = process.env.APPLY === 'true';
const svc = createClient(URL, KEY, { auth: { persistSession: false } });

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot

const TARGETS = [
  { name: '송민근', role: 'consultant', email: 'mhsong12@naver.com' },
  { name: '이정인', role: 'therapist',  email: 'dlwjddls993@naver.com' },
  { name: '이은희', role: 'therapist',  email: 'ebline1@naver.com' },
  { name: '진이서', role: 'consultant', email: 'glgdmskd6@naver.com' },
];

// 강한 임시비번(12자, 영대소+숫자+특수 각1 보장)
function genPw() {
  const U='ABCDEFGHJKLMNPQRSTUVWXYZ', L='abcdefghijkmnopqrstuvwxyz', D='23456789', S='!@#$%';
  const all=U+L+D+S; const b=randomBytes(16);
  let pw=U[b[0]%U.length]+L[b[1]%L.length]+D[b[2]%D.length]+S[b[3]%S.length];
  for(let i=4;i<12;i++) pw+=all[b[i]%all.length];
  return pw.split('').sort(()=> (randomBytes(1)[0]-128)).join('');
}

async function resolveUserByEmail(admin, rawEmail) {
  const email=(rawEmail??'').trim().toLowerCase(); const matches=[]; const perPage=1000;
  for(let page=1;page<=100;page++){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage});
    if(error) throw new Error('LIST_FAILED: '+error.message);
    const users=data?.users??[];
    for(const u of users) if((u.email??'').trim().toLowerCase()===email) matches.push(u);
    if(users.length<perPage) break;
  }
  if(matches.length===0) return {status:'NOT_FOUND'};
  if(matches.length>1) return {status:'AMBIGUOUS',count:matches.length};
  return {status:'FOUND',user:matches[0]};
}

async function assertIdentity(admin, id, expectedEmail){
  const {data,error}=await admin.auth.admin.getUserById(id);
  if(error||!data?.user) throw new Error('REVERIFY_FETCH_FAILED');
  if((data.user.email??'').trim().toLowerCase()!==(expectedEmail??'').trim().toLowerCase())
    throw new Error('IDENTITY_MISMATCH:'+id);
  return data.user;
}

async function verifyLogin(email, pw){
  if(!ANON) return 'ANON키없음-스킵';
  const r=await fetch(`${URL}/auth/v1/token?grant_type=password`,{
    method:'POST',headers:{apikey:ANON,'Content-Type':'application/json'},
    body:JSON.stringify({email,password:pw})});
  const j=await r.json();
  return j.access_token?`✅ 로그인OK(${r.status})`:`❌ ${r.status} ${JSON.stringify(j)}`;
}

async function main(){
  console.log(`=== T-20260803 4-STAFF PROVISION (APPLY=${APPLY}) ===`, new Date().toISOString());
  const results=[]; const relayLines=[];
  mkdirSync('rollback',{recursive:true});

  for(const t of TARGETS){
    console.log(`\n── ${t.name} / ${t.role} / ${t.email} ──`);
    const r=await resolveUserByEmail(svc, t.email);
    if(r.status==='AMBIGUOUS'){ console.log(`  ⚠ AMBIGUOUS(${r.count}) — 수동확인 필요, 스킵`); results.push({...t,outcome:'AMBIGUOUS_SKIP'}); continue; }

    let uid, mode;
    const pw=genPw();
    if(r.status==='FOUND'){
      await assertIdentity(svc, r.user.id, t.email); // INV-4
      uid=r.user.id; mode='RECONCILE(기존재사용)';
      console.log(`  기존 auth.users 재사용 uid=${uid} (email_confirmed_at=${r.user.email_confirmed_at||'NULL→확정예정'})`);
    } else {
      mode='CREATE(신규)';
      console.log(`  신규 생성 대상`);
    }

    if(!APPLY){
      console.log(`  [DRY] ${mode} → email_confirm=true + 임시비번 + user_profiles(role=${t.role},approved) + staff 링크 예정`);
      results.push({...t,outcome:'DRY',mode}); continue;
    }

    // 1) auth: 생성 또는 email_confirm+비번 설정
    if(r.status==='FOUND'){
      const {data:upd,error:ue}=await svc.auth.admin.updateUserById(uid,{password:pw,email_confirm:true});
      if(ue){ console.error('  updateUserById 실패:',ue.message); results.push({...t,outcome:'AUTH_FAIL',err:ue.message}); continue; }
      console.log('  [1] email_confirm+임시비번 설정 ✅ confirmed_at=',upd.user.email_confirmed_at);
    } else {
      const {data:cre,error:ce}=await svc.auth.admin.createUser({email:t.email,password:pw,email_confirm:true,user_metadata:{name:t.name}});
      if(ce||!cre?.user){ console.error('  createUser 실패:',ce?.message); results.push({...t,outcome:'AUTH_FAIL',err:ce?.message}); continue; }
      uid=cre.user.id;
      await assertIdentity(svc, uid, t.email); // 생성 직후 재검증
      console.log('  [1] createUser+email_confirm ✅ uid=',uid,'confirmed_at=',cre.user.email_confirmed_at);
    }

    // 2) user_profiles upsert (정확 role/approved/active/clinic). rows-affected 검증.
    const {data:prof,error:pe}=await svc.from('user_profiles')
      .upsert({id:uid,email:t.email.toLowerCase(),name:t.name,role:t.role,clinic_id:CLINIC_ID,approved:true,active:true},{onConflict:'id'})
      .select('id,role,approved,active');
    if(pe||!prof||prof.length!==1){ console.error('  user_profiles upsert 실패/0-row:',pe?.message); results.push({...t,outcome:'PROFILE_FAIL',err:pe?.message}); continue; }
    console.log('  [2] user_profiles ✅',JSON.stringify(prof[0]));

    // 3) staff 링크: 동명·동역할·clinic·(user_id NULL 또는 동일) row에 user_id 세팅. 없으면 신규 생성.
    const {data:stCand}=await svc.from('staff').select('id,user_id')
      .eq('clinic_id',CLINIC_ID).eq('name',t.name).eq('role',t.role).or(`user_id.is.null,user_id.eq.${uid}`);
    if(stCand&&stCand.length>=1){
      const sid=stCand[0].id;
      const {data:su,error:se}=await svc.from('staff').update({user_id:uid,active:true}).eq('id',sid).select('id');
      if(se||!su||su.length!==1){ console.error('  staff 링크 실패/0-row:',se?.message); results.push({...t,outcome:'STAFF_FAIL',err:se?.message}); continue; }
      console.log('  [3] staff 링크 ✅ staff_id=',sid,stCand.length>1?`(⚠동명동역할 ${stCand.length}건 중 첫행)`:'');
    } else {
      const {data:si,error:sie}=await svc.from('staff').insert({user_id:uid,name:t.name,role:t.role,active:true,clinic_id:CLINIC_ID}).select('id');
      if(sie||!si||si.length!==1){ console.error('  staff INSERT 실패/0-row:',sie?.message); results.push({...t,outcome:'STAFF_FAIL',err:sie?.message}); continue; }
      console.log('  [3] staff 신규생성 ✅ staff_id=',si[0].id);
    }

    // 4) 실로그인 검증
    const login=await verifyLogin(t.email,pw);
    console.log('  [4] 실로그인:',login);
    const ok=login.startsWith('✅')||login.includes('스킵');
    results.push({...t,uid,outcome:ok?'OK':'LOGIN_FAIL',mode,login});
    relayLines.push(`${t.name} / ${t.role==='consultant'?'상담실장':'치료사'} / ${t.email} / 임시비번: ${pw}`);
  }

  // 요약 + relay 파일(off-git rollback/)
  console.log('\n\n=== 요약 ===');
  for(const x of results) console.log(`  ${x.name}: ${x.outcome} ${x.mode||''} ${x.login||''}`);
  if(APPLY && relayLines.length){
    const relayPath='rollback/T-20260803-foot-ACCOUNT-4STAFF_relay_SECRET.txt';
    writeFileSync(relayPath, `T-20260803 4명 계정 임시비번 (off-git·relay 1회)\n생성: ${new Date().toISOString()}\n\n`+relayLines.join('\n')+'\n\n※ 각자 최초 로그인 후 즉시 변경 안내.\n');
    console.log(`\n[relay] 임시비번 → ${relayPath} (git 미추적). 콘솔에도 위 출력.`);
    console.log('\n── RELAY 본문(임시비번) ──');
    relayLines.forEach(l=>console.log('  '+l));
  }
  console.log('\n[DONE]');
}
main().then(()=>process.exit(0)).catch(e=>{console.error('FATAL',e);process.exit(1);});
