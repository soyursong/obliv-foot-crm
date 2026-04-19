# 데이터 리뷰 결과 — Obliv Ose (happy-flow-queue)

> 리뷰 시점: 2026-04-10
> 리뷰 범위: 스키마, RLS, 데이터 정합성, 개인정보, 성능, 백업/복구, Realtime
> 대상 Supabase: izegeboamrcczhhvghwo.supabase.co
> **READ-ONLY 리뷰 — 소스/DB 변경 없음**

---

## 1. DB 스키마 점검

### 1-1. 인덱스 누락 (심각도: 🔴 HIGH)

현재 마이그레이션에는 PK와 UNIQUE 제약 외에 **명시적 인덱스가 전혀 없다**. 거의 모든 쿼리가 `clinic_id` + 날짜 컬럼 필터를 사용하므로, 데이터가 수천 건만 되어도 Full Table Scan이 발생한다.

| 테이블 | 필요 인덱스 | 사용처 | 영향 |
|--------|-----------|--------|------|
| check_ins | `(clinic_id, created_date)` | Dashboard, History, Closing, Reservations — 거의 모든 페이지 | 가장 빈번한 쿼리. 인덱스 없으면 O(n) |
| check_ins | `(customer_id)` | AdminCustomers 상세, AdminLayout 검색 | 고객별 방문 이력 조회 |
| check_ins | `(clinic_id, status, created_date)` | WaitingScreen 대기열 조회, staff revenue | status 필터 포함 |
| reservations | `(clinic_id, reservation_date)` | Reservations 주간뷰, History 일별뷰 | 주간 7일 범위 조회 |
| reservations | `(customer_id, reservation_date)` | CheckIn에서 당일 예약 확인 | 체크인 플로우 |
| payments | `(check_in_id)` | Dashboard, History, Closing 결제 조회 | 모든 결제 관련 화면 |
| payments | `(customer_id)` | AdminCustomers 목록/상세 | 고객 결제 총합 |
| check_in_services | `(check_in_id)` | Dashboard 시술항목, History 상세 | 서비스 정보 조회 |
| room_assignments | `(clinic_id, work_date)` | AdminStaff 주간 배정 | 주간 근무표 |
| daily_closings | `(clinic_id, close_date)` | AdminClosing 일마감 | UNIQUE여야 함 |
| staff | `(clinic_id, active)` | Dashboard, Staff 목록 | 활성 직원 필터 |
| services | `(clinic_id, active)` | Dashboard 시술 목록 | 활성 서비스 필터 |

**SQL 수정:**

```sql
-- 핵심 인덱스 (필수)
CREATE INDEX idx_check_ins_clinic_date ON check_ins(clinic_id, created_date);
CREATE INDEX idx_check_ins_customer ON check_ins(customer_id);
CREATE INDEX idx_reservations_clinic_date ON reservations(clinic_id, reservation_date);
CREATE INDEX idx_reservations_customer_date ON reservations(customer_id, reservation_date);
CREATE INDEX idx_payments_check_in ON payments(check_in_id);
CREATE INDEX idx_payments_customer ON payments(customer_id);
CREATE INDEX idx_check_in_services_check_in ON check_in_services(check_in_id);

-- 보조 인덱스 (권장)
CREATE INDEX idx_room_assignments_clinic_date ON room_assignments(clinic_id, work_date);
CREATE UNIQUE INDEX idx_daily_closings_clinic_date ON daily_closings(clinic_id, close_date);
CREATE INDEX idx_staff_clinic_active ON staff(clinic_id, active);
CREATE INDEX idx_services_clinic_active ON services(clinic_id, active);
CREATE INDEX idx_notifications_check_in ON notifications(check_in_id);
```

### 1-2. NOT NULL 누락 (심각도: 🟡 MEDIUM)

비즈니스 로직상 반드시 값이 있어야 하는 FK 컬럼이 nullable로 정의됨:

| 컬럼 | 현재 | 권장 | 이유 |
|------|------|------|------|
| `check_ins.clinic_id` | NULL 허용 | NOT NULL | 모든 체크인은 특정 지점에 속함 |
| `reservations.clinic_id` | NULL 허용 | NOT NULL | 예약은 반드시 지점 지정 |
| `reservations.customer_id` | NULL 허용 | NOT NULL | 예약은 반드시 고객 연결 |
| `check_in_services.check_in_id` | NULL 허용 | NOT NULL | 서비스는 체크인 없이 존재 불가 |

