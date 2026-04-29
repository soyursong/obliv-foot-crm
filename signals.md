# FDD Signals — obliv-foot-crm

## 2026-04-30 [T-20260430-foot-SEARCH-DOB-CHART] deployed — 고객검색 생년월일(YYMMDD) + 차트번호 추가

> **ticket**: T-20260430-foot-SEARCH-DOB-CHART | **priority**: P1 | **status**: deployed
> **commit**: 3ed4246 | **qa_grade**: Yellow | **qa_result**: pass

### 변경 요약
- DB: customers.birth_date (text), customers.chart_number (text) 컬럼 추가 + 인덱스
- AdminLayout: 글로벌 검색에 birth_date/chart_number ilike 조건 추가, 드롭다운 힌트 표시
- AdminCustomers: 목록 검색 확장, 테이블에 생년월일·차트번호 컬럼 표시
- CreateCustomerDialog / CustomerDetailSheet: 입력·편집·표시 지원
- 빌드: tsc + vite build ✅ 에러 0

---

## 2026-04-30 [T-20260430-foot-TREATMENT-LABEL] deploy-ready — 진료종류 라벨 변경 + 5개 필드 추가

> **ticket**: T-20260430-foot-TREATMENT-LABEL | **priority**: P1 | **status**: deploy-ready | **assignee**: dev-foot

### 변경 요약
- UI: "시술종류" → "진료종류" 라벨 전체 변경 (CheckInDetailSheet, Packages)
- DB: check_ins 테이블 컬럼 5개 추가 (consultation_done, treatment_kind, preconditioning_done, pododulle_done, laser_minutes) — 적용 완료
- CheckInDetailSheet: 진료종류 섹션 신설 (상담유무 토글, 치료종류 선택, 프컨/포돌 토글, 레이저시간 입력)
- 빌드: tsc + vite build ✅ 에러 0

### QA 체크
- ✅ 빌드 PASS (에러 0)
- ✅ 기존 컬럼 미변경 — ADD COLUMN IF NOT EXISTS, default/nullable 안전
- ✅ 라벨 2곳 일괄 변경
- ✅ 롤백 SQL 포함

---

## 2026-04-30 [T-20260430-foot-REFERRER] deployed — 추천인 필드 추가

> **ticket**: T-20260430-foot-REFERRER | **priority**: P1 | **status**: deployed
> **qa_grade**: Yellow | **qa_result**: pass | **deploy-approval-requested**: 2026-04-30T05:20:00+09:00

### QA 5항목 결과
- ✅ 빌드 — tsc + vite build 성공, 에러 0
- ✅ 기존 기능 미파괴 — nullable 컬럼 추가만, 기존 INSERT/UPDATE/SELECT 미변경
- ✅ DB 호환성 — ADD COLUMN IF NOT EXISTS, ON DELETE SET NULL 자기참조 FK 안전
- ✅ 권한/RLS — 기존 RLS 그대로, anon INSERT clinic_id 조건 만족
- ✅ 롤백 SQL — migration 파일 내 rollback 포함

### 권장 후속 (차기 티켓 감)
- referrer_id 설정 시 상세뷰 "(고객 연결됨)" 표시 — 실제 추천인 이름 JOIN 표시로 개선 권장

---

## 2026-04-29 [T-20260429-foot-PAYMENT-PACKAGE-INTEGRATED] deploy-ready — CheckInDetailSheet 통합 결제+회차차감

> **ticket**: T-20260429-foot-PAYMENT-PACKAGE-INTEGRATED | **priority**: P0 | **status**: deploy-ready  
> **commit**: a6e92c9 | **build**: PASS (tsc + vite 2.33s) | **assignee**: dev-foot

### 운영 차단 해소 내역

#### 1. 활성 패키지 잔여회차 요약 카드 (상단 표시)
- `ActivePackageSummary` 컴포넌트 추가 — StageNavButtons 바로 아래 노출
- 가열/비가열/수액/사전처치 잔여회차 뱃지 (컬러 구분)
- 패키지가 있는 모든 방문 타입(신규/재진)에 표시

#### 2. 시술 항목 선택 + 회차 차감 분기
- `+ 추가` 버튼 → `ServiceSelectModal` (카테고리별 시술 카탈로그)
- `sessionTypeFromService()` 헬퍼: category/name 텍스트로 세션타입 자동 추론
- 항목별 분기:
  - 패키지 잔여 있음 → **[패키지 회차 사용]** 버튼 (teal)
  - 잔여 없음 → **[단건 결제]** 버튼 → PaymentDialog

#### 3. SessionUseInSheetDialog (시트 내 인라인 회차 소진)
- Packages.tsx `UseSessionDialog` 패턴 재사용
- 세션 타입 전환, 추가금 입력 지원
- `package_sessions` INSERT → `get_package_remaining` RPC로 잔여회차 즉시 갱신

#### 4. 수납대기 전환 버튼
- 회차 소진 완료 항목 존재 + 수납대기 이전 상태일 때 자동 표시
- `status_transitions` 기록 포함

#### 5. 회귀 보호 스펙
- `tests/e2e/regressions/R-2026-04-29-payment-package-integrated.spec.ts`
- T1(패키지 카드 표시), T2(인터랙션), T3(패키지없음→단건결제), T4(DB검증), T5(수납대기버튼)

### supervisor 검토 요청
- 프로덕션 배포 승인 필요

---

## 2026-04-26 [foot-051] deploy-ready — 대기실 화면 + 셀프 키오스크 + 일일 이력 enhancement

> **ticket**: T-20260420-foot-051 | **priority**: P3 | **status**: deploy-ready

### 변경 내역

#### 1. Waiting.tsx — 룸 안내 표시
- check_ins에서 `examination_room`, `consultation_room`, `treatment_room`, `laser_room` 필드 추가 조회
- CalledCard(진행중)에 "치료실 3번으로 와주세요" 스타일 룸 안내 배너 표시
- WaitingCard(대기중)에도 룸 배정 시 안내 표시
- 상태→룸 매핑: exam→진료실, consult→상담실, preconditioning→치료실, laser→레이저실

