---
id: T-20260803-foot-CBAND-TIDCOM-TERMINAL-NOSETUP-P0-DIAGNOSE
domain: foot
priority: P0
status: deploy-ready
deploy_ready: true
hotfix: true
created: 2026-08-03
completed: 2026-08-03
db_changed: false
e2e_spec: tests/e2e/T-20260803-foot-CBAND-TIDCOM-TERMINAL-NOSETUP.spec.ts
risk_verdict: GO
author: dev-foot
build_verified: "2026-08-03 — tsc -b clean (exit 0) / vite build ✓ built in 6.66s / playwright cband suite: 신규 spec 5(AC1~AC5) + POPUP-PLACEMENT 10 + TOOLTIP/BETA/5FIX 회귀 = 86 passed, 0 failed (POPUP AC5 브리틀 윈도우 회피 위해 onApprove 분기를 1줄로 압축 — invariant(block→approve 순서) 불변)"
followups:
  - "현장 확인 대기(responder 병행 회수): 실단말 PC 에서 결제 Dialog 팝업의 정확한 문구/색(경고=amber 인지) + ⑧ 카드 단말기 설정에 가맹점번호(MERNO) 입력 이력 유무 + CAT 데몬(ws://127.0.0.1:8888) 프로그램 실행여부 + 입력한 COM 번호. 이 4건으로 '원인=MERNO 미설정(CRM legibility)' vs '원인=데몬 미구동(현장조치)' 최종 확정."
  - "구조 재판단(planner): 팝업(TID·COM 2필드)에서 MERNO 를 못 채우는 chicken-egg 상존 — ⑧ 최초 1회 MERNO 입력을 온보딩에 고정하거나, env(VITE_CBAND_MERNO) 를 CF Pages 빌드에 주입하는 방안. 이번 fix 는 legibility(진짜 블로커 노출)만 해결·MERNO 입력 UX 자체는 미변경(DELTA1 2필드 유지)."
---

# T-20260803-foot-CBAND-TIDCOM-TERMINAL-NOSETUP — 코밴 직결결제 "단말기 설정 안됨" 진단·수정

## 증상 (현장 원문, 최필경 총괄)
"단말기 TID와 COM을 입력했는데 단말기 설정이 안됐다. 단말기는 펌웨어 업데이트했고 POS포트도
사용 열어두었고 케이블도 연결된 상태." → 하드웨어 3종(펌웨어·POS포트·케이블) 정상 = 하드웨어 배제.

## 진단 결과 (체크리스트 1~6 배제)

| # | 항목 | 판정 |
|---|------|------|
| 1 | 데몬 구동/도달성(ws://127.0.0.1:8888) | 현장 확인 필요(데몬 SW 실행여부 미보고) — 이 경우 probe='blocked' → "연결하지 못했습니다" 게이트로 이미 노출됨 |
| 2 | COM 2자리 zero-pad('01'~'99') | **정상** — protocol.pad2Port 가 buildMsg 에서 강제('COM3'/'3'/'03' → '03'). |
| 3 | baud 38400 고정 | **정상** — DELTA1 로 UI 미노출·값 고정 계승. |
| 4 | TID/MERNO 저장값 도달 | **여기서 gap 발견** ↓ |
| 5 | 저장 스코프 divergence | **여기서 root-cause 발견** ↓ |
| 6 | 응답코드/전문 회수 | 결제 진입 이전 차단이라 미도달(전문 전송 0). |

### ★ Root cause (CRM-side legibility trap) — 체크리스트 #4/#5
- 결제 게이트 `getTerminalConfig()` 는 **TID·MERNO·COM 3값 모두** 있어야 non-null (`config.ts` §41).
- 그러나 결제 Dialog 안 팝업(`CbandTerminalConfigInline`, POPUP-PLACEMENT)은 **TID·COM 2필드만** 다루고
  MERNO 는 ⑧ AdminSettings / env(`VITE_CBAND_MERNO`) 계승(DELTA1 로 팝업 비노출).
- **MERNO 미설정**(env 미주입 + ⑧ 미입력) PC 에서 팝업으로 TID·COM 만 저장하면:
  - 팝업 요약줄은 `단말기 {TID} · COM {n}` 으로 **'저장됨'처럼 보임**(hasSaved=TID·COM 2필드 기준).
  - 결제요청 시 `getTerminalConfig()=null` → `onApprove` 가 "단말기 설정이 완료되지 않았습니다"로 **차단**.
  - [변경]은 TID·COM 만 다뤄 MERNO 를 못 채우는 **dead-end**.
- → 현장 관점: "TID·COM 입력했는데 단말 설정이 안됨" (증상 원문과 정확히 일치).
- POPUP-PLACEMENT 티켓 followup 이 이미 예고: "MERNO 는 팝업 미노출·⑧/env 계승 구조라 ⑧이 MERNO 유일 입력 경로."

## 수정 (순수 FE · db_change=false · 결제/전문/이중결제방지 로직 무접촉)
은닉된 **진짜 블로커(MERNO 미설정)를 명시적으로 노출**한다. 팝업에 MERNO 입력칸을 추가하지 않고
(DELTA1 2필드 유지), "어디서 고치는지(관리자 설정 → ⑧ 카드 단말기 설정)"만 안내:
1. `CbandTerminalConfigInline` — `mernoMissing = raw.merno === ''` 감지. 저장됨 요약을 amber 로 전환 +
   `cband-terminal-merno-missing` 경고("가맹점 번호(MERNO)가 아직 설정되지 않아 … ⑧ 카드 단말기 설정에서 입력").
2. `onApprove` — 차단 사유가 MERNO 면 [변경](dead-end) 대신 정확한 위치(⑧)로 안내.

## 가드
- 이중결제 방지 불변식(PLANA-BUILD §7-4·D) **무손상** — approve/protocol/paymentFlow(classify·send-lock·insert-first) 미변경.
  신규 spec AC5 가 `mernoMissing` 이 순수계층(paymentFlow/protocol)에 없음 + approve 시그니처 불변을 정적 가드.
- DDL 0 → data-architect CONSULT 게이트(§3.1) 비대상.
- MERNO 결핍이 env/⑧ 로 채워진 PC 에서는 경고 미노출(조건부, false-positive 0).

## 배포 후 field-soak
플래그 ON 실단말 PC 에서: (a) MERNO 미설정 시 팝업 amber 경고 + 결제요청 차단 문구가 ⑧ 지목하는지,
(b) ⑧에서 MERNO 입력 후 경고 사라지고 정상 결제되는지 총괄(최필경) 실기기 확인.
