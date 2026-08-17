# T-20260818-foot-CREATEDVIA-NULL-ORIGIN-CENSUS — 결과 리포트

- **대상**: jongno-foot (obliv-foot-crm), prod `rxlomoozakkjesdqjtvd`
- **성격**: READ-ONLY census (SELECT/introspection only). write 0 · db_change 0 · 배포 산출물 0.
- **기준선**: `reservations.created_via` 컬럼 add = **2026-06-28** (마이그 `20260628160000_reservations_created_via.sql`). DEFAULT 없음(nullable), 소급 backfill = 별건(마이그 주석 명시).
- **실행**: `scripts/T-20260818-foot-CREATEDVIA-NULL-ORIGIN-CENSUS_readonly.mjs` (postgres 슈퍼유저 컨텍스트, 무RLS).

---

## 결론 (한 줄)
**created_via NULL 200건(7.3%)은 실사용 write-path 누수가 아니다.** 187건(93.5%)은 컬럼 생성 前 과거행(구조적 NULL·backfill 별건 대상), 13건(6.5%)은 테스트/시드/E2E 픽스처 행이다. **살아있는 FE/EF 신규예약 경로 중 created_via 를 NULL 로 남기는 경로는 0건.** → 부모 WRITEGATE 의 `NULL=soft` 판정이 데이터로 재확인됨.

---

## AC-1 · NULL 행 특성 census (prod 실측)

전체 reservations 2,732건 분포:

| created_via | 건수 | 비율 |
|---|---|---|
| dopamine | 1,872 | 68.5% |
| manual | 660 | 24.2% |
| **NULL** | **200** | **7.3%** |

### NULL 200건 컬럼add(2026-06-28) 前/後 분해 — 핵심 감별

| 구간 | 건수 | 비중 |
|---|---|---|
| **컬럼 생성 前** (`created_at < 2026-06-28`) | **187** | 93.5% |
| 컬럼 생성 後 (`>= 2026-06-28`) | 13 | 6.5% |

- 월별(created_at): 2026-05 = 57, 2026-06 = 142, 2026-08 = 1.
- **187건**: 컬럼이 존재하지 않던 시점의 행 → INSERT 시 컬럼 자체가 없어 NULL. 구조적·불가피. **backfill 별건** 대상.

### 컬럼add 이후 13건의 정체 (라이브 누수 여부 감별)

| source_system | visit_type | 건수 | created_at 창 | 지문 |
|---|---|---|---|---|
| NULL | returning | 8 | 2026-06-30 15:17~15:49 | `registrar_name='테스트시드'`, external_id 없음 |
| NULL | new | 4 | 2026-06-30 15:17~15:23 | `registrar_name='테스트시드'`, external_id 없음 |
| dopamine | new | 1 | 2026-08-02 23:00 | `external_id='e2e0a3c3-…-c301'` (E2E 픽스처) |

- **12건**: 모두 `registrar_name='테스트시드'`(테스트 시드), 단일 32분 창(6/30 15:17~15:49)에 스크립트성 일괄 삽입, reservation_date 는 과거로 backdate(5/20~7/1). = **시드 스크립트 직삽입 행**(앱 write-path 아님).
- **1건**: `external_id='e2e0a3c3-0000-4000-8000-00000000c301'` = **E2E 합성 픽스처**. source_system='dopamine' 인데 created_via=NULL → 현행 EF INSERT 경로로는 발생 불가(EF 는 최소 'dopamine' 세팅). 테스트 하네스 직삽입/RPC 우회로 판단.
- **실사용자 유래 라이브 NULL = 0건.**

참고(요일): 컬럼add 이후 NULL 13건 = dow 1/2/3 (월/화/수)에 국한 — 시드·E2E 창과 일치. out-of-window(부모 티켓 9%) 와 인과 연결 근거 없음(별개 축).

---

## AC-2 · created_via 미세팅 INSERT 코드경로 식별

reservations INSERT 전수 경로 감사 결과 — **현행 라이브 경로는 모두 created_via 를 세팅한다.**

