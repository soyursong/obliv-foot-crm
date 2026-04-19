# UX Review — 역할별 시나리오 기반 불편함 발견 및 해결

- [x] 전체 소스 파일 읽기: AdminDashboard, AdminReservations, AdminCustomers, AdminClosing, AdminStaff, CheckIn, WaitingScreen, AdminLayout, PaymentModal, i18n, clinic.ts
- [x] TM팀 시나리오 시뮬레이션: 유입경로 미저장(C-01), 과거날짜 선택가능(TM-01), 날짜변경불가(TM-02), 취소확인없음(TM-03), 전화번호 미마스킹(TM-04) 등 6건
- [x] 코디팀 시나리오 시뮬레이션: 예약타임라인 덮어씌움(CO-01), 수동등록 유입경로없음(CO-02), 컨텍스트메뉴 부족(CO-03), 시술실 선생님 미표시(CO-04), 상태변경 버튼없음(CO-05) 등 7건
- [x] 상담실장 시나리오 시뮬레이션: 과거이력 미표시(CN-01), 결제금액 수동입력(CN-02), 분할결제 불가(CN-03), 시술검색 없음(CN-04), 결제상세 미표시(CN-05) 5건
- [x] 시술사 시나리오 시뮬레이션: 전용뷰 없음(TE-01), 시술항목 잘림(TE-02), 마취타이머 알림없음(TE-03) 3건
- [x] 고객 시나리오 시뮬레이션: 체크인 문구혼란(PA-01), 로딩UI 부족(PA-02), 대기시간 미표시(PA-03), 취소불가(PA-04), 에러피드백 없음(PA-05), "명명" 버그(C-04) 5건+1
- [x] 발견된 이슈를 심각도별(Critical/High/Medium/Low) 정리 + 구체적 코드 수정 방안 작성 — Critical 3, High 8, Medium 16, Low 7 = 총 34건
- [x] 우선순위 정렬된 액션 아이템 리스트 작성 — P0(3건), P1(8건), P2(16건), P3(7건)
- [x] Write summary of findings/changes to .dispatch/tasks/ux-review/output.md
