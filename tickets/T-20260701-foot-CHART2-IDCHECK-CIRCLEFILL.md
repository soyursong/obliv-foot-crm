---
id: T-20260701-foot-CHART2-IDCHECK-CIRCLEFILL
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 96157747 (T-20260701-foot-CHART2-IDVERIFY-DOT-ONLY — 동일 요청 旣 구현·main 반영)
deployed_at: n/a (코드 이미 origin/main 반영 — supervisor QA 대기)
bundle_hash: n/a (NOT yet verified on prod)
db_change: false
e2e_spec: tests/e2e/T-20260701-foot-CHART2-IDVERIFY-DOT-ONLY.spec.ts (동일 배지·동일 시나리오 26 passed — 신규 spec 미신설, 중복 회피)
medical_confirm_gate: n/a (2번차트=CustomerChartPage 고객차트 주민번호 행 신분증 배지 — 진료대시보드/진료관리 비대상. 접수·고객관리 영역 코스메틱)
summary: "**코드변경 0 — 동일 요청 旣 구현·origin/main 반영(dedup-noop).** 김주연 총괄 요청(2번차트 신분증 확인필요/완료 배지: 전체 컬러 채움 말고 동그라미만 컬러 + 박스는 첨부 IMG_8730 그대로 유리 알약)은 sibling 티켓 T-20260701-foot-CHART2-IDVERIFY-DOT-ONLY(commit 96157747, 08:56 deploy-ready)로 완결. 본 CIRCLEFILL 메시지(08:07 발행)는 DOT-ONLY 커밋(08:56) 이전 큐 적재분 = 동일 요청 중복 티켓(티켓 본문 REDEFINITION_RISK△ 자체 경고). 요청 4항목 전부 旣충족: ①박스=.idverify-glass(LIVESLOT-GLASS-APPLY .live-glass-board 同 디자인 언어 재사용, 반투명 유리+연한 실버 #C7CDD4 border+볼록 inset, pill 축소 — 중복 스타일 신설 0) ②dot만 상태색: 확인필요=bg-pink-300 animate-pulse / 확인완료=bg-firstvisit-500 그린(첨부 톤) ③금지항목 준수: 박스 full-background 색 제거(旣 bg-pink-100/#E7EEDA→제거), 텍스트 무채색 text-gray-700(강조 0), 노랑(힐러) 영역 미접촉, 박스 톤 연함 유지 ④색값=STALEGUARD-CHIPSHADE/COLOR-WARMPASTEL-DESATURATE 旣반영 신분확인 배지색 hex(pink-300·firstvisit-500)와 일치(회귀 방지) — 티켓 가이드#4 '레드/앰버 계열'은 느슨한 서술, 명시 지침(established hex 일치·foot 색 컨벤션)에 따라 파스텔 핑크 dot 유지가 정답. E2E=DOT-ONLY spec(시나리오 1·2 신분증 확인필요/완료 변환, 소스 정합 가드 11종, 26 passed)이 동일 배지 커버 → 신규 spec 미신설(STALEGUARD 중복 회피). 대상 위치 비모호(CustomerChartPage 주민번호 행 신분증 배지 단일). planner FOLLOWUP로 중복 통지·클로저 요청."
created: 2026-07-01
assignee: dev-foot
owner: agent-fdd-dev-foot
supersedes_relation: dedup-of T-20260701-foot-CHART2-IDVERIFY-DOT-ONLY
---

## 요청 (김주연 총괄, C0ATE5P6JTH)
"해당 레이아웃 2번차트 신분증 확인필요/완료 부분도 반영해줘. 전체 컬러 입히는 형태 말고 스크린샷처럼 동그라미만 특정 컬러 들어가고 박스 첨부사진 그대로."
- 첨부 IMG_8730.jpg = 목표 스타일 레퍼런스(= '실시간 반영' 유리 알약 배지)

## 결론: dedup-noop (코드변경 0)
동일 현장 요청이 sibling 티켓 **T-20260701-foot-CHART2-IDVERIFY-DOT-ONLY**(commit `96157747`, deploy-ready, origin/main)로 이미 완결됨.
본 CIRCLEFILL 메시지(MSG-20260701-080737, 08:07 발행)는 DOT-ONLY 커밋(08:56) **이전** 큐 적재분 → 동일 요청 중복 픽업.
티켓 본문 자체가 `REDEFINITION_RISK△ — 토큰 단위로 한 번에 수렴` 경고 → DOT-ONLY가 이미 단일 토큰(`.idverify-glass`)으로 수렴 완료.

## 요청 4항목 대조 (전부 旣충족 — src/pages/CustomerChartPage.tsx 5242~5266, src/index.css .idverify-glass)
| 가이드 | 요구 | 현행(main, DOT-ONLY) | 충족 |
|--------|------|----------------------|------|
| 1) 박스 | 첨부 유리 알약(반투명 연회색+실버 외곽+볼록), LIVESLOT-GLASS 토큰 재사용 | `.idverify-glass`(=.live-glass-board 同 디자인 언어 pill 축소) + `border-[#C7CDD4]`(연한 실버). 중복 스타일 신설 0 | ✅ |
| 2) 동그라미만 상태색 | 확인필요=주의색 dot / 확인완료=완료 그린 dot | 확인필요 `bg-pink-300 animate-pulse` / 확인완료 `bg-firstvisit-500`(첨부 그린 톤) | ✅ |
| 3) 금지 | 배지 전체 배경 채움/텍스트 강조/노랑(힐러) 침범/박스 톤 진하게 | full-bg 제거(旣 pink-100·#E7EEDA→삭제), `text-gray-700`(강조 0), 힐러 미접촉, glass 연함 유지 | ✅ |
| 4) 색값 회귀방지 | STALEGUARD-CHIPSHADE 신분확인 배지색 hex 일치, foot 색 컨벤션 참고 | pink-300·firstvisit-500 = 旣반영 hex 그대로 계승(dot으로 이동만). 가이드 '레드/앰버'는 느슨 서술 → established hex 유지가 회귀방지 정답 | ✅ |

## 대상 위치 (비모호)
CustomerChartPage(2번차트) 주민번호 행 신분증 확인 배지 2종(확인필요 button / 확인완료 span) — 단일 지점, 추정 불요.

## E2E
`tests/e2e/T-20260701-foot-CHART2-IDVERIFY-DOT-ONLY.spec.ts`(시나리오 1·2 = 신분증 확인필요/완료 변환, 소스 정합 가드 11종, 26 passed)가 동일 배지·동일 시나리오를 커버. 신규 spec 미신설(중복 회피, e2e_spec_exempt 아님 — 기존 spec으로 충족).

## 게이트
- medical_confirm_gate: n/a (고객차트 주민번호 행 = 접수/고객관리 영역, 진료대시보드/진료관리 비대상 §11.1)
- DB: 무변경(FE/CSS only)
