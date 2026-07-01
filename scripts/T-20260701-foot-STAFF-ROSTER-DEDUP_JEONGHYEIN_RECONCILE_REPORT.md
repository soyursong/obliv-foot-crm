# T-20260701-foot-STAFF-ROSTER-DEDUP — #6 정혜인 RECONCILE DRY-RUN 보고 (READ-ONLY)

> dev-foot. 생성 2026-07-01. **prod write 0** (`scripts/..._jeonghyein_reconcile_dryrun.mjs` + 확인 probe, service_role REST SELECT/head-count only).
> planner reconcile 게이트용. 구 T-20260619-STAFF-DELETE-JEONGHYEIN(hard-delete, **SUPERSEDED**) ↔ ROSTER-DEDUP dryrun factual 불일치 3건 fresh 재확인.
> 처분 방식 = **soft-delete** 확정(hard-DELETE 금지, DA CONSULT MSG-20260701-212011-06ip = 의료법 §22 감사 trail). **apply·UPDATE·soft-delete 실행 0.**

## 요약 (planner 판정 입력값)

| 항목 | 확정값 |
|------|--------|
| 정혜인 staff row 수 | **1행** (동명이인 0) |
| active state | **active=false** (활성 canonical 정혜인 부재) |
| soft-delete 대상 staff_id | **`5f141f76-7f72-4560-8a67-bbcdf4938cad`** (consultant, clinic 74967aea) |
| FK 귀속 재집계(fresh) | **총 2건** — room_assignments.staff_id 2 / 나머지 0 |
| 재귀속 대상 | **정연주** `c851fbb1-31ce-4714-b91c-03e9cb8af566` (active consultant, clinic 74967aea, user_id 3bd596ca) |
| 재귀속 모호성 | **없음** (활성 정연주 정확히 1행) |
| prod write | **0** |
| supervisor DB 게이트 준비 | **READY** (blocker 없음) |

---

## [불일치1] 정혜인 staff row 수 + active state → **T-20260619 보고와 일치**

`staff WHERE name='정혜인'` 전수 재조회:

| id | active | role | clinic | user_id |
|----|--------|------|--------|---------|
| `5f141f76-7f72-4560-8a67-bbcdf4938cad` | **false** | consultant | 74967aea (OK) | null |

- **1행뿐, active=false, 동명이인 0.** → T-20260619 FK precheck(6/19) 보고와 정확히 일치.
- **ROSTER-DEDUP DA 계획의 "active 정혜인 canonical행 실재" 전제는 FALSE.** 활성 정혜인은 0행.
- ⇒ 재귀속 대상 판정은 fallback 규칙(정연주)으로 진입.

## [불일치2] 전체 FK 귀속 재집계 → **fresh = 2건 (ROSTER-DEDUP와 일치, T-20260619의 3건은 시점 차이)**

대상 staff.id = `5f141f76` 기준, 4개 FK 컬럼 동적 재집계:

| FK 컬럼 | fresh refs |
|---------|-----------|
| duty_roster.doctor_id | 0 |
| package_sessions.performed_by | 0 |
| **room_assignments.staff_id** | **2** |
| **customers.assigned_staff_id** | **0** |
| **합계** | **2** |

room_assignments 2건 실체:
- `bd2ff40c…` date=2026-04-29
- `215c9b5b…` date=2026-05-08

### 3→2 불일치 근본원인(RC) — 2개 층위, 둘 다 규명됨

1. **ROSTER-DEDUP의 2건 보고 RC** = 부모 스크립트 `SCAN_TABLES` 에 base `customers` 테이블 **누락**(customer_* 메모 테이블만 포함) → `customers.assigned_staff_id` 경로가 애초에 집계에서 빠졌음. (본 재집계는 customers 포함 4 FK 전수)
2. **T-20260619의 3건(customers 1 포함) → 현재 0건 RC** = 문제의 customers 행이 **6/19 이후 정혜인→정연주로 재귀속됨**. 확인:
   - 2026-05-20 등록 고객 `83ab4fe1…`(= T-20260619이 지목한 설연우로 특정; phone 암호화로 끝자리 직접대조 불가하나 등록일·유일성 일치) 의 현재 `assigned_staff_id = c851fbb1(정연주)`, JH 아님.
   - 즉 **설연우 customers 귀속은 이미 실근무자(정연주)로 이관 완료** — 유실 아님, 재귀속 불필요.
   - 정연주는 현재 총 6명 고객 보유(설연우 포함).

⇒ **현시점 정혜인(5f141f76)에 남은 실 귀속은 room_assignments 2건뿐.** customers 경로 orphan 위험 없음.

## [불일치3] 재귀속 대상 확정 → **정연주, 모호성 없음**

- 활성 정혜인 부재 → fallback 규칙(T-20260619 김주연 원 confirm "실근무자에게 이관") 적용.
- `staff WHERE name='정연주'` = 정확히 1행: `c851fbb1-31ce-4714-b91c-03e9cb8af566`, **active=true**, role consultant, clinic 74967aea(OK), user_id `3bd596ca`(user_profiles 링크됨, joo4442@naver.com).
- ⇒ **재귀속 대상 = 정연주, 확정. 모호성 없음.**

---

## 결론 · supervisor DB 게이트 입력

```
soft_delete_target_staff_id : 5f141f76-7f72-4560-8a67-bbcdf4938cad  (정혜인, 유일행)
soft_delete_method          : soft-delete (active=false / deleted_at) — hard-DELETE 금지
expected_reattribution_rows : 2  (room_assignments.staff_id, id IN [bd2ff40c…, 215c9b5b…])
reattribution_target        : c851fbb1-31ce-4714-b91c-03e9cb8af566  (정연주)
customers_reattribution     : 0 rows (설연우 이미 정연주 귀속 — 조치 불요)
ambiguous                   : false
prod_writes                 : 0
```

### 판단이 필요한 잔여 결정(planner/supervisor) — 재귀속 필요성 자체
- 처분 방식이 **soft-delete**(행 보존)이므로 `room_assignments.staff_id → 5f141f76` FK는 **소프트삭제 후에도 유효**(참조행 미삭제). 즉 **referential integrity 관점에서는 room_assignments 2건 재귀속이 강제되지 않음.**
- 재귀속의 실익은 **표시/집계상 소프트삭제된 정혜인명이 과거 room_assignments에 남는 것**을 정연주로 교체할지 여부(cosmetic/운영 판단). room_assignments는 스케줄 산출물이며 PHI 귀속의 1급 경로는 아님(customers 경로는 이미 0).
- ⇒ 권고: **soft-delete 5f141f76 (필수)** + room_assignments 2건 재귀속은 **옵션**(planner 결정). 어느 쪽이든 기대행수 명시: soft-delete 1행 / 재귀속 시 room_assignments 2행.

## 산출물
- `scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_jeonghyein_reconcile_dryrun.mjs` — read-only reconcile 스크립트 (prod write 0)
- `scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_jeonghyein_reconcile.out.json` — 실측 결과 JSON
- 본 보고서

## apply 금지 재확인
본 티켓 산출은 **보고만**. soft-delete/UPDATE/재귀속 실행은 planner reconcile 승인 → supervisor DB 게이트(per-person BEGIN..COMMIT, WHERE id IN 가드, 기대행수 일치, rollback SQL) 後. 본 세션 prod write = **0**.
