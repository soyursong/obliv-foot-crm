# Foot TEST-DUMMY-CLEANUP — C2 CLEAR Harness Self-Audit (Path A, READ-ONLY)

Ticket: T-20260721-foot-TEST-DUMMY-CLEANUP (AC-2) · Reply-to: data-architect (DA 3차 verify)
Author: dev-foot · Date: 2026-07-21 KST
Trigger: DA 2차 adjudication → **apply-GO WITHHELD (C2 fail-closed)** → C2 CLEAR 경로 A(하네스 자기감사) 지정.
Method: **엔지니어링 자기감사 — 코드경로 역추적 + 이름내장 `Date.now()` 디코드 + CI cron 상관 + chart-alloc RPC 규명.** 프로덕션 DB 재조회 없음(freeze는 commit 15c3adfe / off-git 스냅샷에서 PK 고정). **No DELETE. No write. 원장 무접점.**
Predecessor: `DA-20260721-foot-TEST-DUMMY-CLEANUP-GATE_census.md` (commit 15c3adfe, Phase-1 census).

---

## 결론 (요약)

**C2 CLEAR 경로 A 충족 — 미귀속(unattributed) = 0行.** freeze-9 customers + 6 check_ins 전량이 야간 Daily Build E2E 픽스처(`tests/functional/kanban-drag.spec.ts`)에 **결정적으로 역추적**됨. 엔지니어링 확증으로 충분(§C2-CLEAR (A)) → **현장확인 불요.** 실 chart_no F-####는 임상 encounter가 아니라 **하네스가 프로덕션 chart-alloc 트리거를 호출해 소비한 시퀀스 값**임을 코드로 확증(DA 2차 §C2-CLEAR 가설 정합).

| 항목 | 결과 |
|---|---|
| freeze customers 귀속 | **9 / 9 (100%)** |
| freeze check_ins 귀속 | **6 / 6 (100%)** |
| **미귀속 count** | **0** |
| 실환자 의심 잔여행 | **0** (responder backstop 발동 불요) |
| chart_no 단일소유 sanity | ✅ (`customers_chart_number_unique` 전역 UNIQUE 구조보장) |

---

## 귀속 앵커 (결정적)

이름 접두 리터럴 **`단계이동_`** 는 전 코드베이스에서 **정확히 2곳**에만 존재:
- `tests/fixtures/index.ts` — 상수 `KANBAN_FIXTURE_NAME_PREFIXES = ['단계이동_', '칸반테스트_']` (cleanup 술어용)
- `tests/functional/kanban-drag.spec.ts:97` — **유일 생성지**: `const testName = \`단계이동_${Date.now()}\`;`

`src/` (프로덕션 앱 코드) 내 `단계이동_` 발생 = **0건** (검증: `grep -rn "단계이동" src/` → 무매치; T-20260514 spec의 "수동 단계이동"은 산문 주석이지 name 접두 아님). ∴ `단계이동_%` 이름을 가진 customer/check_in은 **kanban-drag.spec.ts:97 외의 어떤 경로로도 생성 불가** (스태프 수기 등록이 이 패턴을 타이핑할 개연 배제) → 이름 접두 자체가 airtight 귀속 앵커.

---

## Leg 1 — 코드경로 (어느 spec/fixture가 생성?)

`tests/functional/kanban-drag.spec.ts` test 2 "Stage navigation buttons in detail sheet":
```
L97   const testName = `단계이동_${Date.now()}`;   // ← 유일 생성지, name에 Date.now() 내장
L98   createdNames.push(testName);                  // afterAll cleanup 대상 등록 (AC-1, 453e8475 이후)
L106  await checkinBtn.click();                      // 셀프체크인 UI 다이얼로그(NewCheckInDialog) 오픈
L110  await dialog.locator('#ci-name').fill(testName);
L111  await dialog.locator('#ci-phone').fill(`010${8자리 random}`);  // → E.164 정규화 +8210########
L112  ...filter({ hasText: /^재진$/ })...            // visit_type=returning(재진) 선택
L113  await dialog.getByRole('button', { name: '체크인' }).click();   // check_ins insert
L133-139  "시술대기" 다음단계 버튼 클릭 → status_transitions 로그 생성 (재진: 접수→시술대기)
```
- 시더(`seedCheckIn`) **미경유** → run-scoped 마커(`[QA-FIXTURE]|token|ts`)·REGISTRY 등록 **없음** → `cleanupAll`/`sweepScoped` 스윕망 밖 → cleanup 코드 부재(453e8475 前)로 운영 DB 무한 적재. **이것이 현장 대시보드 노출 RC.**
- 재진(returning) 선택 → 대시보드 "재진·치료대기" 컬럼 노출 = 현장 보고("재진·치료대기 표시") 정합.

