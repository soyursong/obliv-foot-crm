# 자동배정 서버측(Edge/DB trigger) 이관 타당성 검토 — 권고문

> 티켓: **T-20260618-foot-AUTOASSIGN-SERVERSIDE-REVIEW** (P2, design_review)
> 산출: 설계 권고문 1건 (코드·DB 변경 없음 — 실제 구현은 후속 티켓 + 게이트 후)
> 작성: agent-fdd-dev-foot · 2026-06-19
> 선행 의존: **T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM** (출근 정본 `staff_attendance` 테이블 단독 소유 — 본 검토는 consume 전제)

---

## 0. 한 줄 결론

> **옵션 C (Edge Function: 이벤트 webhook + cron sweep 병행)** 를 권고한다.
> 단, **B/C 모두 STAFF-ATTENDANCE-SSOT-CRM의 `staff_attendance` 테이블 확립이 선행 조건**이며,
> 실제 구현은 **architect CONSULT(trigger/EF 인프라 도입) + 단계적 전환(PoC→shadow→cutover)** 게이트를 통과한 후 별도 티켓에서 착수한다.

---

## 1. 현 아키텍처 정밀 기술 (AC-1)

### 1.1 배정 엔진 (위치 무관 — 순수 함수 + Supabase RPC)
- `src/lib/autoAssign.ts` `maybeAutoAssign(checkInId, newStatus, createdBy)`
  - 트리거 조건: `newStatus ∈ {consult_waiting, treatment_waiting}` 일 때만 동작.
  - 멱등: 이미 `consultant_id`/`therapist_id` 배정 시 no-op. 조건부 `UPDATE … .is(col, null)` 로 다중 클라이언트 경합 안전.
  - 후보 풀: `fetchActiveStaff` (clinic-scoped) → `fetchTodayWorkingStaffIds` (구글시트 read) → 역할 필터.
  - 우선순위: 0순위 지정 담당(`assigned_consultant_id`/`designated_therapist_id`, 당일 출근 시) → 1순위 월 균등 `pickLeastLoaded`.
  - 로그: 성공 클라이언트만 `assignment_actions(auto_assign)` insert.
  - best-effort: 어떤 실패도 throw 안 함.

> 핵심: 엔진 **로직 자체**는 클라이언트 종속이 아니다. 종속된 것은 **"누가 언제 이 함수를 호출하는가"**(트리거)와 **"후보 풀을 구글시트에서 브라우저가 read"**(외부 의존) 두 가지뿐. 이관 설계의 핵심은 이 둘이다.

### 1.2 client-side 트리거 지점 전수 (모두 브라우저에서 실행)

| # | 위치 | 발화 시점 | 브라우저 open 요구 |
|---|------|-----------|--------------------|
| T1 | `Dashboard.tsx:4240` | Realtime INSERT echo — 키오스크(anon) 셀프접수 `consult_waiting`(visit_type=new) 직행 INSERT 수신 | **CRM 대시보드 탭 open + 구독 중**이어야만 수신 |
| T2 | `Dashboard.tsx:4254` | Realtime INSERT echo — 키오스크(anon) 재진 `treatment_waiting`(returning) 직행 INSERT 수신 | **상동** |
| T3 | `Dashboard.tsx:4885` | 슬롯 드래그/상태변경 핸들러 (직원이 칸반에서 `consult_waiting`/`treatment_waiting` 로 이동) | 직원이 직접 조작 = open 당연 |
| T4 | `Dashboard.tsx:5251` | 상태변경 핸들러(별도 경로) | 상동 |
| T5 | `Dashboard.tsx:5635` | 체크인 생성 경로(`doCheckInForReservation` / `NewCheckInDialog.proceedCheckIn`) 직후 | 직원이 직접 생성 = open 당연 |
| T6 | `Assignments.tsx:401` | **수동 1클릭 일괄 reconcile 버튼**(`doBatchAutoAssign`) — 미배정 대기 건 일괄 통과 | 직원이 버튼 클릭 |

