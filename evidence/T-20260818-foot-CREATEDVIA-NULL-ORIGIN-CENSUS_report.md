# T-20260818-foot-CREATEDVIA-NULL-ORIGIN-CENSUS — created_via NULL 발생경로 census 결과

- **분류**: READ-ONLY census (write0 · db_change0 · 배포산출 0)
- **대상**: obliv-foot-crm / prod Supabase `rxlomoozakkjesdqjtvd` / `reservations` 전량 (jongno-foot 단일 clinic)
- **부모**: T-20260816-foot-JONGNO-OPHOURS-WRITEGATE (Phase1 NULL=200건·출처미상 → 본 census 분리)
- **실행일**: 2026-08-18
- **census 스크립트**: `scripts/T-20260818-foot-CREATEDVIA-NULL-ORIGIN-CENSUS.mjs` (SELECT-only)

---

## 산출1 — created_via NULL 행 특성 집계 (prod 실측)

전체 reservations = **2,732행** (전량 페이지네이션, 1000행 캡 회피). 전부 jongno-foot.

| created_via | 건수 | 비율 |
|---|---|---|
| dopamine | 1,872 | 68.5% |
| manual | 660 | 24.2% |
| **NULL** | **200** | **7.3%** |

→ 부모 Phase1 census(NULL=200·8%)와 정합.

### NULL 200행 discriminator 분해

| 축 | 결과 |
|---|---|
| source_system | NULL(수기추정) **199** / dopamine **1** |
| external_id | NOT NULL **1** / NULL **199** |
| created_at vs 컬럼도입일(2026-06-28) | **pre-migration 187** / post-migration **13** |
| created_at 월별 | 2026-05: 57 · 2026-06: 142 · 2026-08: 1 |
| visit_type | new 109 / returning 91 |
| 예약요일 | 화 92·월 24·수 22·금 21·목 21·일 13·토 7 (화 편중=시드 배치 아티팩트) |
| 예약시각 | 10시 39·15시 25·11시 25·14시 24 등 광범위 분산 |

### ★ 핵심: post-migration NULL 13행 = 100% 테스트/시드 데이터

| ca | cust | registrar | src | 판정 |
|---|---|---|---|---|
| 2026-08-02 | AC3취소카나리 | - | dopamine (ext=e2e0a3c3…) | **e2e 카나리** |
| 2026-06-30 ×12 | 테스트경과01/02/03/분석 | **테스트시드** | - | **시드 배치** (15:17~15:49 clustered) |

→ 2026-06-28 컬럼 도입 이후 생성된 **실 운영 예약 中 created_via NULL = 0건**. 13행 전부 테스트/시드 스크립트가 `createReservationCanonical` 우회 직접 INSERT.

---

## 산출2 — created_via 미세팅 INSERT 코드경로 식별

`src/lib/createdVia.ts` SSOT(9값 enum) 대비 전(全) reservations INSERT 진입점 감사:

| # | 경로 | 파일:라인 | created_via | 판정 |
|---|---|---|---|---|
| 1 | 캘린더 신규/재진 단일소스 | `Reservations.tsx:434` (`createReservationCanonical`) | `MANUAL` 명시 | ✅ 세팅 |
| 1' | 위 PGRST204 폴백 재시도 | `Reservations.tsx:460` (`bodyNoOptCols`) | is_healer_intent/is_trial만 strip, **created_via 보존** | ✅ 세팅 |
| 2 | 복사/붙여넣기 예약 | `Reservations.tsx:1503` | `MANUAL` 명시 | ✅ 세팅 |
| 3 | 대시보드 빠른예약 | `Dashboard.tsx:3375` | `MANUAL` 명시 | ✅ 세팅 |
| 4 | 고객차트 미니/인라인예약 | `CustomerChartPage.tsx:4774 / 5827` | `MANUAL` 명시 | ✅ 세팅 |
| 5 | 도파민 push 신규 INSERT | EF `reservation-ingest-from-dopamine/index.ts:834` | `createdVia`(source 매핑, 미지=`dopamine` default) | ✅ 세팅 |
| 6 | reschedule/edit/cancel upsert | RPC `upsert_reservation_from_source` | `v_created_via` = `CASE WHEN p_created_via=ANY(enum) THEN … ELSE **NULL** END`; ON CONFLICT=`COALESCE(EXCLUDED,기존)` never-downgrade | ⚠ **잠재 NULL 벡터** |

- 그 외 EF(dopamine-callback / dopamine-visitcall-receiver / checkin-visited-fire)의 `reservations` 접근 = **전부 SELECT/UPDATE**, INSERT 아님 → NULL 무관.
- **live 운영 INSERT 경로 6개 中 실 NULL 산출 경로 = 0개.** 경로 #6(RPC)만 `p_created_via`가 NULL/비-enum일 때 NULL로 착지하나, **현행 유일 호출자**(EF reschedule, line 636 `p_created_via: createdVia`)는 **비-NULL enum 전달 + 기존행 대상만** → live 미발화. 신규 호출자가 p_created_via 없이 첫-external_id로 호출하면 NULL 착지(잠재 리스크).

### NULL 200건 근본원인 (규명 완료)

1. **187건 (93.5%)** = `created_via` 컬럼 도입(migration `20260628160000`, 2026-06-28) **이전 생성 행**. 컬럼이 nullable·DEFAULT 없이 ADDITIVE 추가되었고 **소급 backfill 미실시**(migration 주석 명시: "NULL=미수집(소급 backfill 별건)"). → 구조적 영속 NULL, live 코드 결함 아님.
2. **13건** = 2026-06-30 테스트 시드 배치(12) + e2e 카나리(1). 시드/테스트 스크립트가 canonical FE 헬퍼 우회 직접 INSERT. → 운영 무관.

---

## 산출3 — NULL 제거 보정 권고 (→ planner, 구현은 별건 티켓)

1. **[권고A·소급 backfill 별건 티켓]** pre-migration 187행 backfill. source_system 기반 휴리스틱: `source_system='dopamine' AND external_id IS NOT NULL → 'dopamine'`, else `'manual'`. 실측상 199/200이 source_system NULL이라 사실상 전량 `'manual'` 착지. **DB write → data-architect CONSULT + supervisor MIG-GATE 선행**(db_change=true). NULL=soft 확정(부모)이라 P2 후순위 무방.
2. **[권고B·테스트 위생]** 향후 NULL census는 테스트 데이터(`registrar_name='테스트시드'` · e2e 카나리 `source_system='dopamine' AND external_id LIKE 'e2e%'`) 제외 필터 적용 — 13건은 운영 NULL 아님. 시드 스크립트에 created_via 세팅 추가(경미).
3. **[권고C·잠재 벡터 방어, 선택]** RPC `upsert_reservation_from_source`의 `v_created_via` NULL 폴백을 안전 기본값으로 하드닝하거나, 신규 호출자 추가 시 `p_created_via` 필수 전달을 계약으로 명문화. 현재 live 미발화라 긴급도 낮음(P2).

**결론**: created_via NULL 200건은 (i) 컬럼 도입 前 미수집 187 + (ii) 테스트/시드 13 으로 100% 규명. **현행 운영 INSERT 경로에는 created_via 누락 결함 없음.** 신규 예약 생성 시 NULL 재발 없음(테스트 데이터 제외). 유일 잔여 = 과거행 backfill(권고A, 별건·선택).
