---
ticket_id: T-20260526-foot-PROGRESS-PLAN
domain: foot
title: 경과분석지 자동 세팅 — 설계 플랜
status: plan-complete
priority: P2
created_at: 2026-05-26
plan_completed_at: 2026-05-26
plan_completed_by: dev-foot
deploy_ready: false
build_ok: false
db_migration: none
e2e_spec: none
---

## 요약

환자 패키지(예: 12회 레이저)의 특정 회차(6회·12회)에 **경과분석 플래그**를 자동 세팅.
예약 생성 시 해당 회차 여부를 계산해 스태프 알림 + 예약현황 카드 배지·필터를 제공한다.

> ⚠️ 이 티켓은 **설계 플랜 산출**까지. 코드 구현은 하위 서브티켓으로 분할.

---

## AC-1: 데이터 모델 설계

### 현재 스키마 상태 (관련 테이블)

```
packages
  id, clinic_id, customer_id
  package_type TEXT  -- 'package1' | 'blelabel' | 'special' | ...
  total_sessions INTEGER
  status TEXT        -- 'active' | 'completed' | 'cancelled' ...

package_sessions
  id, package_id → packages.id
  check_in_id → check_ins.id (nullable)
  session_number INTEGER       -- 실제 방문 회차
  session_type TEXT
  session_date DATE
  status TEXT                  -- 'used' | 'cancelled' | 'refunded'

reservations
  id, clinic_id, customer_id
  reservation_date DATE, reservation_time TIME
  visit_type TEXT
  status TEXT
  ⚠️ package_id 없음 (현재 DB에 미존재)
  ⚠️ anticipated_session_number 없음 (현재 DB에 미존재)

notifications       (기존 — check_in 연결, 단순 큐)
notification_logs   (T-20260525-foot-MESSAGING-V1 — SMS 발송 이력)
```

### 신규 테이블: `package_progress_plans`

클리닉·패키지타입별 경과분석 회차를 관리하는 설정 테이블.

```sql
CREATE TABLE package_progress_plans (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        UUID    NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  package_type     TEXT    NOT NULL,  -- 'package1' | 'blelabel' | etc.
  session_milestone INTEGER NOT NULL, -- 경과분석 대상 회차 (예: 6, 12, 18)
  label            TEXT    NOT NULL DEFAULT '경과분석',
                                       -- 카드·알림에 표시할 레이블
  notify_staff     BOOLEAN NOT NULL DEFAULT TRUE,   -- 스태프 인앱 알림
  notify_patient   BOOLEAN NOT NULL DEFAULT FALSE,  -- 환자 SMS 알림
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (clinic_id, package_type, session_milestone)
);

CREATE INDEX idx_pkg_progress_plans_clinic ON package_progress_plans(clinic_id, is_active);
```

**시드 데이터 (종로 풋센터 기본값)**

| package_type | session_milestone | label |
|---|---|---|
| package1 | 6 | 6회 중간 경과분석 |
| package1 | 12 | 12회 최종 경과분석 |
| blelabel | 6 | 6회 초기 경과분석 |
| blelabel | 12 | 12회 중간 경과분석 |
| blelabel | 18 | 18회 경과분석 |
| blelabel | 24 | 24회 경과분석 |
| blelabel | 30 | 30회 경과분석 |
| blelabel | 36 | 36회 최종 경과분석 |
| special | 6 | 6회 중간 경과분석 |
| special | 12 | 12회 최종 경과분석 |

### 기존 테이블 컬럼 추가: `reservations`

예약을 패키지와 연결하고 예상 회차를 기록한다.

```sql
ALTER TABLE reservations
  ADD COLUMN package_id                UUID REFERENCES packages(id) ON DELETE SET NULL,
  ADD COLUMN anticipated_session_number INTEGER;  -- 예약 생성 시점 예상 회차

CREATE INDEX idx_reservations_package_id ON reservations(package_id)
  WHERE package_id IS NOT NULL;
```

> **설계 근거**
> - `anticipated_session_number`는 예약 생성 시점의 스냅샷 값 (실제 방문 후 `package_sessions.session_number`와 별개).
> - nullable: 기존 예약·비패키지 예약에 영향 없음.
> - `ON DELETE SET NULL`: 패키지 삭제 시 예약 레코드 보존.

### ERD 요약