### 1.3 외부 의존 — 구글시트 근무 캘린더
- `fetchTodayWorkingStaffIds` → `dutySheet.ts` `fetchTodayAttendeeNames` → Edge Function `duty-sheet-read`(CORS 프록시) → 구글시트 gviz CSV.
- 시트는 **"이름"만** 알려줌 → `staff.name`/`display_name` 매칭으로 출근 staff id 집합 생성.
- 시트 장애 시 graceful: 빈 set → "출근 후보 없음" → 미배정 유지(수동 대기).

---

## 2. 장애 모드 (AC-2)

| 장애 모드 | 근본 원인 | 영향 |
|-----------|-----------|------|
| **(M1) 무인 키오스크 셀프접수 미배정** | T1/T2 Realtime echo는 **CRM 대시보드 탭이 열려 구독 중**일 때만 발화. 야간·주말·직원 미접속·접수데스크 PC 화면 꺼짐 등 대시보드 미오픈 시 INSERT 이벤트를 아무도 수신 못 함 → autoAssign 미호출 | 키오스크 접수 환자가 **무한 미배정**. T6 수동 버튼/다음 상태전이까지 방치 |
| **(M2) 소급 미배정** | 엔진이 이벤트 구동 — 이미 대기 슬롯에 적재된 건(직접 INSERT seed 포함)은 소급 발화 안 됨 | T6 수동 버튼 누르기 전까지 미배정 누적 |
| **(M3) 다중 탭 중복 시도** | 여러 직원이 대시보드 열면 T1/T2가 N개 클라이언트에서 동시 발화 | 조건부 UPDATE 가드로 **결과는 안전**(1개만 성공). 단 불필요한 시트 read N회 |

> M1·M2는 **"트리거 주체가 client-side 이벤트 핸들러"**라는 단일 구조에서 기인. M1이 특히 결정적(무인 접수 = 운영상 흔한 시나리오).

### 정량화 한계 (솔직한 고지)
- 미배정 누락 **빈도의 정밀 정량화는 현 로그만으로 불가**. `assignment_actions` 는 *성공한* 배정만 기록 → "발화되지 못한" 건은 흔적이 없음(no-event = no-log).
- 간접 추정 가능 지표(후속 구현 티켓 PoC 단계에서 측정 권고):
  - `check_ins WHERE status IN (consult_waiting, treatment_waiting) AND consultant_id/therapist_id IS NULL` 의 **체류시간 분포**(특히 야간/주말 created).
  - T6 일괄버튼 1회당 `assigned` 건수(현장 운영 로그) — 클수록 평소 누락이 크다는 신호.

---

## 3. 옵션 비교 (AC-3)

> 공통 전제: 배정 결과 스키마(`check_ins.consultant_id`/`therapist_id` + `assignment_actions`)는 **무변경**. cross_crm_data_contract 무영향. 셋 다 엔진 로직(`pickLeastLoaded`/축 파생/멱등 가드)은 재사용.

