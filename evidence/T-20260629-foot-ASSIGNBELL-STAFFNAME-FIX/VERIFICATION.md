# T-20260629-foot-ASSIGNBELL-STAFFNAME-FIX — 검증 증거 (FIX-REQUEST 대응)

- FIX-REQUEST: MSG-20260630-020334-yqoc (supervisor, qa_fail_phase=phase2, insufficient_verification)
- 코드: 무변경. 기존 fix commit 3696735e 유지 (display_name 제거 → staff.name 실명 노출).

## 1) Playwright E2E 실측 (Supervisor lane)
- 명령: `npx playwright test tests/e2e/T-20260629-foot-ASSIGNBELL-STAFFNAME-FIX.spec.ts --project=desktop-chrome`
- 결과: **4 passed (9.0s)** = setup 1 + S1/S2/S3, exit 0
- 전체 로그: ./e2e-run.log

## 2) 브라우저 시뮬레이션 (실제 렌더 캡처, screenshot:'on')
- S1-marquee-staffname.png : 전광판 스트립 '→ 문지은 배정' 실명 노출
- S2-bellpanel-staffname.png: 종 패널 열림 → 'RCCSEED-... 고객 → 문지은 배정됨' 실명 노출 (이전 폴백 '담당자' 해소 육안 확인)
- S3-readall-hidden.png     : 모두 읽음 시 전광판/배지 사라짐 (부모 노출조건 무회귀)

## 결론
- AC-1/2/3 전부 실측 PASS. display_name 400 버그 해소 + 실명 노출을 코드 단언 + 화면 캡처 양쪽으로 입증.
