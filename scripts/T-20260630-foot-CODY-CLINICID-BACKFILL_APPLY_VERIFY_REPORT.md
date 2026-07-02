# T-20260630-foot-CODY-CLINICID-BACKFILL — PROD APPLY + 양방향 격리검증 리포트

> dev-foot 직접 PROD 집행 (supervisor DB-GATE-APPROVED, MSG-20260702-115800-iebg).
> PHI 경로 → apply=dev-foot 직접 실행 / supervisor=사전승인·사후검증.
> 채널: Supabase Management API (`/v1/projects/rxlomoozakkjesdqjtvd/database/query`), SUPABASE_ACCESS_TOKEN.
> ⚠ 본 리포트에는 실 RRN 평문·환자 식별정보 미포함 (boolean/count/length 만).

## 0) 실행 환경
- host: domasui-MacStudio (M3 Ultra, ~/GitHub) / node v26.4.0
- 구 apply 패턴(`pg` + pooler + SUPABASE_DB_PASSWORD)은 신 머신에 DB_PASSWORD 부재 → Management API(access token)로 동등 집행.

## 1) 사전 PRECHECK (read-only, prod write 0) — PASS
- [A] 타깃 clinic: 오블리브의원 서울 오리진점 / jongno-foot / 74967aea-a60b-4da3-a0e7-9c997a930bc8 ✅
- [B] 삼중가드 정확 1행: kyh3858@hanmail.net / role=coordinator / clinic_id=NULL ✅
- [C] 무회귀: user_profiles clinic_id IS NULL 총 1건(coordinator 1건) ✅

## 2) APPLY (삼중가드 트랜잭션, 승인 SQL verbatim) — 성공
- 실행: `scripts/T-20260630-foot-CODY-CLINICID-BACKFILL_apply.sql` (BEGIN/가드1/UPDATE/가드2/COMMIT)
- 결과: HTTP 201, 예외 0 (가드1·가드2 통과 → COMMIT).
- 사후 확인 쿼리:
  - target_row: kyh3858 / coordinator / clinic_id=`74967aea…`(jongno) / updated_at=2026-07-02T03:01:15Z
  - **applied_jongno_count = 1** (정확 1행)
  - coord_null_remaining = 0
  - any_null_remaining = 0
- 영향 행수: **정확 1행**. 롤백 불필요.

## 3) 사후 양방향 격리검증 (dev-foot 수행) — 양방향 PASS

검증 방식: kyh3858 계정은 approved=false(미로그인)이므로 DB 레벨에서 `request.jwt.claims.sub`=kyh3858 id 로 auth 컨텍스트를 충실히 시뮬레이션(gate1/gate2 모두 auth.uid() 기반). rrn_decrypt 호출은 검증용 트랜잭션 내 실 ciphertext 대상.

### ① 본인 clinic 정상 (게이트2 통과) — PASS
- caller_clinic = 74967aea(jongno), caller_role = coordinator (gate1: coordinator 브랜치 통과)
- rrn_decrypt(jongno 환자 F-0154) → **NON-NULL** (len=13, 값 미노출) → 뒷자리 prefill 정상 복원
- 참고: backfill 전 clinic_id=NULL 이면 gate2(`대상 IS DISTINCT FROM NULL`=true)로 본인 clinic 조차 차단됨 → 이번 backfill 이 정확히 그 원인을 해소.

### ② 타 clinic 격리 무회귀 — PASS
- gate2 predicate(kyh3858 실 컨텍스트): `songdo(b4dc0de5…) IS DISTINCT FROM current_user_clinic_id()` = **true** → rrn_decrypt 의 `RETURN NULL` 분기 발동 → 송도 환자 복호 불가.
- 라이브 negative(비-jongno 호출자): caller_clinic=NULL → rrn_decrypt(jongno F-0154) → **NULL**(복호 불가) → 함수의 NULL 경로가 실 ciphertext 에서 정상 동작.
- 구조적: 송도 테넌트(songdo-foot) 현재 환자 0명 · RRN 보유 0건 → kyh3858→송도 실 노출 표면 부재. (전체 32 RRN 환자 전부 jongno)

**결론: ① NON-NULL / ② NULL 유지 → 양방향 PASS → deploy-ready.**

## 4) 범위 외 (현장 별도)
- kyh3858 계정 approved=false(승인 대기). clinic_id backfill ≠ 계정 활성화 → 직원 승인 절차는 현장 admin 플로우(김주연 총괄 고지). backfill 범위 외.

## 5) 후속 unblock
- 본 apply 완료로 P1 `T-20260702-foot-CODY-PKG-CREATE-PERM`(동일 계정 kyh3858 패키지 생성 권한, 임계경로) unblock 조건 충족.
