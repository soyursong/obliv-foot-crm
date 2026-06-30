# T-20260630-foot-CODY-CLINICID-BACKFILL — DRY-RUN 산출 (prod write 0)

> 단계: **dry-run 분석·산출만**. prod UPDATE 0건. apply 는 김주연 총괄 사람확인 → supervisor DB 게이트 後.
> 실행: `scripts/T-20260630-foot-CODY-CLINICID-BACKFILL_dryrun.mjs` + `_evidence.mjs` (READ-ONLY, service_role REST)
> 생성: 2026-07-01

---

## 1. foot clinic 수 실측 (가드 5-(a) 선행)

**foot 는 MULTI_CLINIC (active clinic 2건)** — 단일테넌트 아님.

| clinic_id | 이름 | slug |
|---|---|---|
| `74967aea-a60b-4da3-a0e7-9c997a930bc8` | 오블리브의원 서울 오리진점 | jongno-foot (종로) |
| `b4dc0de5-f007-4a57-8888-aabbccddeeff` | 오블리브 풋센터 송도 | songdo-foot (송도) |

⚠ **DA CONSULT 의 '추정 4312b082 단일테넌트' 가정은 무효.**
- `4312b082...` 는 **body(도수센터) clinic_id** (T-20260612-body 선례). foot 에는 존재하지 않음.
- foot 는 2-clinic 이므로 **NULL→유일 clinic 결정론적 경로 사용 불가.** 계정별 positive 증거 필수(AC-1).

## 2. clinic_id IS NULL staff/coordinator 전수

- `user_profiles` clinic_id IS NULL: **1건** (아래)
- `staff` 테이블 clinic_id IS NULL: **0건** (완전성 확인됨)
- coordinator role 6명 중 5명 clinic 정상, 1명만 NULL. admin 11/director 1 전원 정상 → **다지점 의도 NULL(보류 대상) 0건.**

| id | email | 이름 | role | 현재 clinic | approved | created_at | last_sign_in |
|---|---|---|---|---|---|---|---|
| `d4c83d20-e8d6-4918-97ce-2cce68d444ae` | kyh3858@hanmail.net | 김연희 | coordinator | **NULL** | **false** | 2026-06-24 | **없음(미로그인)** |

## 3. 증거 수집 결과 (추정0 — 우선순위 ①→②→③)

| 증거 경로 | 결과 |
|---|---|
| ① 등록출처/생성컨텍스트 | auth user_metadata.role=`manager`(가입의도) / user_profiles.role=`coordinator`. **clinic 상속 흔적 없음** (app_metadata 에 clinic 없음). created 6/24 신규. |
| ① staff 테이블 매칭 | user_id·name(김연희) 둘 다 **staff row 없음** → 소속 지점 단서 0 |
| ② 활동발자국 | check_ins/reservations/medical_charts/handover/memos/payments 등 **20개 테이블 전수 스캔 — 발자국 0건.** (미로그인·미사용 계정) |
| ③ 모호 시 현장확인 | **해당** — positive 증거 부재 |

→ **자동/결정론적 clinic 확정 불가.** "상속 실패가 NULL 주원인" 가설과 정합: 신규 코디 계정이 로그인 지점 상속에 실패해 clinic_id=NULL 로 생성됨 + 이후 미사용이라 추론 단서 부재.

## 4. 역할별 NULL 분기 분류 (계약 L137)

| 분류 | 건수 | 대상 |
|---|---|---|
| 누락(결함)→자동 backfill 대상 | **0** | (positive 증거 없어 자동 확정 불가) |
| 정상 다지점 가능(admin/director, 보류) | **0** | — |
| **결함이나 매핑 모호→현장확인 필요** | **1** | 김연희(coordinator) |

→ coordinator=단일지점 역할이므로 NULL=결함이 맞음(backfill 되어야 함). 단 **어느 지점인지는 추정 불가 → 김주연 총괄 positive 확인 필수.** 전건 일괄 UPDATE 금지(AC-1 정합) — 일괄할 행 자체가 1건이고 그마저 증거 부재.

## 5. dry-run 기대행수 (apply 삼중가드 검증용)

```
total_null_profiles      : 1
자동 backfill 가능        : 0  (증거 부재)
현장확인 필요             : 1  (김연희)
apply 시 기대 영향행수    : 1  (김주연 확인 後, 단일 행)
```

WHERE 삼중가드: `id IN('d4c83d20-...') AND role='coordinator' AND clinic_id IS NULL` → 기대 **정확히 1행**.

## 6. 결론 / 다음 단계

1. **자동 backfill 불가** — foot multi-clinic + 증거 부재. AC-1(추정 금지) 준수 위해 **김주연 총괄에게 김연희 코디 소속 지점(종로 vs 송도) positive 확인 필요.**
2. 확인 수신 → `_apply.sql` 의 `:TARGET_CLINIC_ID` 치환(종로 `74967aea` / 송도 `b4dc0de5`) → **supervisor DB 게이트** 경유 apply(기대 1행).
3. apply 後 **양방향 격리검증**: ① 김연희 clinic RRN prefill 정상 AND ② 타 clinic RRN 복호 불가.
4. ⚠ **김연희 계정은 approved=false(미승인)** — clinic_id 채워도 `is_approved_user()` 게이트로 정상 사용 불가. 승인 플로우 별도 필요(본 티켓 범위 외, 현장 안내 권고).

## 산출 파일
- `_dryrun.mjs` / `_dryrun.out.json`(gitignored: *backfill*.json) — 전수 추출·분류·기대행수
- `_evidence.mjs` — 증거 심층 프로브(등록출처·발자국)
- `_apply.sql` / `_rollback.sql`(gitignored: *backfill*.sql, 로컬 보존) — 아래 부록에 본문 포함

---

## 부록 A — apply SQL (미실행 템플릿, supervisor DB 게이트 後)

```sql
-- :TARGET_CLINIC_ID = 김주연 확인 後 치환  종로 '74967aea-a60b-4da3-a0e7-9c997a930bc8' / 송도 'b4dc0de5-f007-4a57-8888-aabbccddeeff'
BEGIN;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM user_profiles
   WHERE id='d4c83d20-e8d6-4918-97ce-2cce68d444ae' AND role='coordinator' AND clinic_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'PRECHECK FAIL: 기대 1행, 실제 % 행', n; END IF;
END $$;
UPDATE user_profiles SET clinic_id = :'TARGET_CLINIC_ID', updated_at = now()
 WHERE id IN ('d4c83d20-e8d6-4918-97ce-2cce68d444ae') AND role='coordinator' AND clinic_id IS NULL;  -- 기대 1행
COMMIT;
```

## 부록 B — rollback SQL

```sql
BEGIN;
UPDATE user_profiles SET clinic_id = NULL, updated_at = now()
 WHERE id IN ('d4c83d20-e8d6-4918-97ce-2cce68d444ae') AND role='coordinator' AND clinic_id = :'TARGET_CLINIC_ID';  -- 기대 1행
COMMIT;
```