```
package_progress_plans
  clinic_id → clinics.id
  (clinic_id, package_type, session_milestone) UNIQUE

reservations
  package_id → packages.id  (nullable, 신규)
  anticipated_session_number INTEGER  (nullable, 신규)

packages
  package_type → package_progress_plans.package_type (join key)
  customer_id  → customers.id
```

### 경과분석 여부 판단 뷰 (선택 구현)

```sql
-- 예약 목록 로딩 시 경과분석 플래그를 JOIN으로 가져오는 헬퍼
CREATE OR REPLACE VIEW reservations_with_progress_flag AS
SELECT
  r.*,
  CASE
    WHEN ppp.id IS NOT NULL AND ppp.is_active THEN TRUE
    ELSE FALSE
  END AS is_progress_milestone,
  ppp.label AS progress_label
FROM reservations r
LEFT JOIN packages pkg ON pkg.id = r.package_id
LEFT JOIN package_progress_plans ppp
  ON ppp.clinic_id = r.clinic_id
 AND ppp.package_type = pkg.package_type
 AND ppp.session_milestone = r.anticipated_session_number
 AND ppp.is_active = TRUE;
```

> **대안**: 뷰 대신 FE에서 클라이언트 사이드 JOIN (reservations + packages + plans를 별도 쿼리 후 Map으로 조합). 뷰가 좀 더 단순하나 Supabase realtime과 궁합이 약함 → **FE 클라이언트 사이드 조합 권장**.

---

## AC-2: 알림 워크플로 설계

### 흐름도

```
[예약 등록 폼]
  1. 고객 선택
  2. 패키지 선택 (customer's active packages 드롭다운)
  3. 앱이 anticipated_session_number 계산:
       used_sessions = count(package_sessions WHERE package_id=X AND status='used')
       anticipated = used_sessions + 1
  4. package_progress_plans에서 milestone 매칭 조회
       → 매칭 있음: 폼 내 배너 표시
         "🔔 이 예약은 {label} 대상입니다. 진료 차트에 경과분석지를 준비해 주세요."
       → 매칭 없음: 배너 없음 (조용)
  5. [예약 저장]
       reservations INSERT → package_id, anticipated_session_number 포함

[DB trigger: trg_reservation_progress_notify]  ← 신규
  AFTER INSERT ON reservations
  FOR EACH ROW
  WHEN (NEW.package_id IS NOT NULL AND NEW.anticipated_session_number IS NOT NULL)
    → package_progress_plans에서 milestone 매칭 체크
    → 매칭: notification_logs INSERT
        event_type = 'progress_analysis'
        status = 'pending'
        (notify_patient=TRUE일 경우 Edge Function 호출로 SMS 발송)
        (notify_patient=FALSE → 스태프 인앱 알림만)

[스태프 알림 표시]
  → notifications 테이블 OR 별도 in-app badge
  → 예약현황 페이지 카드 뱃지 (AC-3)
```

### 트리거 함수 스켈레톤

```sql
CREATE OR REPLACE FUNCTION notify_progress_reservation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_plan    package_progress_plans%ROWTYPE;
  v_pkg     packages%ROWTYPE;
BEGIN
  -- 패키지 없으면 스킵
  IF NEW.package_id IS NULL OR NEW.anticipated_session_number IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_pkg FROM packages WHERE id = NEW.package_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT * INTO v_plan
  FROM package_progress_plans
  WHERE clinic_id = NEW.clinic_id
    AND package_type = v_pkg.package_type
    AND session_milestone = NEW.anticipated_session_number
    AND is_active = TRUE;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- in-app 알림: notification_logs
  INSERT INTO notification_logs
    (clinic_id, customer_id, reservation_id, event_type, channel, status)
  VALUES
    (NEW.clinic_id, NEW.customer_id, NEW.id,
     'progress_analysis', 'sms', 'pending');

  -- TODO: notify_patient=TRUE 이면 Edge Function 호출 (기존 send-notification 재사용)

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_progress_reservation error: % %', SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reservation_progress_notify
  AFTER INSERT ON reservations
  FOR EACH ROW
  EXECUTE FUNCTION notify_progress_reservation();
```

### 알림 채널 결정

