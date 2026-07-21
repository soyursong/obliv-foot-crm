#!/usr/bin/env node
/**
 * T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI — DECISIVE tie-breaker (READ-ONLY, single run).
 * planner NEW-TASK MSG-20260721-175323-r132.
 *
 * 1st reconcile(pqnm/e654d856): updated_at=07:34:59Z(이후 write0) / crypt(reset-pw)=FALSE
 * 2nd reconcile(9rvb):          updated_at=08:33:54Z(17:33 write O) / hash 존재만 확인(crypt 미실시)
 * → credential 근거 상호모순. 오직 credential 정본만 확정한다.
 *
 * 무영속: 전부 SELECT introspection. write/DDL 0. 파괴적 조치(reset/recovery) 없음.
 * 대상: id=d9bde8a8-887b-4c98-845e-fcc85d6d25af / pk.choi@medibuilder.com (외부 doAI 파트너 최필경)
 * author: dev-foot / 2026-07-21
 */
import { q } from './dryrun_lib.mjs';

const UID = 'd9bde8a8-887b-4c98-845e-fcc85d6d25af';
const EMAIL = 'pk.choi@medibuilder.com';
// 테스트할 리셋 평문은 환경변수로 주입 (하드코딩 금지 — secret-scan).
//   usage: CHOI_RESET_PW='<reset-plaintext>' node scripts/..._tiebreaker.mjs
const RESET_PW = process.env.CHOI_RESET_PW;
if (!RESET_PW) { console.error('CHOI_RESET_PW env 필요 (하드코딩 금지)'); process.exit(1); }

async function main() {
  const out = { target: { uid: UID, email: EMAIL, reset_pw_tested: RESET_PW } };

  // ── 항목1: crypt 직접 대조 ─────────────────────────────────────────────
  // encrypted_password = crypt(plaintext, encrypted_password) 는 저장 해시의 salt로
  // 재계산 → 그 평문이 로그인되는가(TRUE/FALSE). hash 존재 여부가 아니라 인증 성립 여부.
  // pgcrypto crypt: 무자격이면 extensions.crypt 폴백.
  out.q1_crypt_compare = await q(`
    SELECT
      id,
      (encrypted_password IS NULL)                                   AS pw_is_null,
      left(encrypted_password, 4)                                    AS algo,
      length(encrypted_password)                                     AS hash_len,
      md5(coalesce(encrypted_password,''))                           AS hash_md5,
      (encrypted_password = crypt('${RESET_PW}', encrypted_password)) AS reset_pw_authenticates
    FROM auth.users
    WHERE id = '${UID}';`).catch(async e => {
      // crypt not on search_path → extensions.crypt 폴백
      return await q(`
        SELECT
          id,
          (encrypted_password IS NULL) AS pw_is_null,
          left(encrypted_password, 4)  AS algo,
          length(encrypted_password)   AS hash_len,
          md5(coalesce(encrypted_password,'')) AS hash_md5,
          (encrypted_password = extensions.crypt('${RESET_PW}', encrypted_password)) AS reset_pw_authenticates
        FROM auth.users
        WHERE id = '${UID}';`).catch(e2 => `ERR crypt=${e.message} | ext.crypt=${e2.message}`);
    });

  // ── 항목2: updated_at 실제값 vs last_sign_in_at (컬럼 분리 보고) ──────────
  out.q2_timestamps = await q(`
    SELECT
      id,
      email,
      role                                              AS auth_role,
      created_at,
      updated_at,
      last_sign_in_at,
      email_confirmed_at,
      confirmed_at,
      (updated_at  AT TIME ZONE 'UTC')                  AS updated_at_utc,
      (last_sign_in_at AT TIME ZONE 'UTC')              AS last_sign_in_at_utc,
      extract(epoch FROM (updated_at - last_sign_in_at)) AS updated_minus_lastsignin_sec
    FROM auth.users
    WHERE id = '${UID}';`).catch(e => `ERR ${e.message}`);

  // ── 항목3: 07:34:59Z 이후 auth.users write 발생 유무 (audit log 실측) ────
  // GoTrue audit_log_entries = 계정 변경 event 원장. created_at + payload.action 로
  // 07:34:59Z 이후 password/email/meta write 여부를 확정.
  out.q3_audit_after_0734 = await q(`
    SELECT
      created_at,
      payload->>'action'    AS action,
      payload->>'actor_id'  AS actor_id,
      payload->>'actor_username' AS actor_username,
      payload->'traits'     AS traits
    FROM auth.audit_log_entries
    WHERE (payload->>'actor_id' = '${UID}'
        OR payload->'traits'->>'user_id' = '${UID}'
        OR payload->>'user_id' = '${UID}')
    ORDER BY created_at;`).catch(e => `ERR ${e.message}`);

  // 07:34:59Z 이후로 필터한 요약 (write성 action만)
  out.q3b_writes_after_0734 = await q(`
    SELECT
      created_at,
      payload->>'action' AS action
    FROM auth.audit_log_entries
    WHERE created_at > '2026-07-21 07:34:59+00'
      AND (payload->>'actor_id' = '${UID}'
        OR payload->'traits'->>'user_id' = '${UID}'
        OR payload->>'user_id' = '${UID}')
    ORDER BY created_at;`).catch(e => `ERR ${e.message}`);

  // ── 항목4: divergence root-cause 근거 — identities/updated 시각 + full row ──
  out.q4_identities = await q(`
    SELECT provider, created_at, updated_at, last_sign_in_at,
           (identity_data->>'email') AS id_email
    FROM auth.identities
    WHERE user_id = '${UID}'
    ORDER BY created_at;`).catch(e => `ERR ${e.message}`);

  // 서버 현재 시각(쿼리 실행 순간) — 리포트 캡처 타이밍 기록
  out.q_now = await q(`SELECT now() AS query_run_at_utc;`).catch(e => `ERR ${e.message}`);

  console.log(JSON.stringify(out, null, 2));
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
