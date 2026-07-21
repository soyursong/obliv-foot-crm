#!/usr/bin/env node
/**
 * T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI — prod introspection (READ-ONLY, single run).
 * conductor KICK MSG-20260721-173653-kdvv evidence_reconcile.
 * 3개 dev-foot 리포트(g6h1/2z0p/1oh0) 상호모순 → 단일 정본 확정용.
 *
 * 확인항목 (외부 파트너 최필경 U05L6HE7QF6, pk.choi@medibuilder.com):
 *  ① user_profiles.role 현재값
 *  ② email_confirmed_at 현재값 (auth.users + user_profiles 양쪽 실측)
 *  ③ auth.users.encrypted_password 존재/해시 지문 (commit 85aab27a role-write 반영 여부 판정)
 * 무영속: 전부 SELECT introspection.
 */
import { q } from './dryrun_lib.mjs';

const EMAIL = 'pk.choi@medibuilder.com';

async function main() {
  const out = {};

  // 스키마 실측: user_profiles 컬럼 (role / email_confirmed_at 존재 여부 확인)
  out.user_profiles_cols = await q(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_profiles'
    ORDER BY ordinal_position;`);

  // ① + ② user_profiles 측 실 row
  out.user_profiles_row = await q(`
    SELECT *
    FROM public.user_profiles
    WHERE lower(email) = lower('${EMAIL}');`).catch(e => `ERR ${e.message}`);

  // 혹시 user_id 로만 연결되고 email 컬럼이 없을 수 있으니 auth.users 조인 폴백
  out.user_profiles_via_auth = await q(`
    SELECT up.*
    FROM public.user_profiles up
    JOIN auth.users au ON au.id = up.user_id
    WHERE lower(au.email) = lower('${EMAIL}');`).catch(e => `ERR ${e.message}`);

  // ②+③ auth.users: email_confirmed_at, encrypted_password 지문(md5+길이+null여부)
  out.auth_users_row = await q(`
    SELECT id, email, role AS auth_role,
           email_confirmed_at,
           confirmed_at,
           last_sign_in_at,
           created_at, updated_at,
           (encrypted_password IS NULL)          AS pw_is_null,
           length(encrypted_password)            AS pw_len,
           left(encrypted_password, 7)           AS pw_algo_prefix,
           md5(coalesce(encrypted_password,''))  AS pw_md5_fingerprint
    FROM auth.users
    WHERE lower(email) = lower('${EMAIL}');`).catch(e => `ERR ${e.message}`);

  console.log(JSON.stringify(out, null, 2));
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