```sql
-- 기존 NULL 데이터 확인 후 실행
ALTER TABLE check_ins ALTER COLUMN clinic_id SET NOT NULL;
ALTER TABLE reservations ALTER COLUMN clinic_id SET NOT NULL;
ALTER TABLE reservations ALTER COLUMN customer_id SET NOT NULL;
ALTER TABLE check_in_services ALTER COLUMN check_in_id SET NOT NULL;
```

### 1-3. CHECK 제약 누락 (심각도: 🟡 MEDIUM)

```sql
ALTER TABLE payments ADD CONSTRAINT chk_payments_amount CHECK (amount > 0);
ALTER TABLE check_ins ADD CONSTRAINT chk_check_ins_queue CHECK (queue_number > 0);
ALTER TABLE clinics ADD CONSTRAINT chk_clinics_interval CHECK (slot_interval > 0);
```

### 1-4. ENUM 미사용 (심각도: 🟢 LOW)

status, method 등이 자유 TEXT — 오타/비표준 값 삽입 가능. 초기엔 CHECK 제약으로 충분:

```sql
ALTER TABLE check_ins ADD CONSTRAINT chk_check_ins_status
  CHECK (status IN ('waiting','consultation','treatment_waiting','treatment','done','no_show'));

ALTER TABLE reservations ADD CONSTRAINT chk_reservations_status
  CHECK (status IN ('reserved','checked_in','cancelled'));

ALTER TABLE payments ADD CONSTRAINT chk_payments_method
  CHECK (method IN ('card','cash'));

ALTER TABLE payments ADD CONSTRAINT chk_payments_type
  CHECK (payment_type IS NULL OR payment_type IN ('payment','refund'));
```

### 1-5. daily_closings 중복 방지 누락 (심각도: 🔴 HIGH)

`daily_closings`에 `(clinic_id, close_date)` UNIQUE 제약이 없어 동일 날짜에 여러 마감 레코드가 생길 수 있다. 코드에서 `.maybeSingle()`을 쓰지만 두 명이 동시에 "임시저장"하면 중복 발생.

```sql
ALTER TABLE daily_closings ADD CONSTRAINT uq_daily_closings_clinic_date
  UNIQUE (clinic_id, close_date);
```

---

## 2. RLS 정책 점검

### 2-1. 지점 간 데이터 격리 없음 (심각도: 🔴 CRITICAL)

**현재 상태:** 모든 RLS 정책이 `USING (true)` 또는 `auth.role() = 'authenticated'`로만 구분.

| 테이블 | SELECT 정책 | 문제 |
|--------|------------|------|
| check_ins | `USING (true)` | **익명 사용자가 모든 지점의 체크인 데이터(이름+전화번호) 조회 가능** |
| customers | `USING (true)` | **익명 사용자가 전체 고객 DB(전화번호 포함) 조회 가능** |
| reservations | `USING (true)` (SELECT+UPDATE) | **익명 사용자가 모든 예약 데이터 조회 및 수정 가능** |
| payments | `auth.role() = 'authenticated'` | 인증된 사용자가 다른 지점 결제 데이터 접근 가능 |
| 나머지 | 마이그레이션에서 RLS 설정 미확인 | services, staff, room_assignments 등 RLS 미설정 가능성 |

**권장 구조:** 사용자-지점 매핑 테이블 도입 후 clinic_id 기반 정책

```sql
-- 1) 사용자-지점 매핑 (향후 멀티테넌시 지원)
CREATE TABLE clinic_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT DEFAULT 'staff',
  UNIQUE(clinic_id, user_id)
);

-- 2) 지점 격리 함수
CREATE OR REPLACE FUNCTION user_clinic_ids()
RETURNS SETOF UUID AS $$
  SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 3) 예시: check_ins 정책 재설정
DROP POLICY IF EXISTS "public_read_own" ON check_ins;
DROP POLICY IF EXISTS "public_insert" ON check_ins;

-- 익명: 자기 체크인만 읽기 (QR 대기화면용)
CREATE POLICY "anon_read_own_checkin" ON check_ins
  FOR SELECT USING (id = current_setting('request.jwt.claims', true)::json->>'check_in_id'
    OR auth.role() = 'authenticated');

-- 인증 직원: 소속 지점만
CREATE POLICY "staff_read_clinic_checkins" ON check_ins
  FOR SELECT USING (clinic_id IN (SELECT user_clinic_ids()));

-- 체크인 삽입: 특정 clinic_id에만 (공개 키오스크)
CREATE POLICY "public_insert_checkin" ON check_ins
  FOR INSERT WITH CHECK (true);  -- clinic_id는 앱이 제어
```

