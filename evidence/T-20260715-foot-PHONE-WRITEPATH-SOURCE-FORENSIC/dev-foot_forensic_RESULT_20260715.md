# T-20260715-foot-PHONE-WRITEPATH-SOURCE-FORENSIC — 비-E.164 phone write-path 규명 (READ-ONLY, mutation 0)

**작성**: dev-foot / 2026-07-15
**프로브**: `scripts/T-20260715-foot-PHONE-WRITEPATH-SOURCE-FORENSIC_probe{2,3,4,5}.mjs` (READ-ONLY, Management API, mutation 0)
**PHI off-git**: 아래 전부 카운트·PK(UUID)·경로판정만. name/phone 실값 미기재(콘솔 출력에서 redact).

---

## 결론 요약 (planner 3문항 회신)

| 질문 | 답 |
|------|-----|
| 중복판정(§13.1.A): CLOSE-R2 마스킹 클러스터와 동일 경로? | **❌ 구별 경로(독립)** — PK 교집합 0, name 비마스킹, 부수효과 0. 본 티켓 fold 안 함. |
| 4건 write 경로 규명 | **anon-EXECUTE self-checkin upsert RPC 계열**(`fn_selfcheckin_upsert_customer_resolve_v3`/v2/base)을 **정규화 없이 raw phone으로 프로그래매틱 호출** — INSERT가 `NULLIF(p_phone,'')` 그대로 저장(정규화는 dedup 비교키에만 사용). |
| Step1(DB CHECK) 배포 시 깨지나 | **FE 키오스크·dopamine 예약인입은 안전(정규화 경유). 비-FE 프로그래매틱 호출자(=4건 소스)만 fail-closed(22023)** → 그 임포트/연동의 customers 생성이 조용히 실패. |

---

## 1) 대상 4건 지문 (batch#3)

07-14 **12:11 UTC**(=21:11 KST — 티켓의 "12:11"은 UTC 표기) 12.1초 연속 배치 4건:

```
a939ec01  12:11:18.72Z  chart=F-4760  visit_type=new  name=라틴9자(비마스킹)  phone=010…11자  created_by=NULL  sim=false  resv0 chk0 hqt0
2db50bad  12:11:19.36Z  chart=F-4761  visit_type=new  name=라틴9자(비마스킹)  phone=010…11자  created_by=NULL  sim=false  resv0 chk0 hqt0
a22437a5  12:11:30.23Z  chart=F-4762  visit_type=new  name=라틴9자(비마스킹)  phone=010…11자  created_by=NULL  sim=false  resv0 chk0 hqt0
7fe8dbdd  12:11:30.81Z  chart=F-4763  visit_type=new  name=라틴9자(비마스킹)  phone=010…11자  created_by=NULL  sim=false  resv0 chk0 hqt0
```

- 공통: `created_by=NULL`, `is_simulation=false`, `is_foreign=false`, name=**로마자 9자 비마스킹**(한글 無, `*` 無), phone=**010… 11자 로컬 KR모바일(비-E.164)**.
- **부수효과 0**: reservations/check_ins/health_q_tokens 각 0건. reservations.customer_phone 동일 phone 매칭 0(예약 선행 아님).
- chart_number **연속(F-4760~4763)** = 트리거 자동발번(§3), UI 발번 아님.
- 12:11 UTC ±5m 창 customers 생성 = 정확히 이 4건(전부 created_by NULL). 정상행 혼입 0 → 단일 배치 소스.

## 2) 중복판정 (§13.1.A REDEFINITION_RISK) — **구별 경로 확정, fold 안 함**

CLOSE-R2(commit 998a263f/e79fb65e) 마스킹 클러스터와 대조:

| 축 | CLOSE-R2 클러스터(e3216e83 등) | 본 batch#3 4건 |
|----|------|------|
| PK 교집합 | e3216e83… | a939ec01/2db50bad/a22437a5/7fe8dbdd — **교집합 0** |
| name 지문 | **마스킹**(`접****1` 등 `*` 포함) | **비마스킹** 로마자 실명 |
| 부수효과 | check_in=1 + **hqt=1**(reissue_health_q_token 지문) | **resv0 chk0 hqt0**(부수효과 전무) |
| 생성 시각 | 07-14 09:34 UTC(18:34 KST) | 07-14 12:11 UTC(21:11 KST) — 2.6h 후, 별도 클러스터 |
| 오염 종류 | masked PII | **비-E.164 phone**(정규화 미경유) |