## Leg 2 — created_at ↔ 03:00 cron 상관 (이름내장 Date.now() 디코드)

`.github/workflows/ci-nightly.yml`: `cron: "0 17 * * *"` (UTC 17:00 = **KST 02:00 시작**). `functional` job이 `tests/functional/` 전량 실행 → kanban-drag 포함. build(~5min)+queue+setup 지연 후 spec 실행 → 실제 write는 **KST 02:50~03:52** 착지.

`단계이동_{ms}` 의 `{ms}` = spec:97의 `Date.now()` (생성 순간 wall-clock). 디코드 결과가 census `created_at`과 **초 단위 정확 일치** + 전량 야간 window 착지:

| # | customer id | name (내장 ms) | 디코드 KST | census created_at | chart_no | check_in |
|---|---|---|---|---|---|---|
| 1 | d7be9306…bbf8 | 단계이동_1783967359323 | 2026-07-14 03:29:19 | 07-14 03:29 | F-4710 | ✅ |
| 2 | 44f4f14c…4b67 | 단계이동_1784051960090 | 2026-07-15 02:59:20 | 07-15 02:59 | F-4765 | ✅ |
| 3 | b23a2267…a870 | 단계이동_1784138614576 | 2026-07-16 03:03:34 | 07-16 03:03 | F-4800 | ✅ |
| 4 | 7c385221…ec54 | 단계이동_1784224882250 | 2026-07-17 03:01:22 | 07-17 03:01 | F-4835 | ✅ |
| 5 | 47be6e07…c3e1 | 단계이동_1784311192303 | 2026-07-18 02:59:52 | 07-18 02:59 | F-4867 | ✅ |
| 6 | ac0748ea…76e3 | 단계이동_1784483430874 | 2026-07-20 02:50:30 | 07-20 02:50 | F-4890 | ✅ |
| 7 | 64b2f7f0…f538 | 단계이동_1784573543898 | 2026-07-21 03:52:23 | 07-21 03:52 | F-4932 | ✅ |
| 8 | a24f706c…3d13 | 단계이동_1784573557930 | 2026-07-21 03:52:37 | 07-21 03:52 | F-4933 | (orphan) |
| 9 | 641637ff…7319 | 단계이동_1784573572353 | 2026-07-21 03:52:52 | 07-21 03:52 | F-4934 | (orphan) |

→ **9/9 디코드-ms == created_at (초 단위 일치) == 야간 window.** 이름에 생성 timestamp가 자기각인(self-stamping)되어 있으므로 귀속은 수학적 자증(自證). 1/day cadence 7/14→7/21.