| 항목 | **A. 현행 유지 + 보정** | **B. DB trigger** | **C. Edge Function (webhook + cron)** |
|------|------------------------|-------------------|----------------------------------------|
| **방식** | T6 수동 reconcile를 진입 시 자동 1회 호출(client). 추가로 대시보드 mount 시 미배정 sweep | `check_ins` AFTER INSERT/UPDATE OF status trigger → PL/pgSQL이 DB 레벨 배정 | Supabase EF가 (a) DB webhook(`check_ins` 변경)으로 즉시 배정 + (b) pg_cron 주기 sweep로 누락 소급 |
| **M1 무인키오스크 보장** | ❌ 여전히 대시보드 open 필요(자동 sweep도 누가 열어야 발화) | ✅ 완전 보장(DB 레벨, 브라우저 무관) | ✅ 완전 보장(webhook = 브라우저 무관) |
| **M2 소급배정** | △ 진입 시 1회 자동화로 완화, 근본 미해결 | ✅ trigger는 신규/전이만 — 소급은 별도 배치 SQL 필요 | ✅ cron sweep가 주기 소급(자연스러움) |
| **구글시트 read 처리** | 현행 그대로(client가 EF 프록시 read) | ❌ **trigger 내 외부 fetch 불가** → `staff_attendance` 테이블 read 필수(STAFF-ATTENDANCE 선행) | ✅ EF는 외부 fetch 가능. 단 **권고는 `staff_attendance` read**(시트 직접 read는 라이브 호출 지연·실패 리스크) |
| **least-loaded 계산** | client(현행) | PL/pgSQL 재구현 필요(엔진 TS→SQL 포팅 = **로직 이중화 회귀 위험 큼**) | EF에서 TS 엔진 **그대로 재사용**(코드 1벌 유지) |
| **DB 스키마 영향** | 없음 | trigger 함수 + `staff_attendance` 의존. assignment_actions insert를 trigger가 수행 | `staff_attendance` 의존. webhook 설정. (옵션) cron 등록 |
| **멱등/경합** | 현행 조건부 UPDATE 유지 | DB 단일 트랜잭션 = 강력하나 trigger 재진입(UPDATE→trigger→UPDATE) 주의 | 조건부 UPDATE 가드 재사용 + webhook 재시도 idempotent |
| **롤백 경로** | 코드 revert(즉시) | trigger DROP(즉시) + 함수 DROP. **단 trigger가 잘못 배정하면 운영 중 대량 오배정 위험** | webhook/cron 비활성화(즉시) + EF 롤백. client 트리거 잔존 = **graceful fallback** |
| **관측성** | 기존 console.warn | trigger 내부 = **디버깅 어려움**(서버 로그 빈약) | EF 로그 = 관측 양호 |
| **구현 비용** | 낮음 | 중(엔진 SQL 포팅) | 중(EF 셋업 + webhook/cron) |
| **회귀 위험** | 낮음 | **높음**(핵심 로직 이중화 + trigger 부작용) | 중(엔진 재사용 → 로직 일관) |

---

## 4. 권고 (AC-3)

### 4.1 권고안: **옵션 C** (Edge Function — DB webhook + pg_cron sweep 병행)

근거:
1. **M1(무인 키오스크) 결정적 해소** — webhook은 브라우저와 무관하게 `check_ins` INSERT/status 전이에 반응. §흡수(티켓 본문)에서 핵심 요구로 명시된 "무인 키오스크 셀프접수 자동배정 보장" 충족.
2. **M2(소급) 자연 해소** — pg_cron 주기 sweep가 미배정 대기 건을 주기적으로 통과(T6 수동버튼의 자동화).
3. **로직 이중화 회피** — 옵션 B는 `pickLeastLoaded`/축 파생을 PL/pgSQL로 재구현해야 해 **TS·SQL 두 벌 유지 = 만성 회귀 위험**. C는 EF에서 기존 TS 엔진을 그대로 호출 → **코드 1벌**.
4. **graceful 전환·롤백** — client 트리거(T1~T6)를 즉시 제거하지 않고 **병존**시키면, EF 비활성화만으로 현행으로 안전 복귀. 멱등 가드 덕에 client+server 동시 발화해도 결과 안전.
5. **구글시트 의존 격리** — EF는 라이브 시트 직접 read 대신 **`staff_attendance` 테이블 read**(STAFF-ATTENDANCE의 cron sync가 채움) → 시트 라이브 호출 지연·CORS·rate-limit 리스크를 배정 경로에서 제거.

