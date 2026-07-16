# T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL — backfill dry-run 플랜 (GATE_HOLD)

> **상태**: SOP 선행 저작 완료(2026-07-16). **실행 미착수** — 게이트 순서 전부 GREEN 전 PROD UPDATE 금지.
> **작성**: dev-foot. **실행/승인**: supervisor(archive-first + dry-run 검수 + rowcount-verify).
> **DB**: rxlomoozakkjesdqjtvd (obliv-foot-crm PROD, clinic=jongno-foot).
> **가드(ticket)**: db_change=false(DML·DDL 0) / risk=GO_WARN / e2e_exempt=db_only / 대표게이트 불요(NULL-only+no-clobber, DOPAMINE-BACKFILL 선례).

## 0. 목적 (한 줄)
forward sync EF(RESVROUTE-VISITCHANNEL-ALWAYSYNC 15efde96, 2026-07-14 배포 + CUSTOMERS-SYNC-FIX closed)는 **신규분만** 자동 연동. 그 이전 적재된 예약 잔존건 — `reservations.visit_route` 는 있으나 `customers.visit_route(2번차트 방문경로)` NULL — 을 소급 fill. CUSTOMERS-SYNC-FIX.spec.ts:74 "잔존은 backfill 소관" 계승.

## 1. 착수 선결 게이트 (순서 엄수 — 위반 시 supervisor qa-fail)
- [ ] **G1 (DA CONSULT-REPLY GO)** — Cross-CRM Data-Correction Backfill SOP 1차 게이트. CONSULT 발행: MSG-20260716-130106-0yan (→ data-architect). Q1 subsume / Q2 잔차·2-pass / Q3 파생집계 double-count / Q4 fill값 규칙. **GO 수령 전 STEP 1 이후 실행 금지.**
- [ ] **G2 (dry-run evidence)** — STEP 0-A/0-B count + STEP 1 freeze + STEP 2 assert 실행 → BEFORE/AFTER·대상셋 freeze JSON·no-clobber 술어 실증을 `_dryrun.md/.json` 착지.
- [ ] **G3 (supervisor 백필 승인)** — archive-first(_backup 스냅샷) + dry-run 검수 + 원장(schema_migrations) 무접점 확인.
- → STEP 3 APPLY(멱등 guard + freeze JOIN) → STEP 4 post-verify(잔존 0) → E2E spec PASS → 현장(김주연 총괄) confirm → done.

## 2. 대상셋 지문 (SOP §2)
```
최종 대상 =
    customers.visit_route IS NULL                                  -- G0 no-clobber / 멱등
  ∩ 그 고객 reservations 중 visit_route 실값(NOT NULL & btrim<>'') 존재
fill 값 = 그 고객의 '실값 있는 가장 최근' 예약.visit_route
         (DISTINCT ON (customer_id) ORDER BY created_at DESC, id DESC — 결정적 tiebreak)
```

## 3. 착수前 READ-ONLY prod 실측 (2026-07-16, 무write)
| 지표 | 값 |
|---|---|
| customers 총 | 415 |
| customers.visit_route NULL/blank | 277 |
| **일반 백필 대상셋** (cust NULL ∩ resv 실값) | **160** |
| ├ 그중 firsttouch=dopamine | 158 (99%) |
| ├ **값 divergence (최근route ≠ 최초route)** | **0건** → recent vs first-touch 실측 동일 |
| **DOPAMINE 잔차** (firsttouch=dopamine ∩ cust NULL ∩ resv route 전무) | **0건** |
| out-of-scope (cust NULL ∩ resv 실값 전무) | 117 (파생소스 없음) |
| resv visit_route 분포 | TM 263 / (null) 165 / 지인소개 6 / 네이버 4 / 인바운드 4 / 워크인 2 |

→ **subsume 판단(잠정, DA 확정 대기)**: 일반 백필(160)이 DOPAMINE-BACKFILL(GATE_HOLD)을 실측상 완전 포함, 값 동일, 잔차 0. DA GO 시 DOPAMINE-BACKFILL은 superseded/fold 권고(planner lifecycle).

## 4. enum-safety (CHECK 위반 리스크 = 0)
customers/reservations 양 테이블 `visit_route_check` 동일 enum(mig 20260624100000):
`('TM','워크인','인바운드','지인소개','네이버','인콜')`. reservations.visit_route 실값은 정의상 이 6값 → customers 로 fill 시 CHECK 위반 불가. STEP 2 assert 로 이중 방어(비-enum 발견 시 ABORT).

## 5. no-clobber 안전성 (역오염 = 구조적 0)
`visit_route IS NULL` 행만 fill → 스태프 수동값(정의상 non-NULL) 물리적 clobber 불가. mutable 백필 중 가장 안전한 fill-on-NULL 클래스. 순소실 0·가역(RB 섹션).

## 6. 안전 4종 매핑 (SOP §3)
| SOP 게이트 | 구현 | 위치 |
|---|---|---|
| freeze by id | `_backup_t20260716_visitroute_resv` 에 id+판정근거 영속 → UPDATE 는 이 집합 JOIN | STEP 1 / 3 |
| 판정근거 스냅샷 | old(NULL)/proposed + recent 예약 source·route·created_at·id + cust created/updated | STEP 1 |
| 멱등 WHERE | `AND customers.visit_route IS NULL` → 재실행 no-op | STEP 3 |
| abort 임계 | enum(6값)·no-clobber(old NULL) 불변식 assert + frozen==target 수동대조 | STEP 2 |

## 7. 원장 무접점 + PHI (SOP §4)
- DDL 0(순수 UPDATE) → schema_migrations 무소비. supabase/migrations/ 에 넣지 않음(db-gate 아티팩트).
- _backup_* = off-git DB 테이블(보존 후 drop). tracked schema divergence 없음.
- 본 .sql/.md 리터럴 환자식별자(phone/name/RRN) 0건. freeze id 집합은 실행시 DB _backup(off-git)에만 영속.

## 8. 실행 순서 (요약)
```
G1 DA GO 수령 → (Q4 fill규칙 확정 반영)
→ STEP 0-A/0-B count 기록 → STEP 1 freeze+스냅샷 → STEP 2 assert(enum·no-clobber)
→ dry-run evidence 착지(G2) → supervisor archive-first+검수 승인(G3)
→ STEP 3 UPDATE(freeze JOIN + IS NULL) → STEP 4 사후(applied==frozen, unexpected==0, residual==0)
→ E2E spec PASS + 현장(갤탭) 2번차트 방문경로 표시 confirm → done
```
> **롤백**: RB 섹션(주석) — _backup 스냅샷 근거로 백필값 그대로인 행만 NULL 원복(사후 수동변경 보존).

## 9. E2E (db_only, exempt≠무검증)
`tests/e2e/T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL.spec.ts` — net-DB-effect 3 시나리오:
1. 과거 예약(visit_route 실값) 있고 cust NULL → backfill 후 최근 예약값 소급.
2. cust 수동값('지인소개') 존재 → **미접촉**(no-clobber).
3. cust NULL & resv 실값 전무 → **미변경**(out-of-scope, 파생소스 없음).