**임시 완화 조치 (clinic_members 없이도 적용 가능):**

```sql
-- 최소한 check_ins의 고객 정보를 익명 사용자로부터 보호
DROP POLICY IF EXISTS "public_read_own" ON check_ins;

-- 익명: 자기 check_in ID로만 조회 (대기화면)
CREATE POLICY "anon_read_own" ON check_ins
  FOR SELECT USING (
    auth.role() = 'authenticated'
    OR id::text = current_setting('request.headers', true)::json->>'x-check-in-id'
  );

-- customers: 익명은 phone 매칭으로만 접근 (체크인 시 필요)
DROP POLICY IF EXISTS "public_select_customers" ON check_ins;
-- 주의: 이 변경은 셀프 체크인 플로우 테스트 필요
```

### 2-2. 마이그레이션 외 테이블 RLS 확인 필요 (심각도: 🟡 MEDIUM)

다음 테이블들은 마이그레이션 파일에 CREATE 문이 없어 Lovable 또는 Supabase Dashboard에서 생성된 것으로 추정. RLS 상태 확인 필요:

- `services`
- `staff`
- `room_assignments`
- `check_in_services`
- `daily_closings`
- `clinic_schedules`
- `clinic_holidays`

```sql
-- 확인 쿼리 (Supabase SQL Editor에서 실행)
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('services','staff','room_assignments','check_in_services',
                     'daily_closings','clinic_schedules','clinic_holidays');
```

---

## 3. 데이터 정합성

### 3-1. next_queue_number 레이스 컨디션 (심각도: 🔴 HIGH)

현재 함수:
```sql
SELECT COALESCE(MAX(queue_number), 0) + 1
FROM check_ins WHERE clinic_id = p_clinic_id AND created_date = CURRENT_DATE;
```

두 명이 동시에 체크인하면 같은 번호를 받을 수 있다. `LANGUAGE sql`은 트랜잭션 격리 수준을 보장하지 않음.

**수정:**

```sql
CREATE OR REPLACE FUNCTION public.next_queue_number(p_clinic_id UUID)
RETURNS INT AS $$
DECLARE
  v_next INT;
BEGIN
  -- Advisory lock으로 동시성 제어 (clinic_id 해시 기반)
  PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id::text || CURRENT_DATE::text));

  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_next
  FROM public.check_ins
  WHERE clinic_id = p_clinic_id AND created_date = CURRENT_DATE;

  RETURN v_next;
END;
$$ LANGUAGE plpgsql SET search_path = public;
```

### 3-2. 예약→체크인 연결 불안정 (심각도: 🟡 MEDIUM)

CheckIn.tsx에서 예약 매칭 로직:
```typescript
.eq('customer_id', customerId)
.eq('reservation_date', today)
.eq('status', 'reserved')
.limit(1).maybeSingle()
```

문제: 같은 날 같은 고객이 2건 예약이 있으면 **시간 무관하게 첫 번째만** 매칭. `reservation_time` 기준 정렬이 없음.

또한 AdminReservations.tsx의 `handleCheckIn`은 reservation.status를 `checked_in`으로 바꾸지만, 이것이 check_in 레코드의 `reservation_id` 설정과 **별개 트랜잭션**이다. 중간에 실패하면 예약만 checked_in이고 실제 체크인 레코드는 없는 상태.

**권장:** Supabase Edge Function이나 DB function으로 atomic하게 처리

### 3-3. 결제-체크인 고아 레코드 (심각도: 🟢 LOW)

`payments.check_in_id`는 ON DELETE CASCADE이므로 체크인 삭제 시 결제도 삭제됨 — OK.
하지만 환불 등록(AdminClosing.tsx)에서 `check_in_id: ci?.id || null` — 매칭 실패 시 **고아 결제 레코드** 생성.

---

## 4. 개인정보

### 4-1. 전화번호 평문 저장 + 익명 접근 가능 (심각도: 🔴 CRITICAL)

**현재:**
- `customers.phone`: 평문 저장
- `check_ins.customer_phone`: 비정규화된 평문 전화번호
- RLS: `USING (true)` → **아무나 REST API로 전체 고객 전화번호 조회 가능**

```bash
# 인증 없이도 가능한 공격
curl 'https://izegeboamrcczhhvghwo.supabase.co/rest/v1/customers?select=name,phone' \
  -H 'apikey: <anon_key>'
```

**즉시 대응:**