### 4.2 옵션 B를 권고하지 않는 이유
- trigger 내 외부 fetch 불가 자체는 `staff_attendance`로 해결되나, **least-loaded/축 파생 로직을 SQL로 포팅**하는 순간 TS 엔진과 영구 이중화 → 정책 변경(예: 균등 sublogic 조정) 시 두 곳 동시 수정 강제. 배정은 빈번히 정책이 바뀌는 영역(최근 BALANCE-TOSS·RUN-FAIL 연속 수정)이라 이중화 비용이 특히 크다.

### 4.3 옵션 A를 권고하지 않는 이유
- M1을 구조적으로 못 푼다(자동 sweep도 "누가 대시보드를 열어야" 발화). 단 **C 구현 전 임시 완화책으로 A의 "진입 시 자동 reconcile"은 저비용 가치 있음**(별도 소형 티켓 가능, 본 검토 권고 외).

---

## 5. 후속 구현 티켓 분리 조건 + 게이트 (AC-3)

본 티켓은 **권고문까지**. 실제 구현은 아래 게이트 통과 후 별도 티켓:

### 5.1 선행 의존 (HARD)
- **T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM** 의 `staff_attendance` 테이블 + sheet→table sync(cron EF) **확립 완료**가 절대 선행.
  - consume 계약: `SELECT staff_id FROM staff_attendance WHERE clinic_id=? AND date=todaySeoul` (present = 출근). `source`/`synced_at` 메타로 신선도 확인.
  - 본 검토는 **자체 sync를 설계하지 않음**(STAFF-ATTENDANCE 단독 소유 — 티켓 본문 ★ 의존 화살표 + DA am1i 확정).

### 5.2 게이트
| 게이트 | 사유 | 결정권자 |
|--------|------|----------|
| **architect CONSULT** | EF/webhook/pg_cron = 인프라 추가. `staff_attendance` read 의존 = 데이터 정책 자문(§S2.4). assignment_actions를 server가 insert 시 RLS(현 auth.uid 기반) 재검토 필요 — service-role 경로 | data-architect |
| **대표/supervisor 게이트** | 배정 **핵심 경로 이관** = 회귀 위험. risk_reason 3/5 비즈로직 | supervisor GO/NO-GO + 대표 통보 |
| **단계적 전환(PoC→shadow→cutover)** | 직접 cutover 금지. ① PoC: EF가 배정 시도 후 **로그만**(실 UPDATE 안 함) → 기존 client 배정과 **결과 일치율** 측정(M2 정량화도 동시 확보). ② shadow: EF가 실 배정하되 client 트리거 병존(멱등 안전망). ③ cutover: 안정 확인 후 client 트리거 단계 축소(T1/T2 우선 — M1 해소분) | supervisor |
| **dry-run(소급 배치)** | cron sweep 첫 가동 = 누적 미배정 대량 처리 → dry-run으로 대상 건수·배정 결과 사전 검증 | dev + supervisor |

### 5.3 분리 권고 티켓 (제안, 본 티켓에서 생성하지 않음)
1. `[impl] foot-AUTOASSIGN-EF-WEBHOOK` — 옵션 C PoC(shadow-log) → shadow → cutover. **STAFF-ATTENDANCE done 후 착수**.
2. (선택) `[hotfix-lite] foot-AUTOASSIGN-ENTRY-RECONCILE` — 옵션 A 임시완화(대시보드 mount 시 미배정 자동 reconcile 1회). C 도착 전 M1 부분완화용. 저비용·DB무변경.

---

## 6. AC 충족 체크
- [x] AC-1 현 client-side 트리거 경로 전수 문서화 (§1.2 T1~T6 + §1.3 외부의존)
- [x] AC-2 옵션 A/B/C 장단점·구글시트 read 처리·DB 스키마 영향·롤백 경로 비교표 (§3)
- [x] AC-3 권고안 1개(옵션 C) + 후속 티켓 분리 조건·게이트 명시 (§4, §5)
- [x] AC-4 권고문까지 — 코드·DB 변경 없음(본 문서 = 설계 산출물 단독)
