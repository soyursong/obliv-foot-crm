# 풋센터 CRM 종합 QA 리포트

> 일시: 2026-04-20  
> 대상: http://localhost:8083 (obliv-foot-crm)  
> Supabase: rxlomoozakkjesdqjtvd  
> QA 범위: 전 페이지 코드 리뷰 + DB 스키마 검증 + 역할별 시뮬레이션

---

## P0 — 치명적 (코어 워크플로우 차단)

### 1. `priority_flag` 컬럼 타입 불일치 (DB BOOLEAN vs 코드 TEXT)
- **위치**: `20260419000000_initial_schema.sql:154` → `20260420000007_dashboard_fields.sql:8`
- **원인**: 초기 스키마가 `priority_flag BOOLEAN DEFAULT false`로 생성. 이후 마이그레이션이 `ADD COLUMN IF NOT EXISTS priority_flag TEXT`를 시도하지만, 이미 컬럼이 존재하므로 no-op.
- **증상**: 
  - DB에서 `"CP"` 설정 시 `invalid input syntax for type boolean: "CP"` 에러
  - Dashboard 우선 배지가 "true" 문자열로 렌더링
  - 실질적으로 CP/# 마킹 기능 전체 불능
- **검증**: `PATCH /check_ins {"priority_flag":"CP"}` → 22P02 에러 확인
- **수정**: `ALTER TABLE check_ins ALTER COLUMN priority_flag TYPE TEXT USING NULL; ALTER TABLE check_ins ALTER COLUMN priority_flag SET DEFAULT NULL; ALTER TABLE check_ins ADD CONSTRAINT ... CHECK (priority_flag IS NULL OR priority_flag IN ('CP','#'));`

### 2. `payments` 테이블에 `clinic_id` 컬럼 없음
- **위치**: `20260419000000_initial_schema.sql:244-254`
- **영향**: `Closing.tsx:92-96` — 일마감 페이지가 결제를 날짜만으로 조회하여 전체 클리닉 결제를 합산. 멀티 클리닉 확장 시 매출이 혼합됨.
- **같은 문제**: `package_payments` 테이블도 `clinic_id` 없음 → `Closing.tsx:107-110`에서 글로벌 합산
- **수정**: 두 테이블에 `clinic_id UUID REFERENCES clinics(id)` 추가 + 인덱스 + Closing 쿼리 필터 추가

### 3. Packages 생성 다이얼로그 — 프리셋 키 불일치
- **위치**: `Packages.tsx:222,242`
- **원인**: `applyPreset('preset_12')` 호출하지만 PRESETS 키는 `'package1'`, `'package2'`, `'blelabel'`, `'1month'`, `'nopain'`. `'preset_12'`는 존재하지 않아 lookup 실패.
- **증상**: 패키지 생성 다이얼로그 열 때 `heated=1, unheated=8, iv=0, precon=12, price=1,200,000` 같은 의미 없는 기본값으로 시작. 실수로 잘못된 구성의 패키지가 생성될 위험.
- **수정**: `applyPreset('package1')` 또는 별도 초기값 설정

### 4. CheckInDetailSheet — 패키지 진행률 항상 0%
- **위치**: `CheckInDetailSheet.tsx:275`
- **원인**: `usedPct = (total_sessions - (heated + unheated + iv + preconditioning)) / total_sessions` 계산. heated+unheated+iv+preconditioning = total_sessions이므로 분자가 항상 0.
- **증상**: 패키지 프로그레스 바가 항상 비어있음 (0%)
- **수정**: `get_package_remaining` RPC 결과의 `total_used`를 사용해 계산

### 5. `user_profiles.role` CHECK 제약에 'staff' 누락
- **위치**: `20260419000000_initial_schema.sql:80`
- **원인**: DB CHECK: `('admin','manager','consultant','coordinator','therapist','technician','tm')` — 'staff' 없음. 하지만 `role DEFAULT 'staff'`이고 TypeScript UserRole에 'staff' 포함.
- **증상**: 기본 role 'staff'로 user_profiles INSERT 시 CHECK 위반 에러
- **수정**: CHECK에 'staff' 추가

---

## P1 — 중요 (UX 저하 / 데이터 무결성 위험)

### 6. 페이지 타이틀 "tmp-init"
- **위치**: `index.html:9`
- **수정**: `<title>오블리브 풋센터 CRM</title>`

### 7. 대기번호 이중 로직 → 중복 가능
- **위치**: `Dashboard.tsx:871` vs `NewCheckInDialog.tsx:160`
- Dashboard의 `handleReservationCheckIn`은 `Math.max(...rows) + 1`로 계산, NewCheckInDialog는 `next_queue_number` RPC 사용. 동시 접속 시 같은 번호 배정 가능.
- **수정**: Dashboard도 RPC 사용으로 통일

