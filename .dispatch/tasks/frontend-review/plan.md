# 프론트엔드 엔지니어 관점 코드 리뷰

- [x] 코드 품질 점검: AdminDashboard 1194줄 메가 컴포넌트, as any 6건, 인터페이스 중복 4종
- [x] 성능 점검: lazy loading 미적용, realtime 전체 재조회, 검색 디바운스 없음, 워터폴 쿼리
- [x] 접근성 점검: label-input 미연결 다수, select aria 누락, 컨텍스트 메뉴 키보드 불가
- [x] 반응형 점검: 헤더 오버플로우, grid-cols-5 고정, 테이블 모바일 미대응, Sheet 고정 너비
- [x] 에러 처리: Supabase 에러 무시 패턴 전반, 초기 로딩 상태 없음, auth guard 분산, optimistic rollback 없음
- [x] 코드 중복 제거: auth+clinic 초기화 6곳, 고객 상세 시트 2곳, 날짜 네비게이터 3곳, 상수 3종 중복
- [x] 발견 이슈 + 수정 코드를 .dispatch/tasks/frontend-review/output.md에 작성 — 총 24건 (Critical 2, High 4, Medium 8, Low 10)
