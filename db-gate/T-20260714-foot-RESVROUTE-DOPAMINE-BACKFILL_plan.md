# T-20260714-foot-RESVROUTE-DOPAMINE-BACKFILL — backfill dry-run 플랜 (GATE_HOLD)

> **상태**: SOP 선행 저작 완료(2026-07-14 16:0x). **실행 미착수** — 아래 게이트 전부 GREEN 전 PROD 실행 금지.
> **작성**: dev-foot. **실행/게이트**: supervisor(DDL/DML-diff + rowcount-verify).
> **DB**: rxlomoozakkjesdqjtvd (obliv-foot-crm PROD).
> **DA GO**: CONSULT-REPLY MSG-20260714-155231-b3ns Q3 — DESTRUCTIVE-class DML·LOW severity·**대표게이트 불요**·no-clobber 레인 전제(DA GO + supervisor diff).

## 0. 목적 (한 줄)
forward 시딩 EF(부모 T-…-DOPAMINE-SEED, `b128c2ee` 라이브)가 **신규분만** seed → 그 이전 생성된 **도파민 최초접점** 고객의 `customers.visit_route` NULL 잔존분을 소급 fill. 2번차트 방문경로 공란 해소.

## 1. 착수 선결 게이트 (전부 GREEN 전 실행 금지 — 위반 시 supervisor qa-fail)
- [ ] **G-A (부모 field-soak)**: 부모 forward EF field-soak confirm **2026-07-15 15:04** 완료. (ticket 실행전제 #1 · 라이브 EF와 번들 금지)
- [ ] **G-B (소스닫힘 포렌식, SOP §0-2)**: `backfill.sql` STEP 0-C = **0**. EF live 이후 'dopamine 최초접점 & visit_route NULL' 신규 row 0건. `>0`이면 소스 미차단 → **BLOCK**, planner 재-CONSULT(DA GO 자동 dead-letter).
- [ ] **G-C (파라미터 확정)**: `:source_closed_at` = 실제 field-soak confirm 시각(tz-aware `+09`)으로 치환. STEP 0-A `target_rows`를 `:expected_max`로 기록.
- [ ] **G-D (supervisor DML-diff)**: STEP 3 UPDATE diff + STEP 1 freeze count 사람 confirm. (ticket #5)

## 2. 대상셋 지문 (SOP §2, ticket 실행전제 #2 — forward EF 미러)
```
최종 대상 =
    customers.visit_route IS NULL                                  -- G0 no-clobber / 멱등
  ∩ 고객의 '생성(최초)' 예약.source_system = 'dopamine'            -- 최초접점 = 도파민
  ∩ 최초예약.visit_route ∈ ('TM','워크인','인바운드','지인소개')    -- EF visitRouteLanded 미러
  ∩ 최초예약.created_at ≤ :source_closed_at (tz-aware)             -- §0-2 버그윈도우 상한
```
- **최초예약 결정**: `DISTINCT ON (customer_id) … ORDER BY created_at ASC, id ASC` (결정적 tiebreak).
- **⚠ 오분류 방지(ticket #2)**: "아무 dopamine 예약 1건" ≠ 대상. **최초접점**이 dopamine 인 고객만. 오가닉 최초접점 + 이후 dopamine 재예약 고객은 **TM 오라벨 금지** → STEP 0-B `organic_firsttouch_excluded`로 제외분 계량·감사.
- **fill 값**: 최초 dopamine 예약의 `visit_route`(도파민 tier-1 push는 항상 'TM'). count 단독 라벨이 아니라 per-customer 최초예약 실값 미러.

## 3. 안전 4종 매핑 (SOP §3)
| SOP 게이트 | 구현 | 위치 |
|---|---|---|
| freeze by id VALUES | `_backup_t20260714_resvroute_dopamine` 테이블에 id 집합 영속 → UPDATE는 조건 재-SELECT 아닌 이 집합에 JOIN | STEP 1 / STEP 3 |
| 판정근거 스냅샷 | old/proposed + 최초예약 source·route·created_at + customer created/updated | STEP 1 |
| 멱등 WHERE | `AND customers.visit_route IS NULL` → 재실행 no-op | STEP 3 |
| abort 임계 | frozen_rows vs `:expected_max` + enum·no-clobber 불변식 assert | STEP 2 |

## 4. no-clobber 안전성 (역오염 = 구조적 0)
`visit_route IS NULL` 인 행만 fill → 스태프 수동값(정의상 non-NULL)은 물리적으로 clobber 불가. mutable 필드 백필 중 **가장 안전한 fill-on-NULL 클래스**. §2 'override 없음' 신호는 IS NULL 로 자동 충족. 순소실 0·가역(RB 섹션).

## 5. 컬럼 가드 (SOP §2-S 실존 검증 — 완료)
- `customers.visit_route` (CHECK enum 4값, NULL 허용) — 실존 ✅ (mig 20260610110000 등)
- `reservations.{customer_id, source_system, visit_route, created_at, id}` — 전부 실존 ✅
- 파생 동기필드 없음: `visit_route`는 customers 단일 소유. `reservations.visit_route`는 **별도 축**(예약경로) — 미접촉(G1/G3).

## 6. 원장 무접점 + PHI 라우팅 (SOP §4, ticket #4)
- **DDL 0** (순수 UPDATE) → `schema_migrations` 무소비. supabase/migrations/ 에 넣지 않음(본 db-gate 아티팩트).
- 스냅샷 = `_backup_*` 네임스페이스 테이블(보존 후 drop) — tracked schema divergence 없음.
- **PHI**: 본 .sql/.md 에 리터럴 환자식별자(phone/name/RRN) **0건**(로직 only). freeze id 집합은 실행시 DB `_backup` 테이블(off-git)에만 영속. 운영 dump/리스트를 git-tracked 파일에 평문 기재 금지(phi_redaction_standard §1). 워킹 아티팩트엔 위치·카운트만.

## 7. 실행 순서 (요약)
```
G-A field-soak confirm(07-15 15:04) 대기
→ :source_closed_at 치환, STEP 0-A/0-B 실행 → target/excluded count 기록
→ STEP 0-C(G-B 소스닫힘 포렌식) = 0 확인 (아니면 BLOCK)
→ STEP 1 freeze+스냅샷, STEP 2 assert (frozen==target)
→ supervisor DML-diff confirm(G-D)
→ STEP 3 UPDATE (freeze JOIN + IS NULL)
→ STEP 4 사후 rowcount(applied==frozen, unexpected==0)
→ E2E spec PASS + 현장(갤탭) 2번차트 방문경로 표시 confirm → done
```
> **롤백**: RB 섹션(주석) — `_backup` 스냅샷 근거로 건드린 행만 NULL 원복(백필값 그대로인 행만).

## 8. E2E
`tests/e2e/T-20260714-foot-RESVROUTE-DOPAMINE-BACKFILL.spec.ts` — 시나리오 3종(net-DB-effect 모델):
1. 과거 TM(dopamine 최초접점) 고객 → backfill 후 visit_route='TM' 소급.
2. 오가닉 최초접점(+이후 dopamine 예약) → **미오염**(TM 오라벨 안 됨).
3. 스태프 수동값(예: '지인소개') → **미접촉**(no-clobber).
