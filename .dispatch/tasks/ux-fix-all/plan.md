# UX 34건 전체 수정 + 예약 슬롯 용량 제한

- [x] P0 Critical 3건 수정: C-01(referral_source 저장), C-02(검색 clinic_id 필터), CO-01(예약 사이드바 배열화)
- [x] P1 High 8건 수정: C-04(명명 버그), TM-01(과거날짜 차단), TM-02(예약날짜 변경), CO-02(수동등록 유입경로+고객연결), CO-03(컨텍스트메뉴 확장), CN-01(과거이력), CN-02(결제금액 자동입력), PA-01(체크인 문구)
- [x] P2 Medium 16건 수정: TM-03(취소확인), TM-04(전화번호마스킹), CO-04(시술실담당표시), CO-05(상태변경버튼), CO-06(실시간갱신), CN-03(분할결제), CN-04(시술검색), C-03(activeTab), TE-02(시술목록줄바꿈), TE-03(마취알림깜빡), CL-01(환불고객선택), CL-02(마감해제), ST-01(역할선택), ST-02(직원수정/비활성화), PA-02(로딩UI), PA-05(에러피드백)
- [x] P3 Low 5건 수정: TM-05(overflow클릭), TM-06(전화번호검증), PA-03(예상대기시간), PA-04(체크인취소), CN-05(결제상세표시) — TE-01 스킵(시술사전용뷰 별도기능), ST-03 스킵(주간배정복사 별도기능)
- [x] 추가 기능: 예약 슬롯 용량 제한 (DB max_per_slot 컬럼 추가 + UI 꽉찬 슬롯 빨간 배경 + 시간 드롭다운 마감 표시)
- [x] npx vite build 성공 확인 ✓
- [x] git commit (2535eff) && push origin main ✓
- [x] Write change summary to .dispatch/tasks/ux-fix-all/output.md ✓