- **정합**: 마스킹-reject 가드(REPRO/CLOSE-R2)는 *masked PII* 만 거부 → batch#3(비마스킹·비-E.164)는 **직교**로 통과. 즉 CLOSE-R2 가드로는 본 오염 차단 불가. phone 소스차단 정본 = **Step1 DB CHECK**(티켓 전제와 합치).
- ⇒ **독립 규명 계속**(fold 조건 미충족). 단, 유입 함수 계열은 CLOSE-R2 열거 11경로 중 upsert-family와 동일 함수군 = **write PATH는 겹치나 오염 종류·가드 축이 직교**.

## 3) write-path 규명 — 근본원인

### customers 트리거 (probe4 §0)
| 트리거 | 함수 | 효과 |
|--------|------|------|
| `customers_chart_number_before_insert` | `assign_foot_customer_chart_number()` | **모든 INSERT에 chart_number(F-####) 자동발번** → 연속번호는 UI 증거 아님. raw INSERT도 자동 획득. |
| `trg_customers_set_phone_dummy` | `customers_set_phone_dummy()` | phone_dummy 플래그만 파생. **phone 정규화 안 함**(normPhone=false). |
| `trg_sync_customer_name` / `trg_updated_at` | — | name 미러 / updated_at. |

→ **어떤 트리거도 phone을 E.164로 정규화하지 않음.**

### 유입 함수 (probe4 §1·§4 + probe5·6·7 본문)
batch#3 지문(customers-only, checkin/resv/hqt 전무)과 일치하는 함수 = **upsert-family 3종**:
`fn_selfcheckin_upsert_customer` / `_resolve_v2` / `_resolve_v3`(=현행 resolve). 전부 SECURITY DEFINER, **anon/authenticated/service_role EXECUTE** 부여.

**핵심(정규화 부재 지점)** — v3 본문:
- `v_digits := regexp_replace(p_phone,'\D','','g')` + `82||substring(... FROM 2)` 캐논화는 **dedup 비교키(phoneCanonDigits 미러)에만** 사용("8자리 미만 비교근거 제외" 주석).
- **INSERT(line 95-102): `phone = NULLIF(p_phone,'')` = 입력 raw 그대로 저장.** 정규화 결과를 저장하지 않음.
- base/v2 동일: 각각 `p_phone` / `NULLIF(p_phone,'')` raw 저장. **3종 모두 UPDATE SET phone 없음**(phone은 최초 INSERT에서만 기록 → 정규화 갭은 INSERT VALUES 절에 국소).
- mask-reject 가드(`_fn_is_masked_pii`) present하나 batch#3 name은 비마스킹 → 통과.
- 함수가 `created_by`를 세팅 안 함 → anon 호출 시 `auth.uid()` 없어 **NULL 잔류**. `assigned_staff_role=데스크`·`customer_grade=일반`·`sms_opt_in=true`는 컬럼 DEFAULT / COALESCE 기본값.

### 발원 확정
**batch#3 = anon-EXECUTE upsert RPC(resolve_v3/v2/base)를 FE 정규화 미경유로 프로그래매틱 호출**(raw `010…` phone 전달). 근거:
1. 지문 완전일치(customers-only·부수효과0·visit_type=new·created_by NULL·raw phone).
2. **비-FE 정황**: 로마자 실명 + is_foreign=false + check_in 0(대화형 키오스크는 self_checkin_create로 check_in 생성) + 12초 4건 배치 = 사람 키오스크 아닌 **외부 연동/임포트 클라이언트**. 코드베이스(src/·EF) 내 이 RPC 호출부 미검출 → 호출자는 **별도 배포 클라이언트(foot-checkin 앱 변형/외부 API/임포트 잡)**로 추정. (호출자 앱 신원 특정은 서버측 access log 필요 — 본 CRM 레포 밖.)
3. `upsert_reservation_from_source`(예약인입 EF)는 `normalize_phone(+82…)` 적용(정규화 O) + reservation 생성 → batch#3(resv0) 아님. reissue_health_q_token = 마스킹 클러스터(hqt=1) → batch#3(hqt0) 아님.

## 4) Step1(DB CHECK) 배포 영향 예측

Step1 = `customers_phone_e164_chk`(+ `reservations_customer_phone_e164_chk`) NOT VALID re-ADD, 신규 write에 E.164 강제(DA-FINAL PIN 정식).

| 경로 | phone 정규화 | Step1 후 |
|------|------|---------|
| FE 키오스크 self-checkin | FE 클라 정규화(E.164) | ✅ 통과(무영향) |
| dopamine 예약인입 EF → `upsert_reservation_from_source` | `normalize_phone(+82…)` | ✅ 통과(무영향) |
| **비-FE 프로그래매틱 upsert RPC 호출(=batch#3 소스)** | **없음(raw `010…`)** | ❌ **INSERT가 CHECK 위반 → 22023 → RPC RAISE → 호출자 fail-closed** |

- **깨지는 것**: batch#3을 만든 그 프로그래매틱 호출자. Step1 후 그 경로의 customers 생성이 **조용히 실패**(호출자가 에러 핸들 안 하면 "신규(외국인) 환자 미등록" 현장 놀람 가능).
- **좋은 점**: 이것이 곧 **phone 소스차단**(table-level·path-agnostic). 오염 신규 유입은 Step1이 즉시 0으로 만듦 → BACKFILL 재개 선결(§0-2) 충족.
- **현장 리스크 등급**: batch#3 호출자가 (a) 폐기된 테스트 잡이면 무해, (b) 운영 중 외국인/제휴 환자 sync면 등록 실패 = 실피해. **(a/b 판별 = 호출자 앱 신원 특정 필요 → 서버 access log, 레포 밖.** planner에 에스컬레이션.)

## 5) normalize-before-write 정상화 설계 (후속 slice 권고 — 본 티켓 mutation 0)

**근본**: upsert-family가 정규화 결과(이미 계산 중인 캐논 digits)를 **저장에 반영 안 하고 raw 저장**. Fix = 저장 phone을 E.164 캐논값으로.

1. 3함수 INSERT VALUES의 `phone` 인자를 raw `p_phone` → **`v_phone_e164`** 로 교체.
   - `v_phone_e164 := CASE WHEN v_digits='' THEN NULL WHEN v_digits LIKE '82%' THEN '+'||v_digits WHEN v_digits LIKE '0%' THEN '+82'||substring(v_digits FROM 2) ELSE '+'||v_digits END`
   - 이미 함수 내 존재하는 phoneCanonDigits 로직 재사용(신규 predicate 이중정의 금지) + `+` 접두만 추가.
2. **carve-out**: DUMMY-%/placeholder(`+821000000000`)/companion(무폰)·비정규화 불가 garbage는 mangle 금지 — Step1 CHECK ACCEPT 집합과 정합. 캐논 결과가 CHECK 통과형이 아니면 pass-through(또는 명시적 처리)해 정상 신규환자 false-reject 0.
3. **효과**: 호출자가 raw `010…`을 넘겨도 RPC가 `+82…` 정규화 저장 → Step1 CHECK 통과 → **정당 호출자 fail-closed 회피 + 오염 재발 차단**. (Step1은 DB최후방벽, 본 fix는 write-path 정규화 = 이중방어. cross-CRM OSE-PHONE-AC4-WRITE-NORMALIZE 선례 동형.)
4. **게이트**: write-path 함수 CREATE OR REPLACE(db_change=true) + phone canon = DA-owned SSOT → **DA CONSULT 1차게이트 + supervisor DDL-diff**. MIG-GATE 4필드. **별도 slice**(본 포렌식과 분리, risk 재평가).

## 6) 부수 관측
- reservations.customer_phone 비-E.164 suspect = **98건**(더 오래·많이 오염). Step1의 reservations CHECK reject 대상. 예약인입 EF는 정규화 O이므로, 98건 유입 경로는 **별도 write-path**(과거 비정규화 복사/다른 RPC) — reservations-side write-path 규명은 follow-on 권고.
- customers 비-E.164 suspect 전체 = **27건**(07-14 신규 6건 = 마스킹 클러스터 2 + batch#3 4). Step1 후 신규 유입 0 기대.

## 7) mutation 0 확인
위 전부 SELECT/introspect only(pg_proc·pg_trigger·information_schema·customers/reservations/check_ins/health_q_tokens read). DDL·DML·GRANT 무접점.
