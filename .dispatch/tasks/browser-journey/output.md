# 브라우저 역할별 여정 테스트 결과

**테스트 일시**: 2026-04-10 01:20~01:45
**테스트 대상**: https://happy-flow-queue.lovable.app (종로 롱래스팅센터)
**총 스크린샷**: 28장 (test-results/r1-tm-*, r2-coord-*, r3-consult-*, r4-customer-*, r5-desk-*)
**뷰포트**: Desktop 1440×900, Tablet 1024×768, Mobile 390×844

---

## 이슈 종합 (심각도별)

### 🔴 CRITICAL (운영 불가)

| # | 이슈 | 역할 | 파일/컴포넌트 | 스크린샷 |
|---|------|------|-------------|---------|
| C1 | **일마감 페이지 완전 백지** — 내비게이션 바 포함 전체 화면이 하얗게 렌더링. JS 런타임 에러로 React 트리 전체 unmount 추정 | 데스크 | `src/pages/AdminClosing.tsx` | r5-desk-01-closing-page.png |
| C2 | **직원관리 페이지 접근 불가** — 일마감에서 화면 깨진 후 내비 사라져 직원관리 도달 불가 | 데스크 | `src/pages/AdminStaff.tsx` | r5-desk-debug-01-closing.png (failed) |
| C3 | **고객이력 페이지 빈 데이터** — "고객 없음" 표시. 체크인/예약으로 등록된 고객이 고객이력 테이블에 미연동 | 상담실장 | `src/pages/AdminCustomers.tsx` | r3-consult-12-tablet-customer-history.png |

### 🟠 MAJOR (기능 결함)

| # | 이슈 | 역할 | 파일/컴포넌트 | 스크린샷 |
|---|------|------|-------------|---------|
| M1 | **"명명" 이중접미사 BUG** — 대기화면 "내 앞 대기 인원: 3명명" (명이 2번 표시) | 고객 | `src/pages/WaitingScreen.tsx` | r4-customer-03-waiting-screen.png |
| M2 | **대기인원 수 불일치** — Admin 대시보드: 대기 1, 상담 2/3 vs 대기화면: 대기 4명, 상담 0명 | 고객 | `src/pages/WaitingScreen.tsx` | r4-customer-03-waiting-screen.png |
| M3 | **상태변경 버튼 없음** — 고객 상세 Sheet에서 다음 단계로 이동하는 버튼 부재. 드래그만 가능하면 태블릿 사용 어려움 | 코디 | `src/pages/AdminDashboard.tsx` | r2-coord-02-card-detail-sheet.png |
| M4 | **결제 버튼 없음** — 고객 상세 Sheet에 결제/선결제 CTA 부재. 상담실장이 금액 확정 후 결제 시작 불가 | 상담실장 | 대시보드 Sheet | r2-coord-04-consult-card-detail.png |
| M5 | **글로벌 검색 "검색 결과 없음"** — 헤더 검색창에 "이정환" 입력 시 dropdown "검색 결과 없음" (대시보드에 존재하는 환자) | 상담실장 | `src/components/AdminLayout.tsx` | r3-consult-09-desktop-customer-search.png |
| M6 | **예약 모달 신규고객 등록 시 이름 미입력** — placeholder "이름" 필드에 fill()이 동작하지 않는 경우 있음. 등록 버튼 disabled 상태 지속 | TM | 예약 모달 | r1-tm-05-customer-filled.png |
| M7 | **예약 모달 이중 구조** — 신규 고객 폼 확장 시 취소/등록 + 취소/예약등록 버튼 2세트, 메모 필드 2개 표시 | TM | `src/pages/AdminReservations.tsx` | r1-tm-05-new-customer-form.png |

### 🟡 MINOR (UI/UX 개선)

| # | 이슈 | 역할 | 파일/컴포넌트 | 스크린샷 |
|---|------|------|-------------|---------|
| m1 | **시술 카테고리 영문** — SCALP, EYELINE 등 내부 코드명이 그대로 노출. 한글 카테고리명 필요 | 상담실장 | 시술추가 모달 | r3-consult-11-tablet-service-modal.png |
| m2 | **시술 목록 flat 구조** — 카테고리 탭/그룹핑 없이 전체 시술이 일렬 나열. 시술 수 증가 시 탐색 어려움 | 상담실장 | 시술추가 모달 | r3-consult-02-desktop-service-modal.png |
| m3 | **할인가 출처 불명** — 점막 라인 250,000→154,000원 할인이 어디서 온 건지 표시 없음 | 상담실장 | 시술추가 모달 | r3-consult-11-tablet-service-modal.png |
| m4 | **태블릿 시술방 잘림** — 3열 그리드(시술 1~15)에서 3·6·9·12·15번 방이 우측으로 잘림 | 코디 | `src/pages/AdminDashboard.tsx` | r2-coord-12-tablet-scrolled-right.png |
| m5 | **예약 페이지 헤더 검색** — "김" 입력해도 예약 캘린더가 필터되지 않음. 검색은 글로벌 검색으로만 작동 | TM | `src/pages/AdminReservations.tsx` | r1-tm-03-customer-search.png |

---

## 역할별 스크린샷 분석