| 채널 | 우선순위 | 구현 위치 |
|---|---|---|
| 스태프 인앱 배너 (예약폼) | P0 — 즉시 | FE: 폼 내 경고 배너 |
| 예약 카드 뱃지 | P0 — 즉시 | FE: Reservations 페이지 (AC-3) |
| SMS 환자 알림 | P2 — 선택 | Edge Function (기존 send-notification) |
| Push 알림 | P3 — 미래 | 미구현 |

---

## AC-3: 예약현황 태그/필터 설계

### 예약 카드 배지 (태블릿 UX 기준)

```
┌─────────────────────────────────────┐
│ 14:00  홍길동 (재진)                │
│ 힐러 12회 패키지                    │
│ ┌──────────────┐                    │
│ │ 🔵 경과분석  │  ← 배지 (teal)    │
│ └──────────────┘                    │
└─────────────────────────────────────┘
```

- **배지 색상**: `bg-teal-100 text-teal-800 border border-teal-300`
- **배지 위치**: 고객명 아래, 서비스명 옆
- **배지 내용**: `ppp.label` (예: "6회 중간 경과분석") — 짧으면 "경과분석"으로 축약
- **표시 조건**: `is_progress_milestone = TRUE` (FE 클라이언트 계산)

### 필터 UI

**위치**: 예약현황 페이지 상단 필터 바 (현재 visit_type 필터 옆)

```
[ 전체 ] [ 신규 ] [ 재진 ] [ 경과분석 ▸ ]
                            └ 토글 ON/OFF
```

- **필터 로직**: 클라이언트 사이드
  ```ts
  filteredReservations = progressFilter
    ? reservations.filter(r => r.is_progress_milestone)
    : reservations;
  ```

- **필터 상태**: URL searchParam (`?filter=progress`) — 페이지 새로고침 보존

### 데이터 로딩 전략

```
Reservations 페이지 로딩 시:
  1. reservations 쿼리 (기존 + package_id, anticipated_session_number 추가)
  2. 활성 packages 쿼리 (customer_id IN [...]) → Map<packageId, package_type>
  3. package_progress_plans 쿼리 (clinic_id=X, is_active=TRUE) → Set<`{type}:{n}`>
  4. 클라이언트 JOIN:
       forEach reservation:
         if r.package_id && r.anticipated_session_number:
           type = packageMap[r.package_id].package_type
           key = `${type}:${r.anticipated_session_number}`
           r.is_progress_milestone = progressPlanSet.has(key)
           r.progress_label = progressPlanMap[key].label
```

- `package_progress_plans`는 거의 변하지 않으므로 **세션 단위 캐싱** (1회 쿼리 후 재사용).

---

## AC-4: FOLLOWUP — 난이도·선행조건·서브티켓 분할

### 난이도 평가: **M** (중간, 실 구현 4~6일 예상)

| 항목 | 난이도 | 근거 |
|---|---|---|
| DB 마이그레이션 | S | 테이블 1개 + 컬럼 2개 + 트리거 1개. 기존 데이터 영향 없음. |
| 예약 폼 패키지 연결 UI | M | 현재 예약 폼에 패키지 선택 UI 없음 → 신규 구현. 패키지 목록 로딩·anticipated 계산 포함. |
| 경과분석 알림 (DB trigger) | S | 기존 messaging 패턴 재사용. 트리거 함수 신규. |
| 예약 카드 배지 + 필터 | S | FE 클라이언트 JOIN + Badge 컴포넌트 재사용. |
| 어드민 경과분석 플랜 설정 | S | AdminSettings.tsx에 섹션 추가 (CRUD). |

### 선행조건

1. **messaging 모듈 안정화** (T-20260525-foot-MESSAGING-V1) — `notification_logs` 테이블 존재 필수
2. **reservations 폼 패키지 연결** — 현재 폼에 package_id 저장 경로 없음 (서브티켓 RESV-FORM이 선행)
3. **DB 마이그레이션 승인** — supervisor 리뷰 후 운영 DB 적용

### 서브 티켓 분할안

#### T-FOOT-PROGRESS-DB (난이도 S, 0.5일)
> DB 마이그레이션: `package_progress_plans` 테이블 + `reservations.package_id/anticipated_session_number` + 트리거

**DoD**:
- `package_progress_plans` 테이블 생성
- `reservations` 컬럼 2개 추가
- `trg_reservation_progress_notify` 트리거 배포
- 종로 풋센터 시드 데이터 삽입 (위 표 기준)
- rollback SQL 포함

