# T-20260629-foot-VISITLOG-SELFCHECKIN-CRITERIA — Phase 0 진단 리포트 (READ-ONLY)

- **작성**: dev-foot · 2026-06-29 (Asia/Seoul)
- **레포**: obliv-foot-crm · Supabase rxlomoozakkjesdqjtvd
- **쓰기**: 0건 (prod 무영향). 코드 변경 0. 본 산출 = 진단 보고만.
- **현장 정정 의문(김주연 총괄)**: responder가 "방문이력 0건 = 직원 체크인 시에만 check_ins 적재되는 구조, 더미가 체크인 미생성"이라 설명 → 총괄이 "그 기준이 틀렸다, 셀프접수(고객 직접 접수)도 방문이력에 포함돼야"라고 반박.

---

## 0. 결론 요약 (TL;DR) — 판정 (A) 우세 + 핵심 단서

> **responder 설명은 부정확하다. 셀프접수(키오스크 고객 직접 접수)도 `check_ins`에 행을 적재한다 — 직원 체크인 전용이 아니다.**
> 서버측 RPC `fn_selfcheckin_create_check_in` 가 `INSERT INTO check_ins`를 직접 수행함을 마이그레이션·FE 양쪽에서 확정. 따라서 "방문이력 0건"은 **적재 구조 결함이 아니다.**

- 셀프접수는 이미 check_ins에 적재됨 → **Phase 1(적재 로직 변경)은 불필요·불권장.** 새 INSERT 경로를 추가할 필요가 없으므로 게이트가 걱정한 **불변식#5(active check_in 자동생성 금지) 충돌은 애초에 발생하지 않는다.**
- "0건"의 진짜 원인은 적재가 아니라 **(i) 더미가 셀프접수 경로를 안 탐** + **(ii) 진료관리 방문이력 탭의 빈행 숨김 렌더 필터(RC-2, 원장 의도)** 2겹이며, 둘 다 기 진단 티켓 `T-20260629-foot-DUMMYDATA-LINKAGE-AUDIT`에서 이미 규명됨.

---

## 1. 방문이력 쿼리·필터 확정 (질문 ①)

방문이력은 **2개 surface**에 존재하며 모두 `check_ins` 테이블을 소스로 한다 (전용 뷰 없음).

| Surface | 소스 | 쿼리 위치 | 필터 (status/visible) |
|---------|------|-----------|------------------------|
| **진료관리 — 진료차트 "방문이력" 탭** (의사 surface) | `check_ins` | `MedicalChartPanel.tsx` L1857 `loadVisitHistory` — `from('check_ins').eq('customer_id').order(checked_in_at desc).limit(30)` | 쿼리 단 status·날짜 필터 **없음** → 셀프접수 행도 가져옴. **단 렌더 단 `visibleVisitHistory`(L746-753) 가 `treatment_kind`·`treatment_memo.details`·`doctor_note` 가 모두 빈 행을 숨김** (T-20260609-VISITLOG-EMPTYROW-HIDE, **원장 의도 동작**) |
| **고객관리 — 고객차트** | `check_ins` | `CustomerChartPage.tsx` L2891 (`*`, limit 50) / L2895 (`*`, `status≠cancelled`, limit 100) | 빈행 숨김 필터 **없음** → 셀프접수 행 그대로 노출 |
| (참고) 상담기록 탭 | `check_ins` | `ConsultRecordTab.tsx` L137 | `status≠cancelled`만, 빈행 필터 없음 → 전부 노출 |

**핵심**: 진료관리 방문이력 탭은 *쿼리*가 아니라 *렌더 필터*로 진료내용 없는 행을 숨긴다. 진료내용이 아직 없는 셀프접수 직후 행은 **이 탭에서만** 숨겨진다. 고객관리/상담기록 탭에는 그대로 보인다.

---

## 2. check_ins INSERT 경로 전수 (질문 ②) — 생성경로 매트릭스