```sql
-- 1) customers SELECT 정책 변경 — 인증 사용자만
DROP POLICY IF EXISTS "public_select_customers" ON customers;
CREATE POLICY "auth_select_customers" ON customers
  FOR SELECT USING (auth.role() = 'authenticated');

-- 2) 셀프 체크인 시 고객 조회를 위한 RPC 함수 (phone만 매칭, 전체 노출 방지)
CREATE OR REPLACE FUNCTION public.find_customer_by_phone(p_clinic_id UUID, p_phone TEXT)
RETURNS TABLE(id UUID, name TEXT) AS $$
  SELECT id, name FROM customers
  WHERE clinic_id = p_clinic_id AND phone = p_phone
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
```

### 4-2. check_ins 비정규화 PII (심각도: 🟡 MEDIUM)

`check_ins`에 `customer_name`, `customer_phone`이 복사되어 있어 `customers` 테이블을 정리해도 PII가 남음.
개인정보 보관 기한(동의서에 명시된 기간) 후 자동 삭제 필요.

```sql
-- 30일 이상 된 check_ins의 PII 마스킹 (스케줄 함수로 매일 실행)
CREATE OR REPLACE FUNCTION public.mask_old_pii()
RETURNS void AS $$
BEGIN
  UPDATE check_ins
  SET customer_phone = '***-****-' || RIGHT(customer_phone, 4),
      customer_name = LEFT(customer_name, 1) || '**'
  WHERE created_date < CURRENT_DATE - INTERVAL '30 days'
    AND customer_phone NOT LIKE '***%';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Supabase pg_cron으로 매일 새벽 실행
-- SELECT cron.schedule('mask-old-pii', '0 3 * * *', 'SELECT mask_old_pii()');
```

---

## 5. 성능

### 5-1. Dashboard Realtime 과도한 리패치 (심각도: 🟡 MEDIUM)

AdminDashboard.tsx:353 — `check_ins` UPDATE 이벤트마다 `fetchCheckIns(clinicId)` 전체 재조회. 이 함수는 check_ins + payments + check_in_services 3개 테이블을 순차 조회.

**영향:** 바쁜 시간대에 상태 변경이 빈번하면(분당 10+건) 불필요한 DB 부하.

**권장:** UPDATE payload에서 변경된 row만 in-place 업데이트하고, payments/services는 필요 시에만 재조회.

### 5-2. AdminCustomers 목록 조회 비효율 (심각도: 🟡 MEDIUM)

AdminCustomers.tsx:60-89 — 고객 목록(최대 100건) 조회 후, 전체 고객 ID를 `IN` 절로 check_ins와 payments를 각각 조회. 고객이 많아지면:
- `IN` 절에 100개 UUID → PostgreSQL 파싱 비용
- 반환 데이터: 100명 × N건 방문/결제 → 대량 데이터 전송

**권장:** DB 뷰 또는 RPC로 집계:

```sql
CREATE OR REPLACE FUNCTION customer_summary(p_clinic_id UUID, p_search TEXT DEFAULT NULL, p_limit INT DEFAULT 100)
RETURNS TABLE(
  id UUID, name TEXT, phone TEXT, memo TEXT,
  visit_count BIGINT, total_payments BIGINT, last_visit TIMESTAMPTZ
) AS $$
  SELECT c.id, c.name, c.phone, c.memo,
    COUNT(DISTINCT ci.id) AS visit_count,
    COALESCE(SUM(p.amount), 0) AS total_payments,
    MAX(ci.checked_in_at) AS last_visit
  FROM customers c
  LEFT JOIN check_ins ci ON ci.customer_id = c.id
  LEFT JOIN payments p ON p.customer_id = c.id
  WHERE c.clinic_id = p_clinic_id
    AND (p_search IS NULL OR c.name ILIKE '%' || p_search || '%' OR c.phone ILIKE '%' || p_search || '%')
  GROUP BY c.id
  ORDER BY c.updated_at DESC
  LIMIT p_limit;
$$ LANGUAGE sql STABLE SET search_path = public;
```

### 5-3. ilike 검색 시 SQL Injection 경로 (심각도: 🟡 MEDIUM)

AdminReservations.tsx:200 및 AdminLayout.tsx:104:
```typescript
.or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
```

Supabase JS SDK의 `.or()` 메서드는 내부적으로 파라미터를 이스케이프하지만, `%` 와일드카드가 사용자 입력에 포함되면 의도치 않은 패턴 매칭 가능. 또한 `%` 앞뒤 와일드카드는 인덱스를 탈 수 없어 항상 Full Scan.

