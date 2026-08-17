# reservations.created_via NULL 발생경로 CENSUS

- 티켓: `T-20260818-foot-CREATEDVIA-NULL-ORIGIN-CENSUS`
- 부모: `T-20260816-foot-JONGNO-OPHOURS-WRITEGATE` (Phase1 census 에서 `created_via NULL`=200건·8% 확인, 출처 미상)
- 발주: CEO DECISION `MSG-20260818-070213-u1rx` — NULL 원인 별건 규명
- 성격: **READ-ONLY 코드경로 census** (write0 · db_change0 · 배포 산출물 0)
- 대상: jongno-foot (obliv-foot-crm), Supabase `rxlomoozakkjesdqjtvd`
- **동반 데이터 census**: commit `291bd39b` (`agent-fdd-supervisor`, 2026-08-18 07:37, WRITEGATE 티켓브랜치) — prod 실쿼리(`.mjs`) 기반 카운트. 본 문서는 그 **코드경로 축 보완**(어느 INSERT 지점이 세팅/누락인지 전수 열거)이며 결론 일치.

### 데이터 census 실측(291bd39b 인용, prod ground-truth)
- NULL = **200건 / n=2732 (7.3%)** — 100% 규명됨.
- **187건(93.5%)** = `created_via` 컬럼 도입(마이그 `20260628160000`, 06-28) **이전 미수집**(backfill 미실시).
- **13건** = 2026-06-30 테스트시드 배치(12) + e2e 카나리(1) = **운영무관**.
- **post-migration 실운영 NULL = 0건**. live INSERT 경로 누락 결함 0.

---

## 결론 (요약)

**현재 LIVE 프로덕션 신규예약 write-path(FE·EF) 中 `created_via` 를 NULL 로 남기는 경로는 없다.**
9개 신규예약 INSERT 지점 전부 `created_via` 를 명시 세팅한다.
200건(8%)의 NULL 은 **활성 누수(active leak)가 아니라** 아래 2개 비활성/소급 축의 잔존이다:

1. **[주범] 소급 미수집 (pre-2026-06-28 이력행)** — `created_via` 컬럼 자체가 2026-06-28 에 **ADDITIVE·DEFAULT 없음·backfill 없음** 으로 추가됨. 그 이전 생성 예약은 전부 NULL. 컬럼 코멘트가 명시: *"NULL=미수집(소급 backfill 별건)"*.
2. **[부차] 더미/시드 스크립트 직삽입** — `scripts/*.mjs` · `scripts/lib/dummy_factory.mjs` 가 prod 에 직접 INSERT 하면서 `created_via` 를 안 넣음. 테스트 더미(더미 이름/메모 마커로 식별). 프로덕션 사용자 동선 아님.

→ 부모 WRITEGATE 의 **NULL=soft 취급 확정은 정합**. 활성 write-path 누수가 아니므로 forward 게이트를 막을 근거 아님.

---

## 산출1 — NULL 발생 축 taxonomy

| 축 | 발생시점 | write-path | created_via | 비고 |
|----|----------|-----------|-------------|------|
| A. 이력행(소급) | ~2026-06-28 이전 생성 | 당시 모든 경로 | **NULL** (컬럼 부재) | **주범**. 컬럼 additive 추가일 = 2026-06-28. 이전 행 100% NULL. |
| B. 더미/시드 스크립트 | 상시(테스트) | `scripts/*.mjs`, `dummy_factory.buildReservationRow` | **NULL** (미세팅) | 더미 이름/메모 마커(`검증임시`, `DUMMY`, dummy phone)로 식별 가능. 비-프로덕션. |
| C. RPC 비-enum 인입 | 상시(이론) | `upsert_reservation_from_source` INSERT분기 | **NULL** (enum 가드) | `v_created_via := CASE WHEN =ANY(enum) THEN val ELSE NULL`. EF 는 항상 유효값(default `dopamine`) 전달 → 실사용 발생확률 낮음. |

### 이력행(A) 역추적 힌트 (READ-ONLY, 실행은 별건)
NULL 행을 아래 컬럼으로 사후 분류 가능(백필 설계용 참고):
- `created_at < '2026-06-28'` → 소급 이력(축 A) 거의 확실.
- `source_system = 'dopamine'` AND created_via NULL → 도파민 인입인데 컬럼 추가 前 생성 → 백필 시 `dopamine` 추정.
- `source_system IS NULL` AND 더미마커 無 → 어드민 수기 이력 → 백필 시 `manual` 추정.
- 더미마커(이름/메모/phone) 有 → 축 B(시드) → 백필 제외 또는 test 태깅.

> ※ 부모 census 의 out-of-window 9%(≈월4.5)는 `created_via` 축과 직교(방문시각 축) — 본 census 범위 밖. NULL 과 인과 아님.

---

## 산출2 — 신규예약 INSERT 코드경로 전수 (created_via 세팅 여부)

### ✅ created_via 를 명시 세팅 (NULL 누수 아님) — 9지점

