---
id: T-20260523-foot-NAV-MENU-REORDER
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
build_ok: true
db_change: false
e2e_spec: true
commit: 796fce2
created: 2026-05-23
deadline: 2026-05-29
---

# T-20260523-foot-NAV-MENU-REORDER — CRM 사이드바 메뉴 순서 변경

## 요청
풋센터 CRM 좌측 사이드바(LNB) 14개 메뉴 항목 순서 재배치.

## 최종 순서 (상→하)
1. 대시보드
2. 예약관리
3. 고객관리
4. 패키지
5. 진료 도구
6. 서비스관리
7. 직원·공간
8. 병원·원장 정보
9. 치료 테이블
10. 일마감
11. 일일 이력
12. 통계
13. 매출집계
14. 계정관리

## 변경 파일
- `src/components/AdminLayout.tsx` — NAV_ITEMS 배열 순서 재배치

## AC 확인
- [x] AC-1: 14개 메뉴 요청 순서대로 렌더링
- [x] AC-2: 라벨 텍스트 기존 유지 (순서만 변경)
- [x] AC-3: RBAC 가시성 로직 무변경
- [x] AC-4: 라우팅 경로 정상
- [x] AC-5: 빌드 에러 없음 (✓ built in 3.28s)

## 비고
- FE-only. DB 변경 없음.
- CHART-ACCESS-LOCK 가드 10/10 통과
- E2E spec: `tests/e2e/T-20260523-foot-NAV-MENU-REORDER.spec.ts` — 코드 레벨 AC-1~4 검증 + 브라우저 통합 시나리오(skip)