#### 2. SelfCheckIn.tsx — 한국어/영어 다국어 지원
- `Lang` 타입 ('ko' | 'en') + 전체 UI 문자열 번역 맵 `T`
- 우상단 고정 언어 전환 버튼 (🇺🇸 EN ↔ 🇰🇷 한국어)
- 전 화면(입력/확인/완료/에러/클리닉미발견) 번역 적용
- NumPad clearLabel prop 추가

#### 3. DailyHistory.tsx — 방문유형 필터 추가
- `VisitFilter` 타입 ('all' | 'new' | 'returning' | 'experience')
- 기존 상태 필터 아래에 방문유형 필터 버튼 행 추가 (건수 표시)
- 선택 시 색상 매칭 (신규=teal, 재진=emerald, 체험=amber)

### 빌드 확인
- `tsc -b && vite build` 성공 (0 error, 2.32s)
- 기존 기능 영향 없음 (추가만, 삭제 없음)

---

## 2026-04-20 QA 결과 → dev-foot 수정 요청

### P0 즉시 수정 (5건)

**#1 priority_flag 컬럼 타입 불일치**
- DB: BOOLEAN (initial_schema), 코드: TEXT ('CP'|'#'|null)
- `ADD COLUMN IF NOT EXISTS`가 no-op → 컬럼 여전히 BOOLEAN
- 수정: `ALTER TABLE check_ins ALTER COLUMN priority_flag TYPE TEXT USING NULL;`
- 파일: `20260419000000_initial_schema.sql:154`, `20260420000007_dashboard_fields.sql:8`

**#2 payments/package_payments에 clinic_id 없음**
- Closing.tsx가 클리닉 필터 없이 전체 결제 합산
- 수정: 두 테이블에 `clinic_id` 추가 + Closing 쿼리 필터

**#3 Packages 프리셋 키 'preset_12' 존재하지 않음**
- `applyPreset('preset_12')` → PRESETS에 없음 → 기본값 엉망
- 수정: `Packages.tsx:242` → `applyPreset('package1')`

**#4 패키지 진행률 항상 0%**
- `CheckInDetailSheet.tsx:275` — total_sessions - total_sessions = 0
- 수정: get_package_remaining RPC의 total_used 사용

**#5 user_profiles.role CHECK에 'staff' 누락**
- DEFAULT 'staff'인데 CHECK에 'staff' 없음 → INSERT 실패
- 수정: `ALTER TABLE user_profiles DROP CONSTRAINT ...; ALTER TABLE user_profiles ADD CONSTRAINT ... CHECK (role IN ('admin','manager','consultant','coordinator','therapist','technician','tm','staff'));`

### P1 중요 (9건)

- #6 `<title>tmp-init</title>` → 오블리브 풋센터 CRM
- #7 대기번호 이중 로직 (Dashboard Math.max vs RPC) → RPC 통일
- #8 RETURNING_PATIENT_STAGES에 exam/consult/payment 경로 누락
- #9 Closing 쿼리 clinic_id 필터 없음 (P0 #2와 연동)
- #10 모바일 미대응 (사이드바 w-56 고정)
- #11 RLS 전원 풀 권한 (역할별 제한 없음)
- #12 전화번호 중복 시 에러 메시지 불친절
- #13 Realtime 구독 날짜 필터 없음
- #14 Queue number race condition (SELECT MAX 방식)

### P2 개선 (13건)
QA_REPORT.md 참조

---

## 2026-04-20 풀사이클 브라우저 테스트 결과

> 테스트: 초진(예약→접수→체크리스트→진료→상담→결제→시술→레이저→완료) + 재진(워크인→직행→완료)
> 방법: Supabase REST API를 통한 전 단계 데이터 흐름 검증

### 수정 확인 완료 (P0/P1 기존 이슈 중)

| 원래 번호 | 이슈 | 상태 |
|-----------|------|------|
| P0 #1 | priority_flag BOOLEAN→TEXT 변환 | ✅ 수정됨 — 'CP', '#' 모두 저장 가능 |
| P0 #3 | Packages 프리셋 키 'preset_12' | ✅ 수정됨 — `applyPreset('package1')` + 별도 `packagePresets.ts` 모듈 |
| P0 #4 | 패키지 진행률 항상 0% | ✅ 수정됨 — `rem.total_used / pkg.total_sessions` 사용 |
| P1 #8 | RETURNING_PATIENT_STAGES 누락 | ✅ 수정됨 — exam/consult/payment 경로 포함 |

### ⚠️ 미수정 → ✅ 수정 완료

| 번호 | 이슈 | 상태 |
|------|------|------|
| P0 #2 | payments/package_payments에 clinic_id 없음 | ✅ 수정됨 — PaymentDialog + Packages에서 clinic_id 추가, 기존 데이터 백필 완료 |
| P0 #5 | user_profiles.role CHECK에 'staff' 누락 | ✅ 수정됨 — DROP + ADD CONSTRAINT 완료 |

### 🆕 풀사이클 테스트 신규 발견

**#15 [P0] next_queue_number RPC 오버로드 충돌** → ✅ 수정됨
- 단일 파라미터 오버로드 DROP + 모든 호출에 p_date 추가

**#16 [P1] NEW_PATIENT_STAGES에 preconditioning/laser 누락** → ✅ 수정됨
- status.ts에 preconditioning, laser 추가

**#17 [P1] PaymentDialog clinic_id 누락** → ✅ 수정됨
- PaymentDialog 단일/분할 결제 + Packages package_payments에 clinic_id 추가

**#18 [P2] 세션 소진 자동화 부재** → ✅ 수정됨
- check-in done 전환 시 autoDeductSession() 자동 호출 (lib/session.ts)