### 역할 1: TM팀 (예약관리)
| 스크린샷 | 내용 | 비고 |
|---------|------|------|
| r1-tm-01-dashboard.png | 대시보드 — 대기 1, 상담 2/3, 시술 0/15, 완료 2 | 좌측 "오늘 예약 0건" |
| r1-tm-02-reservation-page.png | 주간 캘린더 4/6~4/12, 예약 0 워크인 6 매출 0만 | 20:30에 테스트환자+김승현 |
| r1-tm-03-customer-search.png | 헤더 검색 "김" — 캘린더 미필터 | 검색 UX 혼란 |
| r1-tm-04-new-reservation-modal.png | 예약 등록 모달 — 고객검색, 날짜, 시간, 메모 | 깔끔한 구성 |
| r1-tm-05-new-customer-form.png | 신규 고객 폼 — 이름/전화/메모 + 등록 버튼 | 이중 메모/버튼 문제 |
| r1-tm-05-customer-filled.png | 전화번호만 입력됨, 이름 비어있음 | 이름 fill 실패 |
| r1-tm-20-tablet-reservation-page.png | 태블릿 예약 캘린더 | 레이아웃 양호 |
| r1-tm-21-tablet-reservation-modal.png | 태블릿 예약 모달 | 모달 크기 적절 |
| r1-tm-22-tablet-dashboard.png | 태블릿 대시보드 — 시술방 우측 잘림 | m4 이슈 |

### 역할 2: 코디 (대시보드)
| 스크린샷 | 내용 | 비고 |
|---------|------|------|
| r2-coord-01-dashboard-overview.png | 전체 대시보드 | 칸반 보드 작동 |
| r2-coord-02-card-detail-sheet.png | 테스트워크인 #005 상세 — 마취크림, 시술항목, 메모 | 상태변경 버튼 없음(M3) |
| r2-coord-03-walkin-modal.png | 수동등록 모달 — 이름/전화/등록 | 간결한 폼 |
| r2-coord-04-consult-card-detail.png | 이정환 #004 상세 — 점막라인 154,000원, 메모 로그 | 상태이동 로그 자동 기록 ✅ |
| r2-coord-10-tablet-dashboard.png | 태블릿 대시보드 | 시술방 잘림 |
| r2-coord-11-tablet-card-detail.png | 태블릿 카드 상세 | Sheet 크기 양호 |
| r2-coord-12-tablet-scrolled-right.png | 가로 스크롤 후 | 시술방 보임 |

### 역할 3: 상담실장 (시술+가격)
| 스크린샷 | 내용 | 비고 |
|---------|------|------|
| r3-consult-01-desktop-detail.png | 이정환 상세 (데스크탑) | 시술/메모 확인 |
| r3-consult-02-desktop-service-modal.png | 시술추가 모달 — 7개 시술 flat 목록 | 카테고리 없음(m2) |
| r3-consult-08-desktop-customer-history.png | 고객이력 — "고객 없음" | 데이터 미연동(C3) |
| r3-consult-09-desktop-customer-search.png | 검색 "이정환" → "검색 결과 없음" | 글로벌 검색 실패(M5) |
| r3-consult-10-tablet-patient-detail.png | 태블릿 환자 상세 | 레이아웃 양호 |
| r3-consult-11-tablet-service-modal.png | 태블릿 시술추가 | 영문 카테고리(m1) |

### 역할 4: 고객 (셀프체크인)
| 스크린샷 | 내용 | 비고 |
|---------|------|------|
| r4-customer-01-checkin-page-desktop.png | 체크인 폼 — 이름/전화/방문경로/동의 | 깔끔, English 토글 ✅ |
| r4-customer-02-checkin-filled.png | 폼 입력 완료 상태 | |
| r4-customer-03-waiting-screen.png | 대기화면 #004 "대기" 내 앞 3명명 | "명명" 버그(M1), 인원 불일치(M2) |
| r4-customer-10-mobile-checkin.png | 모바일 체크인 | 반응형 완벽 ✅ |
| r4-customer-11-mobile-filled.png | 모바일 입력 완료 | |
| r4-customer-12-mobile-waiting.png | 모바일 대기 #005 | 같은 "명명" 버그 |

### 역할 5: 데스크 (일마감)
| 스크린샷 | 내용 | 비고 |
|---------|------|------|
| r5-desk-01-closing-page.png | **완전 백지** | CRITICAL(C1) |
| r5-desk-debug-01-closing.png | **완전 백지** (재시도) | JS 에러 추정 |
| r5-desk-10-tablet-closing.png | **완전 백지** (태블릿) | 동일 현상 |

---

## 긍정적 발견 ✅

1. **체크인 폼**: 모바일/데스크탑 반응형 완벽. 깔끔한 디자인.
2. **대시보드 칸반**: 대기→상담→시술대기→시술→완료 흐름 직관적
3. **상태 이동 로그**: 메모에 자동 타임스탬프 기록 (예: [22:08] 상담 → 시술대기)
4. **마취크림 도포 체크**: 체크하면 시간 자동 기록 — 실용적 기능
5. **예약 캘린더**: 주간 뷰 깔끔, + 예약 모달 구성 합리적
6. **수동등록**: 간결한 3필드(이름/전화/등록) 모달
7. **English 토글**: 다국어 지원 기반 마련

---

## 수정 우선순위 제안

1. **즉시 수정** (C1, C2): 일마감/직원관리 백지 → AdminClosing.tsx 런타임 에러 원인 파악
2. **즉시 수정** (C3): 고객이력 테이블 데이터 연동 (check_ins → customers 매핑)
3. **이번 주** (M1): "명명" → "명" 수정 (WaitingScreen.tsx)
4. **이번 주** (M2): 대기화면 인원 수 정확도 (실시간 쿼리 vs 캐시)
5. **이번 주** (M3, M4): 고객 상세 Sheet에 상태변경 + 결제 버튼 추가
6. **다음 스프린트** (M5): 글로벌 검색 기능 정상화
7. **다음 스프린트** (M6, M7): 예약 모달 UX 개선 (이중 구조 해소)
8. **백로그** (m1~m5): 시술 카테고리, 할인 표시, 태블릿 레이아웃