| # | 위치 | 경로 | 세팅값 |
|---|------|------|--------|
| 1 | `src/pages/Reservations.tsx:434` (createReservationCanonical 본체 445) | 어드민 캘린더 직접예약(신규/재진) | `manual` |
| 2 | `src/pages/Reservations.tsx:461` (동일 함수 옵셔널컬럼 strip 재시도) | 위 경로 PGRST204 내성 재삽입 | `manual` (bodyNoOptCols 승계) |
| 3 | `src/pages/Reservations.tsx:1503` (insert 1484) | 키보드 복사 생성 | `manual` |
| 4 | `src/pages/Dashboard.tsx:3375` (insert 3362) | 대시보드 미니예약 | `manual` |
| 5 | `src/pages/CustomerChartPage.tsx:4774` (insert 4761) | 고객차트 예약생성 A | `manual` |
| 6 | `src/pages/CustomerChartPage.tsx:5827` (insert 5814) | 고객차트 예약생성 B | `manual` |
| 7 | `supabase/functions/reservation-ingest-from-dopamine/index.ts:834` (insert 877, rsvPayload) | 도파민/외부 신규 인입 | `createdVia` (source_system 매핑, default `dopamine`) |
| 8 | 동 EF `p_created_via:636` → RPC `upsert_reservation_from_source` | 리스케줄/edit ON CONFLICT (기존행) | `createdVia` (신규INSERT 아님, COALESCE 보존) |
| 9 | (참고) 동 EF 직삽입 raceRsv 재조회 | 23505 race 재사용 | 신규 write 아님 |

> `src/lib/createdVia.ts` SSOT = 9값 enum(`manual/dopamine/aicc/naver/meta/inbound/selfbook/kakao/walkin`). FE 는 전부 `RESERVATION_CREATED_VIA.MANUAL` 상수 사용(별칭 없음).
>
> **291bd39b("live INSERT 경로 6개")와 정합**: 위 9행 中 신규-row INSERT surface 는 #1·3·4·5·6·7 = **6개**(전부 세팅). #2 는 옵셔널컬럼 strip 재시도(동일 경로), #8 은 ON CONFLICT UPDATE(신규INSERT 아님), #9 는 23505 race 재조회(신규 write 아님) — 카운트 제외.

### ❌ created_via 미세팅 (NULL 원천) — 프로덕션 아님

| 위치 | 경로 | 성격 |
|------|------|------|
| `scripts/lib/dummy_factory.mjs:125` buildReservationRow | 공용 더미 팩토리 — 반환 row 에 created_via 키 없음 | **테스트 더미** |
| `scripts/*.mjs` (seed_*/insert_*/T-*-DUMMY-*) 다수 | prod 직삽입 시드 — created_via 미포함 | **테스트 더미** |

> `tests/e2e/*.spec.ts`, `tests/fixtures/index.ts` 의 insert 는 CI/로컬 테스트 DB 대상 → prod NULL 무관.

### 판정: 활성 LIVE 프로덕션 신규예약(FE·EF) 경로에 created_via NULL 누수 = 0.

---

## 산출3 — 보정 권고 (planner 취합, 구현은 후속 별건 티켓)

| # | 권고 | 대상 | 등급 | 게이트 |
|---|------|------|------|--------|
| R1 | **이력행 소급 backfill** — 산출1 역추적 힌트 규칙으로 `created_at<2026-06-28` NULL 행 보정(dopamine/manual 추정). | prod 데이터 정정 | P2 | data-correction SOP + DA CONSULT(mutable 필드 backfill). db_change=data-only. |
| R2 | **`dummy_factory.buildReservationRow` 하드닝** — 반환 row 에 `created_via` 명시(예: `manual` 또는 test sentinel) → 향후 시드가 NULL 안 남김. | `scripts/lib/dummy_factory.mjs` | P2 | 코드 1줄. 테스트 스크립트 격리이므로 배포영향 0. |
| R3 | (선택) **forward 가드** — backfill(R1) 완료 후 컬럼 DEFAULT `'manual'` 또는 NOT NULL 검토. | DB 스키마 | P2 | **DA-gated**(신규 제약). 권고만 — 본 census 착수 아님. |

> R1~R3 모두 **본 census 범위 밖 구현**. 규명·권고까지가 본 티켓(AC-3). 실보정은 정규 게이트로 별건 발행.

---

## AC 대사

- **AC-1** (NULL 행 특성 census, write0·db_change0): ✅ 산출1 taxonomy + 역추적 힌트.
- **AC-2** (미세팅 INSERT 코드경로 식별): ✅ 산출2 — 활성 9지점 전부 세팅 / 더미 시드만 미세팅.
- **AC-3** (보정 권고 → planner, 구현 별건): ✅ 산출3 R1~R3.

**게이트**: READ-ONLY census → supervisor QA 무대상. 부모 WRITEGATE non-blocking(NULL=soft) 정합 재확인. 보정 구현은 후속 티켓.
