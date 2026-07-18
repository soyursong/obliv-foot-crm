# DRY-RUN REPORT — T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL

- **DB**: rxlomoozakkjesdqjtvd (obliv-foot PROD, jongno-foot)
- **Mode**: SELECT-only, write 0 (APPLY는 supervisor DML-diff 승인 게이트#3 후 별도)
- **SOP**: Cross-CRM Data-Correction Backfill SOP 게이트#2
- **DA CONSULT**: MSG-20260716-142052-zip4 (**CONDITIONAL-GO**) — 정본 da_replies/DA-20260716-…md
- **runner**: `scripts/T-20260716-…_dryrun.mjs` (read-only)
- **APPLY sql**: `db-gate/T-20260716-…_backfill.sql` (**first-touch 정정본** + apply-직전 재검증 abort STEP 2.5)
- **evidence json**: `scripts/T-20260716-…_dryrun.out.json` — ⚠ **off-git**(freeze rows 에 customer_id 포함 → SOP §4 "count·위치만" 준수, `*dryrun*.json` ignore)

## ⚠ 재실행 갱신 (2026-07-16, zip4 CONDITIONAL-GO 반영)
초판(commit 9b58275b, 15:05) 대비 **소스가 live-drift**: forward-sync EF(ALWAYSYNC 15efde96, soak GREEN)가
신규 예약분을 계속 seed → NULL 셋이 축소 중. zip4 Q2 "실측(now)≠apply(later)" 경고와 정확히 일치.
∴ 아래 count 는 스냅샷값이며, **freeze 는 APPLY 직전 fresh 재산출**해야 한다(APPLY sql STEP 1 = fresh, STEP 2.5 = drift·sliver abort).

| 항목 | 초판(07-16 15:05) | 재실행(07-16 19:34) | 재검증(07-18 deploy-ready) | 비고 |
|---|---|---|---|---|
| customers.visit_route NULL 총계 | 272 | 269 | **267** | forward-sync 로 지속 감소 |
| 대상 universe (NULL/'' ∩ EXISTS routed resv) | 155 | 152 | **138** | 하향 drift |
| **Set A (PRIMARY, DA-strict first-touch)** | 154 | 151 | **137** | 전량 TM→TM |
| out-of-scope (NULL & 소스 route 전무) | 117 | 117 | **129** | universe 이탈분 흡수 |

### ✅ 07-18 deploy-ready 재검증 (count LIVE-DRIFT benign, 구조 불변)
- **재실행 freeze = SetA 137건** (전량 TM→TM). 초판 154 → 151 → **137** 지속 하향 = forward-sync EF(15efde96)가 NULL universe 자연 충전 = zip4 Q2 "실측(now)≠apply(later)" 정합. **고정 정수 anchor 금지** — freeze 는 APPLY 직전 STEP 1 fresh 재산출이 정본.
- **불변식 전부 GREEN 유지**: no-clobber 0 · first-touch vs most-recent divergence 0 · DOPAMINE sliver 0 · out-of-CHECK-domain 0 · divergence B−A = 1 (동일 cust `2997fc1c…`, 정당 out-of-scope 유지).
- **APPLY 러너 live-health 확인**: 게이트#3 코드-차단(승인 flag 부재 시 refuse) 정상 + `--dry` 리허설(승인 flag+`--dry`) = freeze 137 재도출·drift-check clean(mismatch 0/out-of-domain 0/new 0)·archive-first 작성·UPDATE 미실행 확인.
- 판정(SetA/first-touch)·매핑·AC4 RULE 3항 전부 불변. deploy-ready → 게이트#3(supervisor 백필승인) 대기.

### ✅ 07-18 APPLY 실행 완료 (게이트#3 GRANTED · MSG-20260718-224925-4wrk)
- **STEP1 fresh 재산출**: frozen SetA 137건 재도출 (전량 TM→TM). drift-check clean — out-of-domain 0 / value_mismatch 0 / filled-since-dryrun 0 / new-eligible-not-frozen 0.
- **UPDATE 실적**: 137 row 변경 (기대 137 일치). BEFORE `NULL=267, TM=163` → AFTER `TM=300(+137), NULL=130`.
- **POST-VERIFY (AC4 RULE 3항) PASS**: (a) frozen∩still-NULL 잔존 0 ✅ (b) cust `2997fc1c…` 정당 NULL 유지 ✅ (c) no-source 고객 불변(NULL 130 = universe 이탈분 + out-of-scope) ✅.
- archive-first 스냅샷 `_APPLY_archive.json`(mode=APPLY, PHI off-git) 기록. ROLLBACK 짝 = `_rollback.mjs`(archive 기반).
- Pass1 hard-close 조건 충족 → DOPAMINE-BACKFILL(Pass2) 진행 가능. 현장(김주연 총괄) confirm 요청 = responder 경유.

### ✅ 07-18 gate#4 재확인 (DLQ 오분류 정정 후 · PUSH MSG-20260718-235125-83eh)
- **경위**: gate#3 GRANT(4wrk, 22:49)으로 status→deploy-approved 되자 자동 deploy-executor(foot-fast lane)가 pure-DML backfill 을 코드배포로 오인수 → no_deploy_commit 3회 실패·DLQ. planner 정정(자동 lane 회수·수동 APPLY 라우팅). **DML 자체는 22:49 APPLY 에서 이미 정상 랜딩**(위 섹션).
- **수동 APPLY 러너 재실행**(`--i-have-supervisor-backfill-approval`, STEP1 fresh 재산출): frozen SetA 137 재도출 → **frozen∩still-NULL = 0** (전량 이미 TM 채워짐, 멱등 no-op·double-write 0). drift-check clean(out-of-domain 0/value_mismatch 0/new-eligible 0). `_APPLY_archive.json` mode=APPLY·target_count=0·rows=[] 재스탬프.
- **POST-VERIFY (AC4 RULE 3항) live prod 재확인 PASS**: (a) frozen 137 현 분포 = **TM×137**, frozen∩still-NULL 잔존 **0** ✅ (b) cust `2997fc1c…` = **`<NULL>`** 정당 유지 ✅ (c) no-source 고객 = 130 NULL 불변(still_eligible_firsttouch_null = **[]**) ✅.
- **현 prod 분포**: `TM=300 · <NULL>=130 · 지인소개=15 · 워크인=9 · 인바운드=6 · 네이버=4` (총 464) — 22:49 APPLY AFTER 와 정합. ⇒ **gate#4 완료**, status→deployed(deploy_manual_apply 경로, 자동 executor 미경유). 현장 confirm = responder 경유(김주연 총괄, ch C0ATE5P6JTH).

## 대상 정의 (AC1 / zip4)
- 물리 대상 = `customers.visit_route` **단독** fill-on-NULL (reservations **절대 미변경** — 소스, read-only).
- 소스 = `reservations.visit_route` (한글 enum, **≠source_system**).
- 매핑 = identity + `인콜→인바운드` 정규화 (A안). NULL/''/미지정 → skip.
- fill 규칙 = **first-touch (created_at ASC)** — zip4 Q4 확정. most-recent(DESC) 반려.
  - forward-fill 금지: **최초(절대 첫) 예약 route 가 NULL 이면 out-of-scope**(방치). 후행 route 로 소급 금지.

## 대상셋 (매핑 적용, 현재 재실행값)
| Set | 규칙 | count | breakdown |
|---|---|---|---|
| **A (PRIMARY)** | DA-strict first-touch (최초예약 route; NULL→out-of-scope, forward-fill 금지) | **151** | TM→TM 151 |
| B | AC2 line107 "최초 NON-NULL route 예약" (forward-fill) | 152 | TM→TM 152 |
| C (참고, 폐기규칙) | most-recent DESC | 152 | TM→TM 152 |

- **불변식 ledger**: `SetA(151) + forward-fill-gap(1) + no-route(117) = NULL 총계(269)` ✓
- **naver/인콜/워크인/지인소개 매핑 발화 = 0건.** 해당 경로 고객은 이미 `visit_route` 보유(대상셋 밖). ⇒ 실질 **전량 TM→TM**.
- provenance: SetA 151 中 최초예약 source_system = dopamine 150 + `<NULL>` 1 → 전량 route='TM' (pre-sync TM/dopamine 유입).
- mapped 값 CHECK 도메인(TM/워크인/인바운드/지인소개/네이버/인콜, prod 실측 6값 — '공홈' 미배포) 위반 = **0** ✓

## 안전 검증 (zip4 착수 GO 조건)
| 항목 | 결과 |
|---|---|
| no-clobber (기존 non-null 대상 포함 / old-value non-NULL) | **0** ✓ (customers.visit_route='' 실측 0건 → IS NULL 가드로 충분) |
| **divergence first-touch vs most-recent** (fold 전제, zip4 Q1/Q4) | **0** ✓ (fill 값 동일 → fold-safe) |
| **DOPAMINE 잔차 sliver** (zip4 Q2: firsttouch=dopamine ∩ cust NULL ∩ resv route 전무) | **0** ✓ (단일 pass 종결, 재-CONSULT 불요) |
| Q3 fan-out (reservations-grain COUNT GROUP BY customers.visit_route 뷰) | **없음** ✓ (Closing.tsx=customer-grain 표시축) |
| mapping out-of-CHECK-domain | **0** ✓ |
| forward-fill gap (out-of-scope, NULL 유지) | 1 (cust `2997fc1c…`: 최초 route NULL·후행 TM → DA 조건#1상 정당 NULL 잔존) |

## SPEC TENSION — ✅ RESOLVED (planner MSG-20260716-150653, SetA 채택)
- DA 조건#1(forward-fill 금지)=SetA ↔ AC2 line107(최초 NON-NULL)=SetB, 차이 1행(cust `2997fc1c…`).
- planner 판정 = **SetA(DA-strict) 채택** = dev-foot 권고. SetB forward-fill 은 최초 유입경로 날조 → qa-fail.
- AC4 "잔존건 0" = **SetA 대상셋에 한해 성립**. forward-fill gap 1행 + no-route 117행은 설계상 NULL 유지(결함 아님).

## freeze (PRIMARY = Set A, DA-strict) — apply-직전 fresh 재산출
- off-git `_dryrun.out.json > freeze_primary_DA_strict.rows` = `[{customer_id, src_route, new_visit_route}]`.
- ⚠ 위 freeze 는 스냅샷. **APPLY 시점에 STEP 1 로 fresh 재산출**(stale 재사용 금지, zip4 Q2 / RESVDATE-SHIFT 교훈).
- apply-time 앵커: freeze-by-id JOIN + `WHERE visit_route IS NULL` 멱등 + STEP 2.5 drift/sliver abort(tz-aware).

## 잔여 게이트
1. ✅ 게이트#0/#1/#1.5 CLOSED (reporter 매핑·DA CONSULT·fill-rule first-touch).
2. ✅ **게이트#2 dry-run evidence — 본 리포트 (완료·재실행 갱신)**. first-touch/freeze/BEFORE-AFTER/no-clobber/divergence0/sliver0 실증.
3. ✅ 게이트#3 **supervisor 백필 승인 GRANTED** (2026-07-18, DML-diff + archive-first + 원장 무접점 감사 통과).
4. ✅ 게이트#4 **APPLY 완료** (137 rows 랜딩 07-18 22:49 · DLQ 정정 후 멱등 재확인 target 0) → **post-verify AC4 RULE 3항 PASS** → status deployed. 현장 confirm = responder 경유(잔여).