**gap/분포 설명 (귀속에 무영향):**
- **7/19 결측**: 그날 nightly가 skip/실패했거나 spec의 `test.skip`(대시보드 미로드/체크인버튼 부재) 가드 발화 → 더미 미생성. **결측 = 잔존 미귀속行 아님.**
- **7/21 ×3 (30초 내)**: Playwright flaky-retry(동일 spec 재시도 시 attempt마다 새 `Date.now()` name). 6 check_ins ↔ 6 customers, **3 orphan customers**(#8·#9 + 초기 1건 상당) = 실패 attempt에서 customer INSERT(→chart 트리거 발화)는 성공했으나 check_in insert/assert 미완 → check_in 없는 orphan. **orphan 3건도 이름앵커로 전량 귀속** (미귀속 아님).

## Leg 3 — chart-alloc 테스트 RPC 경로 ("실 chart_no ≠ 실환자" 확증)

UI 체크인 다이얼로그(`src/components/NewCheckInDialog.tsx`)는 신규 customer를 **`chart_number` 미지정으로 INSERT** → DB 트리거 `assign_foot_customer_chart_number()`(`supabase/migrations/20260624130000_chartno_race_atomicity.sql`) 발화:
```
IF NEW.chart_number IS NULL OR '' THEN
  PERFORM pg_advisory_xact_lock(hashtext('foot_customers_chart_number_global'));
  next_no := MAX(CAST(SUBSTRING(chart_number FROM 3) AS INT)) + 1  WHERE chart_number ~ '^F-[0-9]+$';
  NEW.chart_number := 'F-' || LPAD(next_no::TEXT, 4, '0');
```
- clinic 필터 없는 **전역 단일 시퀀스** → 실환자와 **동일 네임스페이스에서 F-#### 소비**. ∴ 야간 하네스가 실환자와 인터리브된 실 F-####를 매일 1~3개씩 소모(F-4710…F-4934, census상 실환자 196명 인터리브).
- **핵심**: 실 F-#### 존재 = 임상 encounter 아님. UI 체크인 경로가 프로덕션 chart-alloc 트리거를 호출했을 뿐 → **하네스-소비 시퀀스 값**. DA 2차 §C2-CLEAR 가설("하네스가 실 chart-alloc RPC 호출 → 실 F-####는 시퀀스일 뿐")을 **코드로 확증.**
- 실포맷 phone(+8210########·`phone_dummy=false`)·`is_simulation=false` 역시 동일 이유: kanban-drag가 **프로덕션 다이얼로그**를 그대로 구동(테스트 전용 마킹 미주입) → `010########` 입력이 E.164 정규화됨. scalp2 clean-stub 픽스처(DUMMY-% phone·no-chart)와 대조되는 foot 픽스처의 미비 = 근본원인(IMPROVE, 아래).

---

## 동일성/충돌 sanity (양경로 공통, §C2-CLEAR)

- **chart_no 단일소유**: `customers_chart_number_unique`(전역 UNIQUE 인덱스)가 한 `chart_number`→정확히 1 customer를 구조 보장. ∴ freeze-9의 각 F-####(4710/4765/4800/4835/4867/4890/4932/4933/4934)는 **freeze customer 단독 소유**, 실환자 레코드와 **미겹침**. 실환자는 이웃 F-4711/4766/4801/4931/4935(census 확인)로 별개 행. → **오삭 collateral 0.**
- **phone 충돌 무해**: freeze phone(랜덤 8자리→+8210)이 어떤 실환자 phone과 우연히 겹쳐도, 그 실환자는 이름 `단계이동_%` 미매칭·별도 PK의 **다른 customer 행**이라 freeze 스코프에 미포함. DELETE는 **고정 PK 9건 기준**(이름/phone 술어 아님) → phone 충돌의 실환자 collateral = 0.
- **status_transitions 7행**(CASCADE): kanban test 2의 "시술대기" 단계이동 클릭 로그. freeze check_ins의 자식 → §4-B 경량 apply 시 off-git 전-컬럼 스냅샷에 포함·CASCADE 동반삭제(DA 2차 C4 조건 정합).

---

## 근본원인 (IMPROVE — 별건, 본 티켓 밖)

야간 E2E 픽스처가 **test data로 자기식별하지 않음**(실 chart_no 소비·실포맷 phone·is_simulation=false·phone_dummy=false) → 매 teardown이 결정적 술어 부재로 애매. 해소 = 픽스처 자기식별(is_simulation=true / phone_dummy=true / DUMMY-% phone OR 분리 chart 네임스페이스). 관련 티켓 `T-20260721-foot-E2E-FIXTURE-SELFID` 로 승계 권고 (본 C2 CLEAR 자기감사 스코프 밖).

---

## DA 3차 verify 회부

1. **미귀속 = 0** — freeze-9 cust + 6 ci 전량 kanban-drag.spec.ts:97 귀속(이름앵커 + Date.now() 디코드 초단위 일치 + cron 상관 + chart-alloc RPC).
2. 실 F-#### = 하네스-소비 시퀀스(임상 encounter 아님) — 코드 확증. 실환자 의심 잔여 0 → **현장확인 backstop 발동 불요.**
3. chart_no 단일소유·실환자 미겹침 sanity ✅ (전역 UNIQUE 구조보장 + census 이웃 대조).
4. → C2 CLEAR 판정 요청. verify 후 §4-B 경량 apply(C4 조건부 GREENLIT: 전-컬럼 스냅샷+status_transitions 7행 CASCADE 포함, plain-DELETE, 술어 self-test abort 독립배선, prod pre-sweep=453e8475 착지) → supervisor DB-GATE(dry-run 무영속) → 형 apply_gate.
5. **본 자기감사 = READ-ONLY. DELETE는 C2 CLEAR + supervisor DB-GATE 후.**