---

#### T-FOOT-PROGRESS-RESV-FORM (난이도 M, 1.5일)
> FE: 예약 폼에 패키지 선택 + anticipated_session_number 계산 + 경과분석 배너

**DoD**:
- "패키지 연결" 드롭다운 (고객의 active 패키지 목록)
- 선택 시 `anticipated_session_number` 자동 계산 표시 (used+1)
- milestone 매칭 시 폼 내 teal 배너
- 저장 시 `reservations.package_id` + `anticipated_session_number` 기록
- 미선택 시 기존 동작 그대로 (nullable)

**UI 스케치**:
```
[ 패키지 연결 ]  ▼ 패키지1 12회 (7/12 진행)
[ 예상 회차 ]    → 8회 (자동 계산)
                  ┌────────────────────────────────┐
                  │ ℹ️ 이 예약은 6회 중간 경과분석  │  (없음)
                  └────────────────────────────────┘
```

---

#### T-FOOT-PROGRESS-NOTIFY (난이도 S, 0.5일)
> DB/EF: notification_logs `progress_analysis` 이벤트 확장 + SMS 옵션 연결

**DoD**:
- 트리거가 `notification_logs.event_type='progress_analysis'` 레코드 정상 생성 확인
- `notify_patient=TRUE` 케이스: Edge Function `send-notification` 재사용 호출
- AdminSettings에서 progress 알림 template 등록 가능
- E2E: 예약 생성 → notification_logs 확인

---

#### T-FOOT-PROGRESS-RESV-TAG (난이도 S, 0.5일)
> FE: 예약현황 카드 경과분석 배지 + 필터 토글

**DoD**:
- 예약 카드에 teal 배지 표시 (milestone 해당 예약만)
- 상단 필터바에 "경과분석" 토글 버튼
- URL `?filter=progress` 로 상태 보존
- Playwright E2E spec

---

#### T-FOOT-PROGRESS-ADMIN (난이도 S, 0.5일)
> FE: AdminSettings 경과분석 플랜 관리 섹션

**DoD**:
- "경과분석 플랜" 탭/섹션 추가 (AdminSettings.tsx)
- package_type별 milestone 목록 CRUD (추가/삭제/레이블 수정)
- 변경 즉시 적용 (새로고침 불필요)

---

### 의존 순서

```
T-FOOT-PROGRESS-DB          (선행: messaging 모듈 배포 완료)
  └─→ T-FOOT-PROGRESS-RESV-FORM   (선행: DB 컬럼 존재)
  └─→ T-FOOT-PROGRESS-ADMIN       (선행: DB 테이블 존재)
        └─→ T-FOOT-PROGRESS-NOTIFY     (선행: DB 트리거 + 폼 저장)
              └─→ T-FOOT-PROGRESS-RESV-TAG  (선행: 폼에서 anticipated 저장)
```

**권장 실행 순서**: DB → ADMIN → RESV-FORM → NOTIFY → RESV-TAG

---

## 리스크 & 고려사항

| 리스크 | 영향 | 대응 |
|---|---|---|
| 기존 예약(package_id=NULL)과 하위호환 | 낮음 | nullable 컬럼 + FE 조건부 렌더 |
| anticipated_session_number 계산 오차 | 중간 | 예약 취소/환불 세션 제외 로직 명확화 필요 |
| 패키지 회차와 실제 방문 비동기 | 낮음 | anticipated는 스냅샷 (변경 X), 실제 session_number와 별도 추적 |
| notification_logs 이벤트 타입 확장 | 낮음 | `event_type` TEXT 컬럼 — CHECK constraint 없음, 자유 확장 가능 |
| 어드민 설정 없을 때 기본값 | 중간 | 시드 데이터로 기본값 제공 (package1·blelabel·special) |

---

## 참고 파일

- 현재 스키마: `supabase/migrations/20260419000000_initial_schema.sql`
- 메시징 모듈: `supabase/migrations/20260525030000_messaging_module.sql`
- 더미 데이터 (경과 테스트): `supabase/migrations/20260526140000_dummy_progress_test.sql`
- 예약 페이지: `src/pages/Reservations.tsx`
- 패키지 페이지: `src/pages/Packages.tsx`
