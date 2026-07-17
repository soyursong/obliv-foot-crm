# T-20260716-foot-CLINICDOCTORS-STAFFID-LINK-BACKFILL — supervisor DB 게이트 요청 (backfill)

> dev-foot → supervisor. **진료콜 명단 진료의(원장) 드롭다운 ↔ 근무 캘린더 미연동 해소** — 각 원장
> `clinic_doctors.staff_id`(NULL=미연결)에 대응 `staff.id` 를 연결하면 `clinic_doctors.staff_id = duty_roster.doctor_id`
> canonical 조인(DA §2-14)이 성립 → 드롭다운이 근무/휴무 실시간 반영, '근무확인 미연결' advisory 해소.
> **감독형 신원 정합(supervised identity reconciliation)** — bulk 이름단독 UPDATE 아님(DA §2-1 반려).
> FK: `clinic_doctors.staff_id → staff(id) ON DELETE SET NULL`. **DDL 무변경(FK 값 채움).**

## ★ 0순위 — 스키마 실재 사전검증 (supervisor, apply 전 필수)

부모 마이그 `20260708210000_foot_treating_doctor_additive` 의 prod 실적용이 divergence 의심(`schema_precheck_gate: required`,
`db_change_premise: UNVERIFIED`, MSG-9rf8). **apply·dry-run 실행 전 supervisor 가 prod 에서 확인:**

- [ ] `clinic_doctors.staff_id` 컬럼 실재 (+ `check_ins.treating_doctor_id`) — ledger(20260708210000) 대조
- **컬럼 존재(all-NULL)** → 본 backfill 정상 진행 (`db_change=false` 전제 확정, DML만)
- **컬럼 미생성** → 부모 T-20260708 마이그 적용(PHI DB-GATE, 멱등 ADDITIVE+롤백) 선행 후 진행

> `_dryrun.mjs` 는 방어적으로 컬럼 부재 시 `exit 2` 로 abort (prod write 0) — 실재 확정 후 재실행.

## 게이트 진행 상황

| # | 게이트 | 상태 |
|---|--------|------|
| 0 | prod 스키마 실재 사전검증 (supervisor) | ⏳ 대기 (본 문서 상단) |
| 1 | DA CONSULT-REPLY GO | ✅ CLOSED — DA-20260716-foot-CLINICDOCTORS-STAFFID-LINK (MSG-20260716-005319-9e7i) |
| 2 | dev-foot dry-run candidate 산출 | ⏳ 스키마 실재 확정 후 `_dryrun.mjs` 실행 (스크립트 구비 완료) |
| 3 | 김주연 총괄 건별 현장확인 | ⏳ candidate 목록 제시(responder DECISION-REQUEST) |
| 4 | supervisor DB 백필 승인 (archive-first + rollback + 원장 무접점) | ⏳ |
| 5 | APPLY (targeted 단건) → 후검증 → 현장 confirm | ⏳ |

## DA CONSULT-REPLY 요약 (GO, Gate 1 CLOSED)

- §2-1 신원-링크 표준 = `clinic_doctors.staff_id`(원장 의료신원 브릿지)에 그대로 적용 **YES** (STAFF-AUTH-LINK 동형).
- 이름단독 일괄 UPDATE = rename drift 재주입 → **명백 반려**. 매칭 산식 = 감독형 정합(이름일치=candidate 산출용, apply=총괄 건별 현장확인 targeted 단건). 모호건(동명이인/no-match/1:多/多:1) = 전부 EXCLUDE, 추정 매핑 0.
- **★추가 narrowing 2건 (스크립트 반영):**
  - (a) **clinic_id 하드코딩 금지** → `clinics.slug='jongno-foot'` introspection 도출. candidate 는 그 clinic_id 스코프 + 매칭 staff 도 동일 clinic (cross-tenant 조인 금지).
  - (b) **candidate staff role ∈ {director, doctor} 게이트 필수** (동명 coordinator 오매칭 차단). role+name = candidate 강화이지 충분조건 아님 → 현장확인 유지.
- blast BOUNDED = duty_roster 근무판정 1축 · PHI/서류 무오염(`check_ins.treating_doctor_id → clinic_doctors(id)` 직접 FK, 서류 발행자/면허 SoT 무관) · rollback(staff_id→NULL) 완전원복=비파괴. **대표 게이트 불요(§3.1 면제 성립).**

## 로컬 패키지 (dev-foot 구비)

| 파일 | 역할 |
|------|------|
| `scripts/T-20260716-foot-CLINICDOCTORS-STAFFID-LINK-BACKFILL_dryrun.mjs` | READ-ONLY candidate 생성 (prod write 0, 컬럼 부재 시 abort) |
| `scripts/T-20260716-…_apply.sql` | APPLY 템플릿 (targeted 단건, staff_id IS NULL 가드 + id IN + pre/post COUNT). UUID 는 dry-run+현장확인 후 채움. **`*backfill*.sql` gitignore → 로컬 전용, 본문 아래 동봉** |
| `scripts/T-20260716-…_rollback.sql` | ROLLBACK 템플릿 (staff_id → NULL, 우리가 채운 값 한정). **로컬 전용, 본문 아래 동봉** |