**권장:** pg_trgm 인덱스:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_customers_name_trgm ON customers USING gin(name gin_trgm_ops);
CREATE INDEX idx_customers_phone_trgm ON customers USING gin(phone gin_trgm_ops);
```

### 5-4. 페이지네이션 부재 (심각도: 🟢 LOW)

현재 대부분 `.limit(50)` 또는 `.limit(100)` 하드코딩. 지금은 괜찮지만, 운영 1년 후 고객 데이터가 쌓이면 커서 기반 페이지네이션 필요.

---

## 6. 백업/복구

### 6-1. daily_closings 확정 해제 시 데이터 불일치 (심각도: 🟡 MEDIUM)

AdminClosing.tsx:293 — "마감 해제" 시 status를 `draft`로 변경하지만, 확정 이후 추가/삭제된 결제 데이터는 반영 안됨. 확정 시점의 system totals 스냅샷이 없어 "확정 당시 뭐였는지" 복원 불가.

**권장:** `daily_closings`에 confirmed_snapshot 컬럼 추가 또는 별도 이력 테이블

### 6-2. 소프트 삭제 미적용 (심각도: 🟢 LOW)

check_ins, payments 등에 하드 삭제가 가능하나, 실제 코드에서 DELETE는 room_assignments와 check_in_services 정도. 문제는 clinic 삭제 시 ON DELETE CASCADE로 **모든 하위 데이터가 일괄 삭제**되는 것.

**권장:** clinics에 `deleted_at` 컬럼 추가, CASCADE 대신 RESTRICT

---

## 7. Supabase Realtime

### 7-1. REPLICA IDENTITY 설정 현황

| 테이블 | REPLICA IDENTITY | Realtime 구독 여부 | 상태 |
|--------|-----------------|-------------------|------|
| check_ins | FULL ✅ | Dashboard, WaitingScreen | OK |
| reservations | FULL ✅ | AdminReservations | OK |
| payments | DEFAULT ⚠️ | 미구독 | 결제 후 대시보드 수동 리패치 |
| customers | DEFAULT ⚠️ | 미구독 | 고객 수정 시 반영 안됨 |
| 나머지 | DEFAULT ⚠️ | 미구독 | 현재 문제 없음 |

### 7-2. Dashboard Realtime 필터 효율성 (심각도: 🟢 LOW)

AdminDashboard.tsx:342 — `filter: clinic_id=eq.${clinicId}` 사용 중. Supabase는 서버사이드 필터를 지원하므로 OK. 하지만 WaitingScreen.tsx:78은 `filter: id=eq.${checkInId}`로 **단일 행 구독** — 이것은 효율적.

---

## 우선순위 요약

| # | 이슈 | 심각도 | 수정 난이도 | 비고 |
|---|------|--------|-----------|------|
| 1 | RLS: 익명 사용자 전체 고객 데이터 접근 가능 | 🔴 CRITICAL | 중 | 즉시 대응 필요 — 개인정보 유출 위험 |
| 2 | 인덱스 전무 | 🔴 HIGH | 하 | SQL 한 번으로 해결, 서비스 중단 없음 |
| 3 | next_queue_number 레이스 컨디션 | 🔴 HIGH | 하 | 함수 교체만으로 해결 |
| 4 | daily_closings UNIQUE 제약 누락 | 🔴 HIGH | 하 | 중복 마감 방지 |
| 5 | check_ins PII 비정규화 + 보관 기한 없음 | 🟡 MEDIUM | 중 | pg_cron 마스킹 필요 |
| 6 | NOT NULL 제약 누락 | 🟡 MEDIUM | 하 | 기존 NULL 데이터 확인 후 적용 |
| 7 | CHECK 제약/ENUM 미사용 | 🟡 MEDIUM | 하 | 점진적 적용 가능 |
| 8 | Dashboard 과도한 리패치 | 🟡 MEDIUM | 중 | 코드 리팩터링 필요 |
| 9 | AdminCustomers N+1 유사 패턴 | 🟡 MEDIUM | 중 | RPC 함수 권장 |
| 10 | 마감 확정 해제 시 스냅샷 없음 | 🟡 MEDIUM | 중 | 스키마 변경 필요 |
| 11 | 소프트 삭제 미적용 | 🟢 LOW | 중 | 장기 과제 |
| 12 | 페이지네이션 부재 | 🟢 LOW | 중 | 데이터 성장 후 대응 |