| # | 경로 | 파일:라인 | created_via | 판정 |
|---|---|---|---|---|
| 1 | 캘린더 직접예약(신규/재진) | `src/pages/Reservations.tsx:434` | `MANUAL` | ✅ 세팅 |
| 2 | 예약 복사 생성 | `src/pages/Reservations.tsx:1503` | `MANUAL` | ✅ 세팅 |
| 3 | 대시보드 즉석 예약 | `src/pages/Dashboard.tsx:3375` | `MANUAL` | ✅ 세팅 |
| 4 | 차트 미니예약(재진) | `src/pages/CustomerChartPage.tsx:4774` | `MANUAL` | ✅ 세팅 |
| 5 | 차트 인라인 슬롯예약 | `src/pages/CustomerChartPage.tsx:5827` | `MANUAL` | ✅ 세팅 |
| 6 | 도파민 인입 EF 직접 INSERT | `supabase/functions/reservation-ingest-from-dopamine/index.ts:834` | `createdVia`(`?? 'dopamine'`, never null) | ✅ 세팅 |
| 7 | `upsert_reservation_from_source` RPC (self-mint) | `20260721150001_..._customer_real_phone_add.sql:238` | `v_created_via`(EF가 valid enum 전달) | ✅ 세팅 |

- FE 폴백 경로(`bodyNoOptCols`, Reservations.tsx:461)는 `is_healer_intent`/`is_trial` 만 strip → **created_via 보존**. 누락 없음.
- 체크인(`NewCheckInDialog.tsx:478`)은 reservations INSERT 아님(status UPDATE) → check_ins 테이블로 감. NULL 원천 아님.
- `cancel_reservation_from_source` RPC 는 reservations self-mint 없음(기존행 취소만). NULL 원천 아님.

### ⚠ 잠재 NULL 원천 (라이브 미발현, 구조적 리스크)
`upsert_reservation_from_source` 및 형제 RPC 전부:
```sql
v_created_via := CASE WHEN p_created_via = ANY(c_created_via_enum) THEN p_created_via ELSE NULL END;
```
= **enum 9값에 미포함된 p_created_via(및 미전달) → 조용히 NULL 착지** (CHECK 위반 500 회피용 guard). 현행 EF 는 항상 valid enum 을 넘겨 무발현이나, 향후 신규 채널/외부 caller 가 미매핑 값을 넘기면 silent-NULL 재발 가능. 컬럼 DEFAULT 부재와 결합된 **latent 원천**.

---

## AC-3 · 보정 권고 → planner (구현은 별건 후속 티켓)

1. **[P2·후속] 과거행 187건 backfill** (컬럼add 前 구간). 역추적 규칙 제안:
   - `source_system='dopamine'` → `created_via='dopamine'`
   - `source_system IS NULL AND registrar_name IS NOT NULL`(어드민 수기 흔적) → `created_via='manual'`
   - 잔여 미상 → `manual` 보수 세팅 or NULL 유지(정책 택). DA CONSULT 대상(mutable 필드 backfill SOP).
2. **[정리] 테스트/시드/E2E 13건**: `registrar_name='테스트시드'` 12건 + `external_id LIKE 'e2e%'` 1건 → 시드/픽스처 정리 대상(운영 통계에서 제외 또는 삭제). 실데이터 아님.
3. **[P2·하드닝] latent silent-NULL 차단** (택1, 별건):
   - (a) `ALTER TABLE reservations ALTER COLUMN created_via SET DEFAULT '…'` — 단, 다경로 공유 컬럼이라 default 의미 모호(비권장).
   - (b) **RPC enum-guard 폴백을 NULL→센티넬('dopamine' 등 caller 맥락 기본값)로 변경** — EF/RPC 는 인입 경로가 명확하므로 미매핑 시 NULL 대신 경로 기본값 착지 권장. (DA CONSULT — 신규 값 아님, 기존 enum 내 폴백이라 ADDITIVE 성격.)
4. **[확인] 부모 WRITEGATE `NULL=soft` 재확인**: 라이브 누수 0건 → forward-only 게이트가 신규 라이브 예약에서 NULL 을 만들 원천 없음. 본 census 는 WRITEGATE Phase2 착수를 지연시키지 않음(게이트 명시대로).

---

*READ-ONLY census 종결. supervisor QA 무대상(게이트 §). 보정 구현 필요 시 planner 가 정규 게이트로 후속 티켓 발행.*