| # | 경로 | 트리거 주체 | 동작 | 상태값(visit_type 분기) | 근거 |
|---|------|-------------|------|---------------------------|------|
| 1 | 직원 수동 접수 | 직원 | `check_ins` **INSERT** | 재진=treatment_waiting / 초진=receiving / 그외(체험)=consult_waiting | `NewCheckInDialog.tsx` L300 |
| 2 | **셀프접수 / 키오스크 (고객 직접)** | **고객(anon)** | **`check_ins` INSERT** (서버 RPC) | 동일 분기 (RPC status 화이트리스트) | `SelfCheckIn.tsx` L1377 → RPC `fn_selfcheckin_create_check_in` → migration `20260615170000` **L216-219 `INSERT INTO check_ins`** |
| 3 | 예약상세 우클릭 → 체크인 | 직원 | `check_ins` **INSERT** | 동일 분기 | `ReservationDetailPopup.tsx` L1054 |
| 4 | 예약 → 체크인 직행(대시보드 드래그) | 직원 | `check_ins` **INSERT** (+ `reservations.status='checked_in'` 동시 갱신) | 동일 분기 | `Dashboard.tsx` L5832 |
| — | **대시보드 상태변경(칸반 이동·배정·플래그)** | 직원 | `check_ins` **UPDATE only — INSERT 아님** | status/status_flag/customer_id 등 기존 행 갱신 | `Dashboard.tsx` L4691·L5469·L5550·L5668·L5720·L3994 등 전부 `.update()` |

### 질문 ② 직접 답변
- **(a) 직원 수동 체크인**: check_ins INSERT (경로 1·3·4). ✔
- **(b) 셀프접수/키오스크 고객 직접 접수**: **check_ins INSERT 한다** (경로 2, 서버 RPC가 직접 INSERT). reservations status만 바뀌는 게 아니다 — check_ins 행이 먼저 생성되고, 매칭된 예약이 있으면 `reservations.status='checked_in'`도 **추가로** 갱신한다(SelfCheckIn L1409-1418). ✔ **← responder 설명 반박 지점**
- **(c) 대시보드 상태변경**: check_ins를 **UPDATE만** 한다 (신규 생성 아님). 즉 셀프접수/직원접수가 이미 만든 행의 status를 옮기는 것. ✔

RPC 서버측 증거 (migration `20260615170000_rls_clinic_isolation_anon_rpc_additive.sql`):
```
L216  IF p_status NOT IN ('registered','treatment_waiting','consult_waiting','receiving') THEN
L217    RAISE EXCEPTION 'status not allowed for self check-in: %', p_status;
L219  INSERT INTO check_ins(clinic_id, customer_id, customer_name, customer_phone, ...
```

---

## 3. 판정 (질문 ③): (A) — responder 설명 부정확, 적재 결함 아님

| 후보 | 판정 |
|------|------|
| (A) 셀프접수가 이미 방문이력(check_ins)에 잡힘 → responder 설명 부정확, 0건은 적재 결함이 아님 | **채택** |
| (B) 정말 직원 체크인만 잡힘 → 적재 로직 갭 | **반증** (셀프접수 RPC가 INSERT 확정) |

### "방문이력 0건"의 진짜 원인 (적재 아님 — 기 진단 티켓 환원)
1. **더미**: 더미 시드는 셀프접수 RPC 경로를 안 타고 check_ins를 독립 INSERT(또는 미생성)하며 `reservation_id` NULL. (LINKAGE-AUDIT RC-4)
2. **진료관리 탭 렌더 필터(RC-2)**: 진료내용(treatment_kind/memo/doctor_note)이 빈 행을 `visibleVisitHistory`가 숨김. 실고객에서도 재현(LINKAGE-AUDIT 2-B: 김민경 28방문→방문이력 노출 0). **이건 원장이 의도한 동작**(T-20260609-VISITLOG-EMPTYROW-HIDE)이다.

---

## 4. 게이트·핸드오프 메모 (planner 재판정용)

- **Phase 1(적재 로직 변경) 진행 불필요.** 셀프접수는 이미 check_ins에 적재되므로 적재 경로를 새로 만들 게 없다 → **불변식#5(active status check_in 자동생성 → 대기명단·일마감 오염) 충돌이 발생할 작업 자체가 없다.** 게이트 우려는 해소.
- **closed 제안 가능** — 단, planner 재판정에 필요한 **1개 disambiguation**:
  - 총괄이 본 "방문이력 0건"이 **어느 화면**인가?
    - **진료관리(의사 surface) 방문이력 탭**이면 → 원인은 RC-2 빈행 숨김 렌더 필터(원장 의도). 변경 시 §11 `medical_confirm_gate: required` + 문지은 대표원장 컨펌 필요. → 기 티켓 **LINKAGE-AUDIT 옵션 D**(렌더 필터 정합)로 흡수 권고 (중복 티켓 방지).
    - **고객관리/상담기록 탭**이면 → 셀프접수 행이 이미 보임. 거기서 0건이면 더미 미생성 문제 → **LINKAGE-AUDIT 옵션 A**(시드 재생성)로 흡수.
- 어느 쪽이든 **본 티켓의 "적재 로직" 축은 결함 없음 → closed**, 잔여 체감 이슈는 기존 LINKAGE-AUDIT 라인으로 단일화 권고.
```
