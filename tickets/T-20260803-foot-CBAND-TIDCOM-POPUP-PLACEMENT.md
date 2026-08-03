---
id: T-20260803-foot-CBAND-TIDCOM-POPUP-PLACEMENT
domain: foot
priority: P0
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-08-03
completed: 2026-08-03
db_changed: false
e2e_spec: tests/e2e/T-20260803-foot-CBAND-TIDCOM-POPUP-PLACEMENT.spec.ts
risk_verdict: GO
risk_reason: "② carve-out of 5FIX — 단말기 TID/COM 설정 입력을 코밴 결제 Dialog(카드결제 창) 안으로 이관. 순수 FE + 기존 localStorage 계약(cband.terminal.config, TERMINAL 티켓 deployed) 재사용 — db_change=false, 스키마/RPC/트리거/npm 의존성 무변경(입력=경량 Input, 신규 라이브러리 0). 결제/이중결제방지/전문(approve·precheckConcurrentPayment·protocol) 로직 전부 불변, 바뀌는 건 FE 렌더/게이트 조건뿐. 확정스펙(총괄 15:18 approved, screenshot_gate LIFTED): (a)위치=결제 Dialog 안, 저장여부 무관 항상 표시 (b)입력란 단말기 TID·COM 포트 2필드 + [저장] 1개, LS 있으면 자동채움 (c)저장됨=`단말기 {TID} · COM {n} [변경]` 한 줄 읽기전용, [변경]→입력모드 (d)빈값(TID) 전송 차단=pre-daemon onApprove 에서 '단말기 번호를 먼저 입력해 주세요' 안내+전송 차단 (e)규칙 계승(재정의X)=zero-pad·baud 38400·빈값차단=TERMINAL 티켓, merno=⑧/env 계승(팝업 비노출). CONFLICT#1 reconcile(§8): PAYBTN-DISABLED-TOOLTIP 의 버튼 disable 중 'TID 미등록(!hasCfg)'만 활성으로 분리(Dialog 열려 창 안 입력 가능·chicken-egg 방지) — daemon 미연결·권한차단(awaiting/blocked) disable 은 유지. ⑧ AdminSettings SectionTerminal 존치(무단 제거 금지, AC8 가드). 기능플래그 VITE_CBAND_PAY 기본 OFF → 프로덕션 노출 0(다크). 빌드 OK(tsc -b clean + vite ✓ 6.95s), playwright 100 passed/0 fail(신규 spec 8 + PAYBTN-DISABLED-TOOLTIP·BETA-BADGE reconcile 회귀 갱신 + BUILD/5FIX/TERMINAL/TIMEOUT 회귀). 실제 창 안 입력·저장·요약·차단 시각 확인 = 총괄(최필경) 실단말 PC 플래그 ON field-soak."
author: dev-foot
build_verified: "2026-08-03 — tsc -b clean / vite build ✓ built in 6.95s / playwright cband suite 100 passed, 0 failed"
followups:
  - "⑧ AdminSettings SectionTerminal 존치 중 — ② 팝업 반영 후 ⑧과의 중복 여부 planner 재판단(총괄 §8). MERNO 는 팝업 미노출·⑧/env 계승 구조라 ⑧이 여전히 MERNO 유일 입력 경로."
---

# T-20260803-foot-CBAND-TIDCOM-POPUP-PLACEMENT

## 요청 (planner PUSH, MSG-20260803-153340-bkl6)
[PUSH P0] ② carve-out of 5FIX — 단말기 TID/COM 팝업을 코밴 결제 Dialog 안으로.
①③④⑤는 PR#74 QA 중, ②는 dev-foot 라인. 최우선 구현·supervisor 제출.
①③④⑤와 별도 배포로 fold 가능(deploy 차단 조건 아님).

## 확정스펙 (구현 SSOT, 총괄 15:18 — approved, screenshot_gate LIFTED)
- 위치 = 코밴 결제 Dialog(카드결제 버튼 눌렀을 때 뜨는 창) 안. 저장여부 무관 모든 PC에서 항상 표시.
- 입력란 `단말기 TID`·`COM 포트` + [저장] 버튼 1개. localStorage `cband.terminal.config`(TERMINAL 티켓 deployed) 있으면 자동채움, 없으면 빈칸.
- 저장됨: `단말기 {TID} · COM {n} [변경]` 한 줄 읽기전용. [변경] 클릭 시 입력모드.
- 빈값 전송 차단(pre-daemon): TID 비면 결제 시 "단말기 번호를 먼저 입력해 주세요" 안내+전송 차단.
- 규칙 계승(재정의 X): zero-pad·baud 38400·빈값차단 = TERMINAL 티켓.

## 구현
| 파일 | 변경 |
|------|------|
| `src/lib/cband/config.ts` | `getTerminalConfigRaw()` 추가 — LS>env, 3값 완비 요건 없이 tid/merno/catPort 그대로 반환(팝업 프리필·저장됨 판정·merno 계승). 기존 getTerminalConfig/saveTerminalConfig·LS_KEY 불변. |
| `src/components/CbandPayEntryButton.tsx` | ① `CbandTerminalConfigInline` 패널 신규(TID·COM 2필드 + [저장], 저장됨=요약 한 줄 + [변경], 프리필=getTerminalConfigRaw, merno 계승). ② 결제 Dialog idle/sending 블록 상단에 패널 항상 렌더. ③ onApprove 에 빈값(TID) 전송 차단(pre-daemon) + 안내. ④ CONFLICT#1 reconcile: `!hasCfg`(TID 미등록)를 비활성 tid-missing 게이트 → 활성 진입+Dialog(entryAndDialog 공용 const)로 분리. probing/awaiting/blocked 비활성 게이트 유지. |
| `tests/e2e/T-20260803-...-TIDCOM-POPUP-PLACEMENT.spec.ts` (신규) | ② placement 계약 AC1~AC8 정적·순수 가드(8 case). |
| `tests/e2e/T-20260803-...-PAYBTN-DISABLED-TOOLTIP.spec.ts` | reconcile 회귀 갱신: tid-missing 활성 분리 반영(비활성 게이트=probing/awaiting/blocked 3종). |
| `tests/e2e/T-20260803-...-BETA-BADGE.spec.ts` | 회귀 갱신: 활성 버튼+뱃지가 entryAndDialog 공용 const 로 추출됨 반영. |

## CONFLICT#1 reconcile (§8)
- PAYBTN-DISABLED-TOOLTIP(deployed) 6-상태 표의 disable 중 **`TID 미등록(!hasCfg)`만 enabled** 로 분리.
  → Dialog 열려 창 안 TID/COM 입력 가능(chicken-egg 방지).
- `daemon 미연결(probe==='blocked')·권한차단·탐지중(probe===null)·권한대기(awaiting)` disable 은 **유지**.

## ⑧ 별도 설정화면(AdminSettings SectionTerminal)
- 무단 제거 금지 — **존치 유지**(AC8 가드). MERNO 는 팝업 미노출 → ⑧이 여전히 MERNO 유일 입력 경로.
- ② 반영 후 ⑧과의 중복 여부는 planner FOLLOWUP 재판단(총괄 §8).

## 검증
- 빌드: `tsc -b` clean + `vite build` ✓ built in 6.95s.
- E2E: cband suite 100 passed / 0 failed (신규 8 + reconcile 회귀 갱신 + BUILD/5FIX/TERMINAL/TIMEOUT 회귀).
- 기능플래그 VITE_CBAND_PAY 기본 OFF → 프로덕션 노출 0(다크). 실단말 시각 확인 = 총괄 field-soak.