### 8. StatusContextMenu — 재진 환자 스테이지 불완전
- **위치**: `status.ts:30-36`
- `RETURNING_PATIENT_STAGES = ['registered', 'treatment_waiting', 'preconditioning', 'laser', 'done']`
- 원장 진료 필요한 재진 환자의 경로 (`exam_waiting → examination → payment_waiting`)가 누락
- **영향**: 우클릭 메뉴에서 진료대기/원장실 등의 단계를 선택할 수 없음

### 9. Closing 쿼리에 clinic_id 필터 없음 (payments)
- **위치**: `Closing.tsx:92-96, 107-110`
- payments 테이블에 clinic_id가 없어 필터링 자체가 불가하지만, check_in_id → check_ins.clinic_id JOIN으로 우회해야 함
- 현재는 전체 결제 합산

### 10. 모바일 완전 미대응
- **위치**: `AdminLayout.tsx:50`
- 사이드바 `w-56` (224px) 고정, 반응형 접기 없음
- Dashboard 칸반 최소 너비 ~1800px, 모바일에서 사용 불가
- **영향**: 코디/치료사가 태블릿/스마트폰으로 접근 시 사실상 이용 불가

### 11. RBAC 미구현 — 전원 풀 권한
- **위치**: `20260419000001_rls_policies.sql`
- RLS 정책이 `authenticated = true`로만 설정. 역할 구분 없음.
- **영향**: 코디가 패키지 환불 가능, 치료사가 일마감 수정 가능, 누구나 직원 등록/삭제 가능

### 12. 전화번호 중복 가입 시 에러 메시지 불친절
- **위치**: `Customers.tsx:207`, `Reservations.tsx:404-407`
- DB unique 제약 위반 시 `"duplicate key value violates unique constraint"` 원문 노출
- **수정**: `phone.trim()` 검색 후 이미 존재하면 "이미 등록된 전화번호입니다" 안내

### 13. 대시보드 Realtime 날짜 필터 없음
- **위치**: `Dashboard.tsx:626-628`
- `filter: clinic_id=eq.${clinic.id}` — 날짜 필터 없이 전체 check_ins 변경 구독
- 과거 데이터 수정 시에도 불필요한 refetch 발생
- **영향**: 데이터 누적 시 성능 저하

### 14. Queue number race condition
- **위치**: `20260419000000_initial_schema.sql:357-366`
- `next_queue_number` RPC가 `MAX + 1`만 사용. 동시 호출 시 같은 번호 반환 가능
- **수정**: `SELECT ... FOR UPDATE` 또는 시퀀스 사용

---

## P2 — 개선사항 (폴리시 / 성능)

### 15. CheckInDetailSheet: services 데이터 로드 후 미사용
- `[, setServices] = useState` — 서비스 목록을 fetch하지만 렌더링하지 않음 (dead code)

### 16. Closing.tsx useEffect 의존성 부정확
- `[existing?.id, date]` → `existing` 객체 변경(memo, status 등) 감지 못함

### 17. Reservations.tsx 미사용 Plus import
- `void Plus;` 해킹으로 lint 우회. import 삭제 필요.

### 18. 확인 없는 위험 액션
- 예약 취소, 패키지 환불, 양도가 즉시 실행 (확인 다이얼로그 없음)

### 19. 결제 금액 입력 시 자동 포맷 불일치
- PaymentDialog에서 `amountStr`을 문자열로 관리하지만 `parseAmount` 적용 시점이 제출 시. 사용 중 쉼표 포맷이 적용되지 않아 큰 금액 입력 시 실수 유발.

### 20. Dashboard overtime 알림 무한 반복
- alertedIds에 추가되면 다시 울리지 않지만, 새로운 30분 초과 환자에 대해서만 1회 알림. "확인" 메커니즘 없음.

### 21. Clinic 타입에 overbooking 필드 누락
- `Clinic` interface에 `max_per_slot`, `overbooking_rate` 없음 → API에서 받아도 타입에서 무시

### 22. `payments.created_at`에 인덱스 없음
- Closing 페이지가 날짜 범위로 조회하지만 인덱스 부재 → 풀스캔

### 23. 예약 페이지 토요일 빈 슬롯 표시
- 22:00까지 표로 렌더링하지만 토요일은 19:00 마감 → 19:00~22:00 회색 빈 행 불필요

### 24. 'experience' 방문 유형 전용 워크플로우 없음
- `stagesFor('experience')` → returning 경로 사용. 체험 고객 전용 단축 경로 필요 가능성

### 25. 칸반 드롭 검증 없음
- 어떤 상태의 카드든 어디든 드롭 가능. 잘못된 역방향 이동 방지 로직 없음.

### 26. 색상 불일치
- 신규 환자: Dashboard 카드에서는 `teal` 배지, 예약에서는 `blue-500` 도트. 통일 필요.