**#19 [P2] 체크인 상태 전이 제약 없음**
- DB에 상태 순서 강제 없음 — `registered→done` 직행 가능
- 필수 단계 건너뛰기 방지 장치 없음 (체크리스트 미작성 환자가 결제로 이동 등)
- **제안**: DB 트리거 또는 프론트 가드로 유효 전이만 허용

**#20 [P2] treatment_memo JSONB 컨벤션 불일치**
- 마이그레이션 주석: `{"memo": "텍스트"}` 컨벤션
- CheckInDetailSheet.tsx: `{"details": "텍스트"}` 사용
- 향후 다른 컴포넌트가 `.memo` 키로 접근하면 데이터 불일치 발생
- **수정**: `.details`로 통일하고 마이그레이션 주석 업데이트

---

## 2026-04-20 2차 테스트 — 엣지케이스 + 수정 검증

> 기존 수정(#15~#18) 코드·DB 양쪽 검증 완료 후, 엣지케이스 집중 탐색

### 🆕 신규 발견

**#21 [P1] autoDeductSession 과소진/이중소진 방지 없음** → ✅ 수정됨
- remaining 체크 + 중복 check_in_id 스킵 + session_type 자동 판별 + UNIQUE(package_id, check_in_id) 제약 추가

**#22 [P1] 일괄 체크인 중복 생성 가능** → ✅ 수정됨
- batchCheckIn에 기존 check_in 존재 시 skip + UNIQUE INDEX on reservation_id (WHERE NOT NULL) + 기존 중복 데이터 정리

**#23 [P1] RefundDialog 환불 결제에 clinic_id 누락** → ✅ 수정됨
- RefundDialog에 clinicId prop 추가 + package_payments insert에 clinic_id 포함

**#24 [P1] 이미 환불된 패키지 재환불 가능** → ✅ 수정됨
- 환불 버튼 disabled={pkg.status === 'refunded'} + process()에 status 사전 체크

**#25 [P2] Dashboard 낙관적 업데이트 경합 조건**
- `Dashboard.tsx:832` — `const prev = rows` 캡처 후, 동시 드래그 시 stale 참조 복원
- 드래그 A 실패 → setRows(prevA) → 이미 진행된 드래그 B 상태 유실
- **제안**: useRef로 latest rows 관리 또는 React Query invalidation 방식으로 전환

**#26 [P2] Closing CSV 특수문자 미이스케이프**
- `Closing.tsx:286` — `r.join(',')` 사용, 쉼표·따옴표 포함 메모 시 CSV 깨짐
- **수정**: 각 셀을 `"${cell.toString().replace(/"/g, '""')}"` 처리

**#27 [P2] 고객 방문·결제 이력 50건 잘림**
- `Customers.tsx` — visits/payments 쿼리 `.limit(50)`, 페이지네이션 없음
- 방문 횟수 표시가 실제 방문수가 아닌 로드된 건수만 카운트
- **제안**: 총 건수는 `count: 'exact'` 별도 쿼리, UI에 "더보기" 추가

**#28 [P2] Closing vs Dashboard 날짜 경계 불일치**
- Dashboard `fetchCheckIns` (L643): `${dateStr}T00:00:00+09:00` — KST 하드코딩
- Closing `dayBoundsISO` (L67-70): `new Date('${date}T00:00:00')` — 브라우저 로컬타임
- 비KST 브라우저 접속 시 대시보드와 마감의 "오늘" 범위 상이
- **수정**: 두 곳 모두 `+09:00` 또는 공용 유틸 사용

**#29 [P2] status_transitions 자기 전이 기록 + room_id 미사용**
- 룸 재배정 시 `from_status === to_status` (예: laser→laser) 기록됨 — 감사 추적 노이즈
- `room_id` 컬럼 존재하나 Dashboard에서 항상 null 전달
- **수정**: 동일 상태 전이는 skip, room_id에 실제 룸명 기록

---

> 전체 상세: `/QA_REPORT.md`
> 작성: Gold QA (2026-04-20)
> 대상: dev-foot 세션에서 P0부터 순차 처리

---

## 2026-04-20 UX 감사 — 신입 코디 관점 전수 점검

> 기준: 입사 첫 날 코디가 5분 내 파악·사용할 수 있는가?  
> 범위: Dashboard, Reservations, Customers, Packages, Closing, Staff, CheckInDetailSheet, 다이얼로그 전체

### UX-1 발견성 제로: 드래그앤드롭 / 우클릭

| 위치 | 문제 |
|------|------|
| Dashboard 전체 | 카드가 드래그 가능하다는 시각적 단서 없음. `cursor-grab`은 hover 시에만 나타나고, 드래그 핸들 아이콘 없음. 신입 코디는 카드를 클릭만 시도 |
| StatusContextMenu | 우클릭 컨텍스트 메뉴 존재를 알 방법이 전혀 없음. 마우스 오른쪽 버튼을 누르라는 안내·아이콘·툴팁 0개 |
| DraggableCard (L84-225) | PointerSensor 5px 임계값 — 클릭과 드래그 구분 미세. TouchSensor 200ms 딜레이 — 태블릿에서 동작 안 한다고 착각할 수 있음 |

**영향**: 코어 워크플로우 자체를 못 찾음  
**제안**: 카드 좌측에 ⠿ 드래그 핸들 아이콘, 첫 접속 시 온보딩 툴팁 ("카드를 끌어서 이동하세요"), 우클릭 대안으로 ⋯ 더보기 버튼

### UX-2 글씨 크기: 10px 이하 남발

| 위치 | 사이즈 | 내용 |
|------|--------|------|
| DraggableCard compact 배지 | `text-[9px]` | 신규/재진 구분 배지 — 거의 안 보임 |
| 패키지 라벨 | `text-[9px]` | 패키지명 + 잔여회차 |
| TimeSlotAccordion 화살표 | `text-[8px]` | ▶/▼ 펼침 토글 — 읽기 불가 |
| RoomSlot 담당자 | `text-[9px]` | 담당 치료사 이름 |
| DroppableColumn 카운트 | `text-[10px]` | 칼럼 카드 수 |
| Reservations 노쇼 배지 | `text-[9px]` | 노쇼 이력 표시 |
| Customers 세션 잔여 | `text-[11px]` | 가열/비가열/수액/프리컨 |
| Packages 회차 소진 라벨 | `text-[10px]` | 세션 타입별 잔여 |
| ConsentForm 서명 안내 | `text-[10px]` | "위 박스 안에 서명해 주세요" |
| PreChecklist 발톱 버튼 | `text-[10px]` | 엄지(좌), 검지(좌) 등 |

**영향**: 40대 이상 직원 가독성 심각, 태블릿 1m 거리에서 판독 불가  
**제안**: 최소 `text-xs`(12px), 중요 정보는 `text-sm`(14px). 배지·카운트는 최소 11px

### UX-3 클릭 과다: 빈번 작업에 3~6번 클릭

| 작업 | 현재 클릭 수 | 문제 |
|------|-------------|------|
| 워크인 체크인 | 5+ | 헤더 버튼→이름→전화→유형→제출 |
| 결제 처리 | 6+ | 카드 드래그→결제하기 클릭→방법→금액→할부→완료 |
| 패키지 생성 | 7+ | 버튼→고객 검색→선택→프리셋→회차 조정→가격→저장 |
| 예약 수정 | 3 | 예약 클릭→수정 버튼→편집 다이얼로그 (직접 편집이면 2번이면 됨) |
| 룸 배정 (Staff) | N×1 | 방 개수만큼 드롭다운 반복, 전날 복사 기능 없음 |
| 회차 소진 (Packages) | 4 | 상세→소진 버튼→타입 선택→저장 |

**제안**: 워크인은 이름+전화만으로 즉시 체크인, 결제는 카드 클릭 시 바로 결제 다이얼로그, 룸배정은 전날 복사 버튼

### UX-4 라벨·용어 혼란

| 라벨 | 위치 | 문제 |
|------|------|------|
| "초진예약" | Dashboard 1열 | 예약 환자 + 접수 완료 신환이 같은 칸 — 예약인지 접수인지 모호 |
| "재진(진료)" vs "재진(직행)" | Dashboard 4·5열 | 괄호 안 한 글자 차이. 신입이 구분 불가 |
| "결제매출" vs "소진매출" | Dashboard 결제·완료 칼럼 | "소진"이 무슨 뜻인지 모름. "완료 매출" 또는 "시술 완료 매출"이 명확 |
| "프리컨" | 패키지, 체크리스트 전반 | preconditioning 약어. 신입은 이해 불가. "프리컨디셔닝" 풀네임 또는 "사전처치" |
| "블레라벨" | Packages 프리셋 | 브랜드명이라 설명 없으면 의미 불명 |
| "금액" | PaymentDialog 분할결제 | "카드 금액"/"현금 금액"으로 명시해야 함 |
| "할부" | PaymentDialog | 할부가 병원 측 정산에 어떤 영향인지 설명 없음 |
| "메모" | 3개 이상 화면에 동시 존재 | 상담 메모, 진료 소견, 시술 기록, 보험 메모 — 어느 걸 먼저 채워야 하는지 모름 |
| "임시저장" vs "마감 처리" | Closing | 차이 미설명. 임시저장 후 언제 마감해야 하는지 가이드 없음 |

### UX-5 확인 없는 위험 동작

| 동작 | 위치 | 결과 |
|------|------|------|
| 체크인 취소 | StatusContextMenu | 한 클릭으로 즉시 취소. 확인 다이얼로그 없음 |
| 보험 영수증 삭제 | InsuranceDocPanel | hover 시 나타나는 🗑 클릭 → 즉시 삭제 |
| 처방전 삭제 | InsuranceDocPanel | 동일 |
| 사진 삭제 | PhotoUpload | hover 시 나타나는 X 클릭 → 즉시 삭제 |
| 패키지 연결 | CheckInDetailSheet | "이 시술에 연결" 한 클릭 → 즉시 반영 |
| 예약 취소 | Reservations | 확인 없이 상태 변경 |
| 패키지 환불/양도 | Packages | 환불·양도 버튼 클릭 시 즉시 실행 |
| 드래그 이동 | Dashboard | 실수로 드롭해도 취소·되돌리기 없음 |

**제안**: 삭제·취소·환불은 반드시 "정말 삭제하시겠습니까?" 확인. 드래그 실수는 토스트에 "되돌리기" 버튼 추가

### UX-6 버튼 크기: 태블릿/터치 부적합

| 위치 | 크기 | 문제 |
|------|------|------|
| CheckInDetailSheet 패키지 연결 | `h-6` (24px) | 최소 44px 권장 (Apple HIG) |
| InsuranceDocPanel 등록 버튼 | `size="sm"` text-xs | 24-28px — 터치 오타 유발 |
| PreChecklist 발톱 선택 | `gap-1.5` 10개 버튼 | 버튼 간격 6px — 옆 버튼 터치 가능 |
| PhotoUpload 삭제 | `h-5 w-5` (20px) | 터치 불가 수준 |
| PaymentDialog 할부 옵션 | 3×2 그리드 text-xs | 좁은 버튼 밀집 |
| ConsentForm 다시쓰기 | `size="sm"` h-3 아이콘 | 서명 캔버스 옆 작은 버튼 |
| 모바일 햄버거 메뉴 | `h-5 w-5` | 20px — 터치 타겟 부족 |

**제안**: 모든 주요 버튼 최소 `h-9`(36px), 터치 디바이스는 `h-10`(40px) 이상

### UX-7 정보 과부하

| 위치 | 문제 |
|------|------|
| CheckInDetailSheet | 13개 섹션이 400px 시트에 전부 수직 나열. 접기·펼치기 없음 |
| DraggableCard compact | 2줄 카드에 6개 정보 (번호, 이름, 유형, 패키지, 경과시간, 우선) |
| Closing 합계 | 3개 카드 × 4~5 행 = 15개 숫자 한 번에 노출. 어떤 숫자가 중요한지 모름 |
| Customers 상세 시트 | 4개 탭에 각각 50건 이상 데이터 (방문, 결제, 예약, 패키지) — 페이지네이션 없음 |
| Packages 생성 다이얼로그 | 15개+ 입력 필드 한 화면에 — 위저드 분할 필요 |
| PreChecklist | 10개+ 섹션 스크롤 — 진행 표시 없음 |

**제안**: CheckInDetailSheet 아코디언 섹션, 체크리스트 단계별 위저드, Customers 탭 페이지네이션

### UX-8 피드백 부재

| 상황 | 문제 |
|------|------|
| 전화번호 blur 시 기존 고객 감지 | 토스트만 띄움. 방문유형 자동 변경을 놓칠 수 있음 |
| 분할 결제 | 제출 전 요약 없음. 카드 X원 + 현금 Y원 합계 확인 불가 |
| 사진 업로드 | "업로드 중…" 텍스트만. 진행률 바 없음, 파일 크기 제한 없음 |
| 패키지 프리셋 적용 | 어떤 값이 변경됐는지 하이라이트 없이 조용히 반영 |
| 마감 저장 | "저장 완료" 토스트만. 실제 저장된 값 요약 없음 |
| 서명 캔버스 | 한 획 낙서도 "서명 완료"로 인정. 최소 복잡도 검증 없음 |
| 폼 검증 | 전화번호 형식 미검증, 금액 실시간 포맷팅 없음, 필수 필드 표시 없음 |

### UX-9 네비게이션·동선 문제

| 문제 | 설명 |
|------|------|
| 고객 상세 → 예약 생성 불가 | 고객 페이지에서 바로 예약 못 만듦. 예약 페이지로 이동 후 다시 고객 검색 |
| 고객 상세 → 패키지 생성 불가 | 패키지 페이지로 별도 이동 필요 |
| 사이드바에 알림 없음 | 미결제 건수, 미배정 룸, 오늘 예약 건수 등 뱃지 미표시 |
| 브레드크럼 없음 | 현재 위치 확인 어려움 (특히 모바일) |
| Staff 룸배정 날짜 이동 | 전날 배정 복사 기능 없음. 매일 27개 룸 수동 배정 |
| Closing에서 미수 건 클릭 불가 | 미수 경고 리스트가 읽기전용. 클릭해서 결제로 이동 불가 |

### UX-10 일관성 부족

| 항목 | 불일치 내용 |
|------|------------|
| 색상 코딩 | 신규 환자: Dashboard `teal` 배지, 예약 `blue-500` 도트, NewCheckInDialog `teal` — 3곳 다름 |
| 시간 표시 | "HH:MM" / "HH:MM 경과" / "MM:SS" / 타임스탬프 혼용 |
| 결제 아이콘 | PaymentDialog: 💳💵🏦 이모지, Dashboard: CreditCard Lucide 아이콘 |
| 배지 크기 | DraggableCard `h-4 text-[9px]`, 다른 곳 `text-xs` — 같은 데이터 다른 크기 |
| 대기번호 | 어떤 곳은 `#3`, 어떤 곳은 숫자만. 형식 불통일 |
| 상태 변경 방법 | 드래그, 우클릭 메뉴, 버튼 클릭 — 3가지 다른 인터랙션. 어느 것이 "정답"인지 모름 |
| 라벨 존댓말 | "상담 내용을 기록하세요" vs "시술 기록, 사용 장비, 특이사항" — 존칭/비존칭 혼용 |

### UX-11 접근성

| 문제 | 설명 |
|------|------|
| 키보드 내비게이션 | 대부분 마우스 전용. Tab 순서 미정의, 키보드 단축키 0개 |
| 서명 캔버스 aria-label | 없음. 스크린리더 사용 불가 |
| 색상 대비 | `text-muted-foreground` (회색 텍스트) + 작은 글씨 = 저시력 사용자 판독 불가 |
| 포커스 인디케이터 | 드래그앤드롭에 포커스 표시 없음. 키보드로 카드 선택 불가 |

---

> 작성: dev-foot UX 감사 (2026-04-20)
> 대상: 신입 코디 5분 테스트 기준, 전 페이지 코드 리뷰
> 총 발견: 11개 카테고리, 60건+ 개별 이슈

---

## 2026-04-20 UI/UX 2차 심층 리뷰 — 5인 전문가 관점

> 검수자: 시니어 UI/UX 디자이너, 프론트엔드 QA, 접근성 전문가, 신입 코디, 바쁜 상담실장
> 범위: Dashboard, Reservations, Customers, Packages, Closing, Staff, AdminLayout, 전체 다이얼로그·시트
> 방법: 코드 정적 분석 + localhost:5173 브라우저 확인

### [LAYOUT] 레이아웃·여백·정렬

**L-1 [P1] 칸반 총 너비 고정 — 가로 스크롤 강제**
- Dashboard 칼럼 총합 ~2100px 이상. 1920px 모니터에서도 overflow 발생
- `overflow-x-auto` 적용돼 있으나, 스크롤바가 아래에만 있어 우측 칼럼 존재를 모름
- `Dashboard.tsx` 칸반 레이아웃 `flex gap-3` — 칼럼 min-width 없이 콘텐츠 기반 확장
- **수정**: 칼럼 max-width 제한 + 좌우 화살표 네비게이션 또는 반응형 접기

**L-2 [P1] 사이드바 w-56 고정 — 태블릿 대응 실패**
- `AdminLayout.tsx:102` — `w-56`(224px) 고정. iPad(768px)에서 본문 544px
- 칸반 2100px 콘텐츠를 544px에 넣으면 사실상 사용 불가
- 모바일 오버레이(`z-40 md:hidden`) 있으나 md(768px) 이상이면 사이드바 고정 표시
- **수정**: lg(1024px) 미만에서도 접이식 사이드바 적용, 또는 상단 탭바로 전환

**L-3 [P2] RoomSection 그리드 갭 불균일**
- `Dashboard.tsx:604` — `grid gap-1.5` 동일하지만 treatment(3열), consultation(3열), laser(4열) 그리드 칼럼 수 다름
- 치료실 9개 → 3×3 정사각, 레이저 12개 → 4×3 — 시각적 밀도 불일치
- 빈 방 `border-dashed` vs 점유 방 `border-gray-300` 대비가 약함 (둘 다 gray 계열)
- **수정**: 통일된 그리드 or 방 갯수에 따른 자동 열 수 계산

**L-4 [P2] CheckInDetailSheet 시트 폭·높이 제한 없음**
- `SheetContent` 기본 max-w 사용. 내부 13개 섹션이 수직 나열 — 길이가 2000px+ 가능
- 모바일에서 시트가 화면 전체 덮으며, 닫기 버튼이 스크롤 상단에만 존재
- **수정**: max-h 설정 + 내부 스크롤, 또는 아코디언 접기/펼치기

**L-5 [P2] Closing 카드 3장 수평 배치 — 좁은 화면 깨짐**
- `Closing.tsx` — 3개 CardContent 가로 배열. 768px 이하에서 카드 내 숫자 줄바꿈
- **수정**: md 이하에서 vertical stack

**L-6 [P2] Reservations 주간 그리드 시간 컬럼 너비 미고정**
- 시간 슬롯(09:00~18:00) 좌측 열 너비가 콘텐츠에 따라 유동 — 예약 많은 날 레이아웃 흔들림
- **수정**: 시간 컬럼 w-16 고정

**L-7 [P2] Staff 페이지 카드 그리드 브레이크포인트 갭**
- sm(2열) → md(3열) 전환 시 카드 크기 급변. xl 이상에서 빈 공간 과다
- **수정**: 점진적 브레이크포인트 (sm:2, md:3, lg:4)

### [COLOR] 색상·상태 구분

**C-1 [P1] 빨간색 과부하 — 4가지 의미 혼용**
- `destructive`(환불/취소 버튼), `noshow`(예약 노쇼), 30분 초과 경고(`text-red-600`), 레이저 20분 초과(`ring-red-300`) 모두 빨간색
- 바쁜 상담실장은 "빨간 카드 = 문제"로만 인식 → 긴급 환자 vs 단순 시간 초과 구분 불가
- **수정**: 시간 경고는 `amber/orange`, 노쇼는 `red`, 취소/환불은 `gray-destructive`, 레이저 초과는 `pulse` 애니메이션

**C-2 [P1] 초진/재진 배지 색상 불일치 (3곳)**
- Dashboard DraggableCard: `variant="teal"` / `variant="secondary"`
- Reservations: `border-l-blue-500` / `border-l-emerald-500`
- NewCheckInDialog: teal 계열
- 같은 "초진"이 teal, blue 두 가지로 표현됨
- **수정**: 전역 색상 토큰 정의. 초진=teal, 재진=emerald, 체험=amber 통일

**C-3 [P1] 색맹 안전성 미확보**
- 빨강/초록(대기/진행) 조합: 적녹색맹 약 8% 남성이 구분 불가
- 배지에 색상만 사용, 아이콘·패턴 보조 수단 없음
- **수정**: 배지에 아이콘(●, ◆, ▲) 추가, 또는 테두리 스타일 차별화

**C-4 [P2] DroppableColumn 드래그 오버 색상 단일**
- `isOver && 'border-teal-400 bg-teal-50/40'` — 유효 드롭/무효 드롭 구분 없음
- 잘못된 칼럼에 놓아도 같은 하이라이트 → 드롭 후 에러 토스트
- **수정**: 유효=teal, 무효=red 하이라이트 + 커서 변경

**C-5 [P2] DraggableCard urgency 색상 3단계 구분 모호**
- `mins >= 40`: `border-red-400 ring-red-200`, `mins >= 20`: `border-orange-300 ring-orange-100`
- 20분과 40분 차이가 border 색조(orange→red)뿐. 카드 배경색 변화 없어 10장 이상일 때 식별 어려움
- **수정**: 배경색까지 단계별 적용 (bg-yellow-50 → bg-orange-50 → bg-red-50)

### [TEXT] 라벨·텍스트·폰트

**T-1 [P0] text-[9px]~text-[10px] 남발 — 최소 가독 기준 미달**
- 10개 이상 위치에서 9~10px 사용 (UX-2에 상세 목록)
- WCAG 최소 권장 12px (text-xs). 병원 현장 40대+ 직원 다수
- 특히 DraggableCard compact 모드에서 패키지 잔여(`text-[11px]`), 경과시간(`text-[10px]`), 방 이름(`text-[10px]`)
- **수정**: 전역 최소 font-size text-xs(12px), 중요 정보 text-sm(14px)

**T-2 [P1] 용어 불일치: 프리컨/사전처치/preconditioning**
- `status.ts`: `preconditioning: '사전처치'`
- `packagePresets.ts`: `preconditioning` (영문 키)
- 패키지 UI: "프리컨" 약어 사용
- 신입 코디에게 3가지 표현이 같은 것인지 혼란
- **수정**: UI 표시는 "사전처치"로 통일, 코드 키는 `preconditioning` 유지

**T-3 [P1] "소진매출" 의미 불명확**
- Dashboard 완료 칼럼 subtitle에 소진매출 표시
- "소진"이 패키지 회차 소진인지, 완료 환자 매출인지 즉시 이해 불가
- **수정**: "시술완료 매출" 또는 "당일 완료 매출"

**T-4 [P2] 메모 필드 4종 구분 불가**
- doctor_note(진료소견), treatment_memo(시술기록), consult_memo(상담메모), notes(일반메모)
- CheckInDetailSheet에서 4개가 나열되나 우선순위·작성 시점 가이드 없음
- **수정**: 각 메모 위에 "작성 시점: ○○ 단계에서" 부제 추가

**T-5 [P2] Closing "임시저장" vs "마감 처리" 차이 미설명**
- 두 버튼 나란히 배치. 임시저장 후 마감까지의 프로세스 안내 없음
- **수정**: 임시저장 버튼 아래 "마감 전 수정 가능" 안내 텍스트

**T-6 [P2] 결제 다이얼로그 "금액" 라벨 모호**
- 분할결제 시 "금액" 입력 필드 2개 — 카드/현금 구분이 placeholder에만 의존
- **수정**: Label을 "카드 결제 금액", "현금 결제 금액"으로 명시

### [FLOW] 클릭 동선·인터랙션

**F-1 [P1] 드래그앤드롭 발견성 제로**
- DraggableCard에 `cursor-grab` hover 스타일만 존재. 드래그 핸들 아이콘(`GripVertical`)이 h-3 w-3 — 거의 안 보임
- 신입 코디는 클릭만 시도하다가 상태 변경 방법을 못 찾음
- **수정**: GripVertical 크기 h-4 w-4 + color 강조, 첫 접속 온보딩 툴팁

**F-2 [P1] 우클릭 컨텍스트 메뉴 존재 미고지**
- StatusContextMenu가 onContextMenu에만 바인딩. 안내·아이콘·툴팁 없음
- `MoreVertical` 버튼(L161-171)이 대안이나 h-3.5 크기로 발견 어려움
- **수정**: MoreVertical 크기 확대 + "상태변경" 라벨 표시

**F-3 [P1] 고객 상세 → 예약/패키지 생성 불가**
- 고객 페이지에서 해당 고객 예약 만들기, 패키지 만들기로 이동하는 단축 경로 없음
- 예약/패키지 페이지 이동 후 고객 재검색 필요
- **수정**: 고객 상세 시트에 "예약 생성", "패키지 등록" 바로가기 버튼

**F-4 [P2] 룸 배정 전날 복사 기능 없음**
- Staff 페이지에서 매일 27개 룸 × 담당자 수동 배정
- 전날과 동일 배정이 대다수인 현장에서 반복 작업 과다
- **수정**: "전날 배정 복사" 버튼 추가

**F-5 [P2] Closing 미수 건 클릭 → 결제 이동 불가**
- 미수 경고 리스트가 읽기전용 텍스트. 클릭해서 해당 환자 결제 화면으로 이동 불가
- **수정**: 미수 건 클릭 시 Dashboard 해당 체크인으로 이동 + 결제 다이얼로그 자동 오픈

**F-6 [P2] 상태 변경 방법 3가지 혼재**
- 드래그, 우클릭 메뉴, CheckInDetailSheet 내 버튼 — 동일 작업 3가지 경로
- 어느 것이 "정답"인지 신입이 혼란
- **수정**: 메인 경로(드래그) 강조, 보조 경로(메뉴/버튼) 일관된 UI로 통합

**F-7 [P2] 분할결제 합계 미리보기 없음**
- PaymentDialog 분할결제 시 카드 X원 + 현금 Y원 입력 후 합계 확인 없이 바로 제출
- 총액 불일치 시 에러 → 사후 대응
- **수정**: 실시간 합계 표시 + 총액 불일치 시 제출 버튼 비활성화

### [BUG] 기능 버그·데이터 정합성

**B-1 [P1] 드래그 실수 되돌리기 불가** → ✅ 수정됨
- toastWithUndo: 모든 드래그 성공 토스트에 "되돌리기" 버튼 5초 표시, 클릭 시 원래 상태로 복원

**B-2 ~~[P1] handleContextStatusChange에서 done 전환 시 autoDeductSession 미호출~~ → ✅ 정상**
- `Dashboard.tsx:1068-1072` — 컨텍스트 메뉴 경로에서도 autoDeductSession 호출 확인됨
- 드래그(L1023)와 컨텍스트 메뉴(L1068) 양쪽 모두 동일하게 세션 소진

**B-3 [P2] 예약 체크인 중복 방지가 프론트만**
- `Reservations.tsx:192-199` — 체크인 전 existing 체크 있지만 프론트 로직만
- UNIQUE INDEX 있으나 (`20260420000010`), 동시 요청 시 race window 존재
- 실질적으로 DB 제약이 최종 방어선이므로 큰 문제는 아님

**B-4 [P2] anonymous 체크인 허용 — customer_id null** → ✅ 수정됨
- NewCheckInDialog에서 전화번호 필수 검증 추가 (phone 빈 값이면 체크인 버튼 비활성화)

**B-5 [P2] Closing dayBoundsISO 브라우저 로컬타임 사용 (#28 상세)**
- `Closing.tsx:67-70` — 비KST 브라우저에서 날짜 경계 어긋남
- Dashboard는 `+09:00` 하드코딩으로 KST 고정
- **수정**: 공용 KST 유틸 함수로 통일

### [A11Y] 접근성

**A-1 [P1] 키보드 내비게이션 전무** → ✅ 부분 수정
- N키 → 새 체크인 다이얼로그 오픈 단축키 추가 (input 필드 포커스 시 무시)

**A-2 [P1] 터치 타겟 44px 미달 (7개소)** → ✅ 수정됨
- PhotoUpload 삭제(h-9), InsuranceDocPanel 버튼(h-9), 모바일 햄버거(min-h-36px), CheckInDetailSheet 패키지연결(h-9), ConsentForm 다시쓰기(h-9), PaymentDialog 할부(h-9)

**A-3 [P2] 서명 캔버스 aria-label 없음**
- ConsentFormDialog 캔버스 요소에 role, aria-label 미설정
- 스크린리더 사용자 인지 불가
- **수정**: `role="img" aria-label="서명 캔버스"`

**A-4 [P2] 색상 대비 부족**
- `text-muted-foreground`(~#999) + 작은 글씨(10px) = WCAG AA 4.5:1 미달 가능
- 특히 DroppableColumn 카운트, RoomSlot 담당자명, TimeSlot 지나간 시간
- **수정**: muted-foreground 최소 #666 이상, 또는 font-weight 보강

**A-5 [P2] 포커스 인디케이터 미표시**
- 대부분 인터랙티브 요소에 `focus:outline` 또는 `focus-visible:ring` 미적용
- Tab 키로 이동 시 현재 포커스 위치 시각적 확인 불가
- **수정**: 전역 focus-visible 스타일 정의

---

### 수정 검증 요약 (#21~#24)

| 번호 | 이슈 | 코드 확인 | DB 확인 |
|------|------|-----------|---------|
| #21 | autoDeductSession 과소진 방지 | ✅ remaining 체크 + dup 스킵 + session_type 자동 판별 (`session.ts:4-43`) | ✅ UNIQUE(package_id, check_in_id) (`migration 0010`) |
| #22 | 일괄 체크인 중복 방지 | ✅ existing check → skip (`Reservations.tsx:192-199`) | ✅ UNIQUE INDEX on reservation_id WHERE NOT NULL (`migration 0010`) |
| #23 | RefundDialog clinic_id 누락 | ✅ clinicId prop + insert에 clinic_id 포함 (`Packages.tsx:961,986`) | — |
| #24 | 이미 환불된 패키지 재환불 | ✅ pkgStatus === 'refunded' 사전 차단 (`Packages.tsx:980-983`) | — |

### 🆕 추가 발견

**#30 [P1] ~~컨텍스트 메뉴 done 전환 시 세션 미소진~~ → ✅ 이미 수정됨**
- `Dashboard.tsx:1068-1072` handleContextStatusChange에 autoDeductSession 호출 확인됨
- 드래그(L1023)와 컨텍스트 메뉴(L1068) 양쪽 모두 세션 소진 정상 동작

---

> 작성: Gold QA UI/UX 2차 심층 리뷰 (2026-04-20)
> 검수: 5인 전문가 관점 (시니어 UI/UX, 프론트 QA, 접근성, 신입 코디, 상담실장)
> 총 발견: 6개 카테고리, 35건 (LAYOUT 7, COLOR 5, TEXT 6, FLOW 7, BUG 5, A11Y 5) + 수정검증 4건 + 신규 P1 1건

---

## 2026-04-26 [foot-051] 대기실 화면 + 셀프 키오스크 + 일일 이력 — deploy-ready

> 작성: dev-foot (2026-04-26)
> 상태: **deploy-ready**

### 변경 파일
1. `src/pages/Waiting.tsx` — 대기실 TV 화면 강화
2. `src/pages/SelfCheckIn.tsx` — 셀프 키오스크 모드 강화
3. `src/pages/DailyHistory.tsx` — 신규 생성 (일일 이력 페이지)
4. `src/App.tsx` — DailyHistory 라우트 추가 (`/admin/history`)
5. `src/components/AdminLayout.tsx` — 네비게이션 "일일 이력" 항목 추가
6. `src/index.css` — pulse-subtle 키프레임 애니메이션 추가

### 구현 내역

**Waiting.tsx (대기실 화면)**
- 호출 사운드: 새 환자가 진행 중 상태로 전환 시 beep 알림
- 대기 시간 표시: 각 환자 카드에 경과시간 (20분↑ 주황, 40분↑ 빨강)
- 풀스크린 토글: 헤더에 풀스크린 버튼 (Fullscreen API)
- 자동 스크롤: 오버플로우 시 부드럽게 위/아래 자동 스크롤
- 오늘 통계: 총 접수 / 진행 중 / 완료 카운트 헤더 표시
- 호출 카드 펄스 애니메이션: 진행 중 환자 카드에 emerald 그림자 펄스

**SelfCheckIn.tsx (셀프 키오스크)**
- 자동 리셋: 접수 완료 15초 후 자동 초기화 (카운트다운 표시)
- 비활동 타임아웃: 입력 화면 60초 무입력 시 폼 리셋
- 예약 매칭: 전화번호 10자리 입력 시 당일 예약 자동 조회 + 배너 표시 + 방문유형 자동 채움
- 온스크린 숫자패드: 3×4 그리드 (h-14 터치 타겟), 소프트키보드 비활성화
- 접수 완료 강화: 대기번호 text-8xl, 클리닉명 표시, 체크마크 펄스 애니메이션

**DailyHistory.tsx (일일 이력) — 신규**
- 날짜 네비게이션: 이전/다음 날, 오늘 버튼
- 요약 카드: 총 접수 / 신규·재진·체험 / 완료·취소 / 평균 소요시간
- 필터: 전체 / 진행중 / 완료 / 취소 (건수 표시)
- 정렬: 대기번호순 ↔ 접수시간순 토글
- 타임라인: 체크인 목록 (대기번호, 이름, 유형, 상태, 시간)
- 상태 전이 상세: 클릭 시 확장 (접수→체크리스트→진료→... 플로우 + 시간 테이블)

### 빌드 결과
- `npm run build` ✅ 성공 (tsc + vite, 1.89s)
- 신규 npm 패키지 없음

### 후속 리팩터링 (2026-04-26)
- STATUS_COLOR / VISIT_TYPE_COLOR / CALLED_STATUSES 상수를 `src/lib/status.ts`로 통합
- Waiting.tsx, DailyHistory.tsx에서 중복 정의 제거 → import로 대체
- `_pending/`, `_pending_patches/` stale 파일 정리 (모두 소스에 이미 반영)
- 빌드 ✅ (1.89s)
