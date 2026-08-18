# ADDENDUM — code-trace + 라이브 재확인 (T-20260818-foot-NEWRESV-CUSTCREATE-STMT-TIMEOUT)

작성: dev-foot / 2026-08-18 (KST 15:4x) · read-only(무변경) · probe = `scripts/T-20260818-foot-NEWRESV-CUSTCREATE-STMT-TIMEOUT_probe.mjs`
(자매 티켓 T-...-NEWRESV-CUSTOMER-CREATE-STATEMENT-TIMEOUT 진단(DIAGNOSIS.md)의 코드축 보강 + 라이브 재확인)

## 1. create 핸들러 정확 추적 — 57014 던지는 쿼리 특정
`src/pages/Reservations.tsx` `handleCreateReservationFromPopup` (신규 예약 생성 콜백, 단일소스):
- **L1725-1730 중복체크 조회**: `customers.select('id').eq('clinic_id',…).eq('phone',normalized).maybeSingle()`
  = **exact-match** → `idx_customers_clinic_phone` UNIQUE(clinic_id,phone) btree 서빙. **fuzzy/ILIKE 아님 → pg_trgm 무관.**
- **L1734-1743 INSERT**: `customers.insert({clinic_id,name,phone,visit_type}).select('id').single()`
- **L1762 토스트**(`고객 생성 실패: ${error.message}`)는 이 **INSERT 가 23505 아닌 코드로 실패**할 때만 발화 → 현장 57014 = **customers INSERT statement 자체가 타임아웃**(planner 분기 **(c)**). (a)중복체크·(b)cross-CRM 힌트 아님, (d)예약 후속 아님.

## 2. 라이브 재확인 (15:4x, prod rxlomoozakkjesdqjtvd)
- customers = **2355행 / 2256 kB**. 인덱스 완비(idx_customers_clinic_phone UNIQUE, idx_customers_phone 등 13개). **인덱스 부재 0.**
- pg_stat_statements 1위 = `storage.search(...)` **3,552,157 calls / 1,651,799s / 465ms** = 2위(customers 85ms)의 **7.7배**. 포화 지속.
- 라이브 active: storage.search 동시 다수(3.1s·1.4s·0.9s·0.5s 등 >1s 다발). `lock_waits=0`.

## 3. 축 판정 (planner 게이트 회신)
- **RC = shared-infra DB compute 포화(storage.search 폭주) → authenticated 8s statement_timeout 초과 → tiny(2355행) customers INSERT 취소.** 인덱스/락/트리거 문제 아님.
- **자매 CUSTMGMT-SEARCH-FAIL 인덱스축(pg_trgm GIN)과 동일 여부 = 아니오(별클래스).** create-path 중복체크는 exact-match(UNIQUE btree 기서빙)이고, 57014는 INSERT가 compute starvation 으로 취소된 것. **pg_trgm co-deploy 로 본 P0 미해소.**
- **즉시 해소 = infra(dev-meta)**: storage.search 부하완화 / Supabase compute upsize / call-driver 억제. **foot 레포 커밋으로 즉시 해소 불가. db_change=FALSE 유지(customers DDL 불요) → MIG-GATE/DA GO 대상 아님.**
- **지속 완화(별건 P1)**: foot FE `.list()/.search()` 호출 감축(캐시 / DB manifest). hotfix 아님.
- DA enz5(pg_trgm) P0 상향은 **CUSTMGMT-SEARCH-FAIL(read-side 검색)** 에는 유효하나 **본 P0(create INSERT timeout)는 그것으로 안 풀림** — 별 축.