### 27. 온보딩 가이드 부재
- 드래그앤드롭, 우클릭 상태 변경, 카드 클릭 상세보기 등 핵심 인터랙션에 대한 설명 없음. 신입 코디 관점에서 5분 내 파악 어려움.

---

## 역할별 시뮬레이션 결과

### 상담실장 (5명)
| 시나리오 | 결과 | 비고 |
|---------|------|------|
| 신환 접수 (체크인) | PASS | NewCheckInDialog 정상 작동 |
| 예약→체크인 전환 | PASS | 예약 카드 클릭→체크인 버튼 |
| 상담실 배정 (D&D) | PASS | 카드를 상담실 드롭 → 자동 상담사 배정 |
| 결제 처리 | PASS | 결제대기 드롭→PaymentDialog |
| 분할 결제 | PASS | 카드+현금 분할 작동 |
| 패키지 제안 | **FAIL** | 패키지 생성 시 프리셋 초기화 버그 (P0 #3) |
| CP 마킹 | **FAIL** | priority_flag BOOLEAN 버그 (P0 #1) |

### 코디 (4명, 신입 1명 포함)
| 시나리오 | 결과 | 비고 |
|---------|------|------|
| 체크인 접수 | PASS | |
| 대기 관리 | PASS | 경과 시간 표시, 30분 초과 빨간색 |
| 환자 안내 (방 이동) | PASS | D&D로 방 배정 |
| 태블릿 사용 | **FAIL** | 모바일/태블릿 대응 안됨 (P1 #10) |
| 신입 직관성 (5분 테스트) | **FAIL** | D&D, 우클릭 등 비표준 인터랙션 발견 불가 |

### 치료사 (15명)
| 시나리오 | 결과 | 비고 |
|---------|------|------|
| 시술 배정 확인 | PASS | Staff 페이지→공간 배정 탭 |
| 프리컨→레이저 순서 이동 | PASS | D&D 정상 |
| 비포/애프터 사진 | 미확인 | PhotoUpload 컴포넌트 존재, 실제 업로드 미테스트 |
| 시술 기록 작성 | PASS | CheckInDetailSheet 메모 저장 |

### 의사/원장 (1명)
| 시나리오 | 결과 | 비고 |
|---------|------|------|
| 초진 대기 환자 확인 | PASS | 진료대기 컬럼 |
| 원장실 배정 | PASS | D&D로 원장실 드롭 |
| 재진 진료 필요 환자 | **PARTIAL** | 재진(진료) 존에 표시되나, 우클릭 메뉴에서 경로 불완전 (P1 #8) |
| 처방전 작성 | 미확인 | InsuranceDocPanel 존재, 실제 처방 플로우 미테스트 |

---

## DB 아키텍트 시점

### 테이블 현황
| 테이블 | 행수 | 비고 |
|--------|------|------|
| clinics | 1 | 종로점 |
| customers | 15 | |
| services | 27 | |
| staff | 14 | |
| rooms | 27 | treatment 9 + laser 12 + consultation 5 + examination 1 |
| reservations | 15 | 4/20 당일 예약 |
| check_ins | 9 | |
| packages | 3 | |
| payments | 0 | |
| package_tiers | 6 | 프리셋 패키지 |
| room_assignments | 12 | |
| status_transitions | 14 | 감사로그 |

### 누락 인덱스
- `payments(created_at)` — Closing 조회용
- `package_payments(created_at)` — Closing 조회용
- `check_ins(customer_id)` — 고객별 방문 이력 조회
- `reservations(customer_id)` — 노쇼 이력 조회

### 150명/일 시뮬레이션 부하 예상
- Dashboard `fetchCheckIns`: 150건 전체 fetch → OK (단순 쿼리)
- Realtime: 상태 변경 1건마다 150건 재조회 → **병목** (1일 ~500회 상태변경 × 150건 = ~75,000 row reads)
- Closing 합계: payments + package_payments 날짜 필터 → 인덱스 없으면 풀스캔
- **권장**: 상태변경 시 refetch 대신 개별 row upsert 적용, Closing 인덱스 추가

---

## 수정 우선순위 (dev-foot 작업 순서 제안)

1. **P0 #1** priority_flag ALTER COLUMN → TEXT
2. **P0 #3** Packages 프리셋 키 수정
3. **P0 #4** 패키지 진행률 계산 수정
4. **P0 #5** user_profiles role CHECK에 'staff' 추가
5. **P0 #2** payments/package_payments에 clinic_id 추가
6. **P1 #6** 페이지 타이틀 수정
7. **P1 #7** 대기번호 RPC 통일
8. **P1 #8** RETURNING_PATIENT_STAGES 보강
9. **P1 #12** 전화번호 중복 UX 개선
10. 나머지 P1/P2는 시뮬레이션 후 우선순위 재조정
