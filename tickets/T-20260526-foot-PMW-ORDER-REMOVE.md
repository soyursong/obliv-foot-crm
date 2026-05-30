---
id: T-20260526-foot-PMW-ORDER-REMOVE
domain: foot
priority: P1
status: deployed
hotfix: false
created: 2026-05-26 19:30
deadline: 2026-05-27
slack_channel: C0ATE5P6JTH
slack_thread_ts: 1779772660.843369
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
attachments:
  - id: F0B5QEJL7UP
    name: 20260526_191742.png
    mimetype: image/png
    url: https://files.slack.com/files-pri/T0ALX8VKANL-F0B5QEJL7UP/20260526_191742.png
e2e_spec_exempt_reason: "REOPEN1 수정: FE 순수 UI 제거. 드래그핸들·↑↓ 버튼 삭제. 런타임 로직 변경 없음."
risk_verdict: GO
risk_reason: "FE 전용 UI 제거. DB/외부서비스/대량데이터 변경 없음(0/5)."
source_msg: MSG-20260526-192239-daf7
related_ticket: T-20260526-foot-PMW-SIDEMENU-FEAT
reopen1_fix_commit: ed8865d
reopen1_fix_at: 2026-05-28 14:55 KST
reopen1_root_cause: "FEE-ITEM-REORDER(수가항목↑↓) UI가 수가항목패널에 잔존. PMW-ORDER-REMOVE 탭 제거(b39702c)와 별개로 수가항목 재배열 드래그핸들·↑↓버튼이 보임 → 현장 '여전히 화살표 있음' 인식"
reopen1_fix_scope: "SortablePricingRow: GripVertical+ArrowUp+ArrowDown 제거, handleReorderPricingItem 제거, 힌트텍스트 제거"
deploy-ready: true
deploy_ready_commit: ed8865d
deploy_ready_build: OK
deploy_ready_db_changed: false
deploy_ready_spec: tests/e2e/T-20260526-foot-PMW-ORDER-REMOVE.spec.ts
deploy_ready_at: 2026-05-28 14:55 KST
qa_result: pending
qa_grade: null
qa_fail_reason: null
qa_fail_phase: null
deployed_at: 2026-05-27 08:15 KST
deployed_commit: b39702c
reopen1_reopened_at: 2026-05-28 09:51 KST
push_acked: MSG-20260527-111134-6d6j (stale — already deployed at push time)
---

# T-20260526-foot-PMW-ORDER-REMOVE — 결제 미니창 "순서 편집" 기능 제거

## 배경

김주연 총괄(풋센터): **"순서 배치 기능 때문이면 그냥 제거해줘"**

T-20260526-foot-PMW-SIDEMENU-FEAT (commit d3e5479) 배포 직후 현장에서 즉시 제거 요청.

### 문제 상황
- 순서 편집 모드 진입 시 **빨간 테두리(red box)** 표시
- 수가 코드명이 잘림 (예: C5900... → 전체 코드 미표시)
- 드래그 핸들·↑↓ 화살표·삭제 아이콘이 row 공간을 차지 → 코드명 표시 영역 부족

### 현장 판단
수정이 아닌 **기능 전체 제거** 요청. 순서 편집이 불필요하므로 관련 UI를 전부 걷어내라는 지시.

## 수용 기준 (AC)

### AC-1: 순서 편집 탭 제거
- PaymentMiniWindow의 "순서 편집" 탭 완전 제거
- 기존 탭(기본/시술내역/수액/화장품 등)만 유지

### AC-2: 순서 편집 관련 UI 전부 제거
- 드래그 핸들 (grab handle) 제거
- ↑↓ 화살표 버튼 제거
- 순서 편집 모드의 빨간 테두리(red border) 제거
- 삭제 아이콘(순서 편집 모드 전용) 제거

### AC-3: 수가 항목 코드명 잘림 해소
- 순서 편집 UI 제거 시 코드명 표시 영역이 자연 회복되는지 확인
- 잘림 현상이 여전하면 추가 CSS 조정

### AC-4: DB 백엔드 유지
- `service_menu_order` 관련 DB 로직(테이블/컬럼/RPC)은 제거하지 않음
- FE에서 순서 편집 진입점만 완전 제거

