# T-20260630-foot-CODY-CLINICID-BACKFILL — supervisor DB 게이트 요청 (apply)

> dev-foot → supervisor. 현장확인 수신 → backfill 보류 해제(MSG-20260701-075206-m00q).
> PHI 경로(rrn_decrypt 게이트2/테넌트 격리) = autonomy §3.1 면제 아님(DA 5가드#4) → **dev-foot 직접 prod write 금지. supervisor DB 게이트가 집행.**
> SQL 본문은 `*backfill*.sql` gitignore(실환자 덤프 오프-git)라 로컬 보존 + 본 문서에 본문 동봉.
> 로컬 SQL: `scripts/T-20260630-foot-CODY-CLINICID-BACKFILL_apply.sql` / `_rollback.sql`

## 확정 매핑 (AC-1 positive)

- 대상 1행: 김연희 / kyh3858@hanmail.net / coordinator / id `d4c83d20-e8d6-4918-97ce-2cce68d444ae`
- 소속 = **종로(서울 오리진점) = jongno-foot = `74967aea-a60b-4da3-a0e7-9c997a930bc8`**
  - 후보 2곳 중 종로 택1. 송도(`b4dc0de5-f007-4a57-8888-aabbccddeeff`) 아님.
- 김주연 총괄 confirm ts: `1782859741.988249` (원 질문 thread 1782810022.833979 / channel C0ATE5P6JTH)
- 추정 아님 — 현장 positive 증거(소속 확인).

## dev-foot read-only PRECHECK (2026-07-01, prod write 0)

`scripts/T-20260630-foot-CODY-CLINICID-BACKFILL_precheck.mjs` (service_role REST, SELECT-only) → **PASS**:

- [A] 타깃 clinic 정합: `74967aea...` = 오블리브의원 서울 오리진점 / slug=jongno-foot ✅
- [B] 삼중가드 정확 **1행**: kyh3858 / role=coordinator / clinic_id=NULL ✅
- [C] 무회귀: user_profiles clinic_id IS NULL 전수 1건(coordinator 1건) — staff NULL 0건 ✅

## APPLY SQL (supervisor 집행 — 기대 정확 1행, 삼중가드 + pre/post 가드)

```sql
BEGIN;
-- (가드1) 적용 직전 대상 1행·NULL 재확인 — 1행 아니면 즉시 중단
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM user_profiles
   WHERE id='d4c83d20-e8d6-4918-97ce-2cce68d444ae' AND role='coordinator' AND clinic_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'PRECHECK FAIL: 기대 1행, 실제 % 행 — 중단', n; END IF;
END $$;
-- Forward UPDATE (삼중가드) → 종로(jongno-foot)
UPDATE user_profiles
   SET clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8', updated_at=now()
 WHERE id IN ('d4c83d20-e8d6-4918-97ce-2cce68d444ae') AND role='coordinator' AND clinic_id IS NULL;
-- (가드2) 적용 후 검증 — 정확 1행 종로로 채워짐. 불일치 시 ROLLBACK
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM user_profiles
   WHERE id='d4c83d20-e8d6-4918-97ce-2cce68d444ae' AND clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8';
  IF n <> 1 THEN RAISE EXCEPTION 'POSTCHECK FAIL: 적용행 % (기대 1) — 롤백', n; END IF;
END $$;
COMMIT;
```

## ROLLBACK SQL (검증 실패 시)

```sql
BEGIN;
UPDATE user_profiles SET clinic_id=NULL, updated_at=now()
 WHERE id IN ('d4c83d20-e8d6-4918-97ce-2cce68d444ae') AND role='coordinator'
   AND clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8';   -- 적용했던 종로 값일 때만 (기대 1행)
COMMIT;
```

## 사후 양방향 격리검증 (dev-foot 수행 — apply 후, 단방향 close 금지)

1. **①본인 clinic 정상**: kyh3858 계정으로 2번차트 RRN [수정] 진입 → 뒷자리 prefill 정상(게이트2 통과).
2. **②타 clinic 격리 무회귀**: kyh3858(=종로)이 송도(`b4dc0de5...`) 환자 RRN 복호 **불가** 유지(테넌트 격리 회귀 없음).
3. 양방향 PASS → deploy-ready. 어느 한쪽 실패 → 즉시 rollback.

## 범위 외 (현장 별도 사안)

- 본 계정 `approved=false`(승인 대기). clinic_id backfill ≠ 계정 활성화. 직원 승인 절차는 현장 admin 플로우(dev 범위 외, 김주연 총괄 고지·responder 안내).
