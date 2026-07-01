# T-20260630-foot-STAFF-AUTH-LINK-BACKFILL — supervisor DB 게이트 요청 (apply)

> dev-foot → supervisor. 현장확인 증거 수신 → apply 보류 해제(field_confirm_received, planner TICKET-UPDATE MSG-20260701-075023-pdqm).
> **감독형 신원 정합(supervised identity reconciliation)** — bulk backfill 아님. DA CONSULT-REPLY(MSG-20260701-034334-qxef) reframe+부분-GO.
> PHI attribution 경로(created_by 발급자·매출귀속·시술담당 조인) = autonomy §3.1 면제 아님 → **dev-foot 직접 prod write 금지. supervisor DB 게이트가 집행.**
> 로컬 SQL: `scripts/T-20260630-foot-STAFF-AUTH-LINK-BACKFILL_apply.sql` / `_rollback.sql` (본 문서에 본문 동봉).
> FK: `staff.user_id → user_profiles.id` (auth 신원). **DDL 무변경(FK 값 채움).**

## 확정 매핑 (targeted 단건 2건 ONLY — 룰 일괄 금지)

| 대상 | staff.id | → user_profiles.id | role | 근거 |
|------|----------|-------------------|------|------|
| **박민석** (활성 coordinator) | `fd54a977-d203-44f6-91cb-0f1fce47dd97` | `dad7dc00-dc99-41af-b5fc-42aa77a0bd9b` | coordinator | 직원명부=로그인계정 동일인 confirm |
| **문지은** (대표원장·director) | `b46abc6d-4a24-4776-b807-751b62f60fe3` | `d343769a-493a-49c9-b718-4c92c6f5db9a` | director | 동일인 confirm + 면허·매출귀속 연결 포함 = **총괄 갈음(director급 인지)** |

- **현장확인 증거 (DA Q4 허용 apply 조건 충족)**: 확인자 **김주연 총괄** / 일시 **2026-07-01** / ts `1782859741.988249` (원 thread 1782810022.833979 / channel C0ATE5P6JTH), "맞아".
- 추정 아님 — 권위 현장확인(email 일치보다 강한 positive 증거). auto backfill 순증 **0** 확정.

## carve-out (본 apply 범위 외 — NULL 유지)

- **NONPERSON 30** = expected-NULL(비-로그인 엔티티, 설계상 정상, 결함 아님) — scope-out.
- **OCCUPIED 4 + 비활성 NAME_ONLY 2(김민경·정혜인)** = 별트랙 **T-20260701-foot-STAFF-ROSTER-DEDUP**.
- **NO_MATCH 6** = NULL 유지.
- 본 apply 는 **박민석·문지은 2건에 한함**.

## dev-foot read-only PRECHECK (2026-07-01, prod write 0)

`scripts/T-20260630-foot-STAFF-AUTH-LINK-BACKFILL_precheck.mjs` (service_role REST, SELECT-only) + `_apply_dryrun.mjs` → **ALL PASS**:

- [A] 대상 2 staff: 존재 · active=true · **user_id IS NULL** · name/role 일치(박민석/coordinator, 문지은/director) · clinic=jongno-foot ✅
- [B] 대상 2 user_profiles: 존재 · active · approved · name/role/clinic 정합 ✅
- [C] **OCCUPIED 무충돌**: 두 user_profiles.id 미점유(다른 staff 가 물고 있지 않음) ✅
- [D] WHERE 가드 기대 영향행수 **정확 2행** ✅
- [E] carve-out: staff.user_id IS NULL 총 44건 중 대상 2건, 잔여 42건 미변경 ✅

## APPLY SQL (supervisor 집행 — 기대 정확 2행, 쌍별 명시 + pre/post 가드)