### AC-5: 빌드 에러 없음
- `npm run build` 성공

## 리스크 5항목

| # | 항목 | 판정 | 사유 |
|---|------|------|------|
| 1 | DB 스키마 변경 | ✅ 없음 | FE 제거만. DB는 유지 |
| 2 | 외부 서비스 의존 | ✅ 없음 | |
| 3 | 비즈니스 로직 변경 | ✅ 무위험 | 편집 UI 제거 = 기능 축소(안전) |
| 4 | 대량 데이터 변경 | ✅ 없음 | |
| 5 | 신규 npm 패키지 | ✅ 없음 | |

**판정: GO (0/5)**

## 현장 클릭 시나리오 (E2E 변환 가이드)

### 시나리오 1: 순서 편집 탭 미노출 확인
1. 로그인 → 대시보드
2. 고객 카드 우클릭 → 수납(결제) 선택
3. 결제 미니창(PaymentMiniWindow) 열림
4. 좌측 수가항목 그리드 상단 탭 목록 확인
5. **"순서 편집" 탭이 없음** 확인
6. 기본/시술내역/수액/화장품 탭만 존재 확인

### 시나리오 2: 드래그 핸들·화살표·빨간 테두리 미노출 확인
1. 시나리오 1 상태에서
2. 수가 항목 그리드의 각 row 확인
3. **드래그 핸들(☰), ↑↓ 화살표, 삭제 아이콘이 없음** 확인
4. 빨간 테두리(red box)가 표시되지 않음 확인

### 시나리오 3: 코드명 표시 정상 확인
1. 시나리오 1 상태에서
2. 수가 항목 그리드에서 코드명이 잘리는 항목 확인
3. C5900002, C5900003 등 코드명이 **전체 표시**되는지 확인
4. 잘림(...)이 없음 확인

### 시나리오 4: 엣지 케이스
1. 수가 항목이 0건일 때 → 빈 그리드 정상 표시
2. 수가 항목 20건+ → 스크롤 정상 동작 + 코드명 잘림 없음

## 비고
- **관련 배포**: T-20260526-foot-PMW-SIDEMENU-FEAT (commit d3e5479, DB migration 20260526130000_service_menu_order.sql APPLIED)
- 방금 배포한 기능의 현장 즉시 롤백 요청 — P1 처리
- 첨부: F0B5QEJL7UP (빨간박스 + 코드명 잘림 캡처)

## 변경 이력
- 2026-05-30 18:33: supervisor FIX-REQUEST(MSG-20260530-183131-9ea1, phase1 insufficient_verification) 재검증. 회신 MSG-20260530-183352-qn2u. 근본원인=경로 오인(직전 MSG-182658 동일 재발) — supervisor 기대 경로 `/Users/domas/claude-sync/work/obliv-foot-crm`는 실재 심링크(→Documents/GitHub/obliv-foot-crm)·ed8865d 보유. 아티팩트 제공: build ✓3.44s(ed8865d..HEAD src 0변경), bundle hash(Dashboard sha256:0ee0007d6f9fa581 / Reservations sha256:bef1a051491d37b5), 변경=PMW.tsx 단일·잔존호출0·caller 무영향·DB변경 없음. deploy_ready_commit=ed8865d 유지.
- 2026-05-28 15:31: REOPEN1 status 정합(deployed→deploy-ready). conductor KICK(MSG-20260528-152549-lcpz) 계기. 09:53 FIX-REQUEST MQ(MSG-095246-gfzb) dev-foot 미착 확인. 커밋 ed8865d 실재. supervisor QA-REQUEST P1(MSG-20260528-152926-j0p7) 발행.
- 2026-05-28 14:55: REOPEN1 fix 완료. commit ed8865d. SortablePricingRow ↑↓·GripVertical·힌트텍스트 전면 제거.
- 2026-05-28 09:51: REOPEN1. 김주연 총괄 "새로고침 후 2번 수정사항 변경안 됨". deployed→reopened.
- 2026-05-27 08:15: 최초 배포 (b39702c). Vercel auto-deploy.
- 2026-05-26 19:30: 신규 생성 (MSG-20260526-192239-daf7). PMW-SIDEMENU-FEAT 배포 직후 현장 제거 요청.