## APPLY SQL (supervisor 집행 — 기대 정확 N행, 쌍별 명시 + pre/post 가드) ※ UUID 는 dry-run+현장확인 후 채움

```sql
BEGIN;
-- [확인 1] 적용 직전 대상 행수 == 기대행수(N). 삼중가드: id IN(N) + staff_id IS NULL + clinic 스코프.
SELECT count(*) AS expect_rows  -- 기대 = 현장확인 candidate 건수 N
FROM clinic_doctors
WHERE id IN ('{{CD_ID_1}}',   -- {{CD_NAME_1}}
             '{{CD_ID_2}}')   -- {{CD_NAME_2}}
  AND staff_id IS NULL
  AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot');

-- [적용] 쌍별 명시 UPDATE (한 쌍 = 한 문장, 추정 일괄 금지)
UPDATE clinic_doctors SET staff_id = '{{STAFF_ID_1}}'
 WHERE id = '{{CD_ID_1}}' AND staff_id IS NULL
   AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot');  -- {{CD_NAME_1}} -> 1 row
UPDATE clinic_doctors SET staff_id = '{{STAFF_ID_2}}'
 WHERE id = '{{CD_ID_2}}' AND staff_id IS NULL
   AND clinic_id = (SELECT id FROM clinics WHERE slug = 'jongno-foot');  -- {{CD_NAME_2}} -> 1 row

-- [확인 2] staff_id 채워짐 + 대응 staff 원장role
SELECT cd.id, cd.name AS 원장, cd.staff_id, s.name AS staff명, s.role
FROM clinic_doctors cd LEFT JOIN staff s ON s.id = cd.staff_id
WHERE cd.id IN ('{{CD_ID_1}}', '{{CD_ID_2}}');
-- [확인 3] 1:1 무중복 (cross-contamination 0)
SELECT staff_id, count(*) FROM clinic_doctors
 WHERE staff_id IN ('{{STAFF_ID_1}}', '{{STAFF_ID_2}}') GROUP BY staff_id HAVING count(*) > 1;  -- 0행
-- [확인 4] duty_roster 조인 성립 (clinic_doctors.staff_id = duty_roster.doctor_id)
SELECT cd.name AS 원장, cd.staff_id, count(dr.*) AS roster_rows
FROM clinic_doctors cd LEFT JOIN duty_roster dr ON dr.doctor_id = cd.staff_id AND dr.clinic_id = cd.clinic_id
WHERE cd.id IN ('{{CD_ID_1}}', '{{CD_ID_2}}') GROUP BY cd.name, cd.staff_id;
COMMIT;  -- supervisor 승인 + [확인1]==N + [확인3] 0행 충족 시에만. 아니면 ROLLBACK.
```

## ROLLBACK SQL (완전원복 — staff_id → NULL, 우리가 채운 값 한정)

```sql
BEGIN;
UPDATE clinic_doctors SET staff_id = NULL
 WHERE id IN ('{{CD_ID_1}}', '{{CD_ID_2}}')
   AND staff_id IN ('{{STAFF_ID_1}}', '{{STAFF_ID_2}}');  -- 우리가 채운 값만(외부 재할당 보호)
SELECT id, name, staff_id FROM clinic_doctors WHERE id IN ('{{CD_ID_1}}', '{{CD_ID_2}}');  -- staff_id NULL 복귀
COMMIT;
```

## 안전 속성 요약

- **no-clobber**: `staff_id IS NULL` 인 행만 대상 → 기존 링크 절대 미변경 (additive·비파괴).
- **targeted 단건**: WHERE = `staff_id IS NULL` + 명시 `id IN(...)` + clinic 스코프. 쌍별 명시 UPDATE (룰 일괄 금지). 기대행수 COUNT 일치 검증.
- **archive-first**: apply 전 대상행(id·name·old staff_id=NULL) 스냅샷 + rollback SQL 구비 (supervisor 집행).
- **후검증**: (a) 진료콜 명단 드롭다운 근무 원장=선택가능/휴무=disabled 실시간, (b) '미연결' advisory 해소, (c) cross-contamination 0 ([확인3]), (d) duty_roster 조인 성립 ([확인4]).
- **오결합 방지**: 이름단독 자동매핑 금지 → role 게이트 + 김주연 총괄 건별 현장확인. 오결합 시 근무/휴무 오표시 + 의료신원 오염(보안속성).

## 완료 통지 (apply 후)

김주연 총괄(U0ATDB587PV), ch C0ATE5P6JTH, thread `1784129378.454849` — 링크 apply 후 진료콜 명단 드롭다운에서
근무 원장=선택가능 / 휴무 원장=disabled 실시간 반영 confirm 시 responder 가 원 스레드 통지.