```sql
BEGIN;
-- [확인 1] 적용 직전 대상 행수 == 기대행수(2). 가드: id IN(2) + user_id IS NULL + role.
SELECT count(*) AS expect_rows  -- 기대 2
FROM staff
WHERE id IN ('fd54a977-d203-44f6-91cb-0f1fce47dd97',   -- 박민석 coordinator
             'b46abc6d-4a24-4776-b807-751b62f60fe3')   -- 문지은 director
  AND user_id IS NULL AND role IN ('coordinator', 'director');

-- [적용] 쌍별 명시 UPDATE (한 쌍 = 한 문장, 추정 일괄 금지)
UPDATE staff SET user_id = 'dad7dc00-dc99-41af-b5fc-42aa77a0bd9b', updated_at = now()
 WHERE id = 'fd54a977-d203-44f6-91cb-0f1fce47dd97' AND user_id IS NULL AND role = 'coordinator';  -- 박민석 -> 1 row

UPDATE staff SET user_id = 'd343769a-493a-49c9-b718-4c92c6f5db9a', updated_at = now()
 WHERE id = 'b46abc6d-4a24-4776-b807-751b62f60fe3' AND user_id IS NULL AND role = 'director';     -- 문지은 -> 1 row

-- [확인 2] 적용된 2행 user_id 채워짐
SELECT id, name, role, user_id FROM staff
 WHERE id IN ('fd54a977-d203-44f6-91cb-0f1fce47dd97', 'b46abc6d-4a24-4776-b807-751b62f60fe3');

-- [확인 3] 1:1 무중복 — 채운 두 user_id 가 단일 staff 에만 물림 (0행이어야 함)
SELECT user_id, count(*) FROM staff
 WHERE user_id IN ('dad7dc00-dc99-41af-b5fc-42aa77a0bd9b', 'd343769a-493a-49c9-b718-4c92c6f5db9a')
 GROUP BY user_id HAVING count(*) > 1;

COMMIT;  -- supervisor 승인 + [확인1]==2 + [확인3] 0행 모두 충족 시에만. 아니면 ROLLBACK.
```

## ROLLBACK SQL (검증 실패 시 / 원복 의도 시)

```sql
BEGIN;
UPDATE staff SET user_id = NULL, updated_at = now()
 WHERE id IN ('fd54a977-d203-44f6-91cb-0f1fce47dd97',   -- 박민석
              'b46abc6d-4a24-4776-b807-751b62f60fe3')   -- 문지은
   AND user_id IN ('dad7dc00-dc99-41af-b5fc-42aa77a0bd9b',   -- 박민석이 채운 값
                   'd343769a-493a-49c9-b718-4c92c6f5db9a');  -- 문지은이 채운 값 (외부 재할당 보호)
SELECT id, name, role, user_id FROM staff
 WHERE id IN ('fd54a977-d203-44f6-91cb-0f1fce47dd97', 'b46abc6d-4a24-4776-b807-751b62f60fe3');
COMMIT;
```

## 사후검증 (AC-4 — dev-foot 수행, apply COMMIT 후, 단방향 close 금지)

`scripts/T-20260630-foot-STAFF-AUTH-LINK-BACKFILL_postverify.mjs` (READ-ONLY):
1. **(a) 적재 회복**: 대상 2건 `staff.user_id` == 의도한 user_profiles.id (created_by attribution 경로 회복).
2. **(b) cross-contamination 0**: 채운 user_id 가 각각 단일 staff(본인)에만 물림 · 1:1 무중복 불변식 유지 · 타 신원 귀속 무회귀.
3. 양방향 PASS → done. 어느 한쪽 실패 → 즉시 rollback.

## 게이트/정책 정합

- **AC-1 정확 매핑** ✅ (positive: 이름+role+clinic 정합 + 권위 현장확인, 추정 0)
- **AC-2 DA CONSULT** ✅ (부분-GO, MSG-20260701-034334-qxef)
- **AC-3 안전** ✅ (dry-run→사람 confirm→**supervisor DB 게이트**→apply. WHERE 가드+기대행수+rollback 구비. §3.1 면제 아님)
- **AC-5 non-blocking** ✅ (정규신원 마이그 트랙 독립, P2)
- da_consult_done: true / db_gate_required: true / hotfix: false / non_blocking: true
