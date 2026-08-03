---
id: T-20260803-foot-CBAND-PAYBTN-DISABLED-TOOLTIP
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-08-03
completed: 2026-08-03
db_changed: false
e2e_spec: tests/e2e/T-20260803-foot-CBAND-PAYBTN-DISABLED-TOOLTIP.spec.ts
risk_verdict: GO
risk_reason: "코밴 직결결제(BETA) 버튼 — 미연결/미설정 시 '숨김' → '비활성 버튼 + 마우스오버 툴팁 + 버튼 아래 상시 1줄 사유(AC-6)'로 전환. 순수 FE 렌더 조건 변경(결제·이중결제방지·전문 조립/파싱/분류 로직 전부 불변). db_change=false, 스키마/RPC/트리거/npm 의존성 무변경(툴팁=경량 CSS group-hover, 신규 라이브러리 0). 6-상태 표(AC-4): ①플래그 OFF=완전 숨김(return null 유지, enabled=플래그만으로 분리) ②TID 미등록(cfg==null)=비활성+'이 PC의 단말기 정보(TID)가 등록되지 않았습니다. 관리자에게 문의하세요' ③탐지중 ④권한 허용 대기 ⑤연결 실패(권한차단·데몬미실행 두 조치 함께 안내 — WS close 1006 코드 구분 불가) ⑥연결됨=활성. enabled 게이트에서 cfg 결합 분리 → TID 미등록도 더 이상 숨기지 않음. 문구 SSOT=src/lib/cband/gateCopy.ts(순수·JSX無)로 분리해 결정론 검증. 빌드 OK(tsc -b clean + vite built), unit 프로젝트 1664 passed/0 fail(신규 spec 15 + 기존 CBAND BUILD/BETA 회귀 갱신 포함). 기능플래그 VITE_CBAND_PAY 기본 OFF → 프로덕션 노출 0(다크). 실제 비활성/툴팁/1줄사유 시각 확인 = 총괄(최필경) 실단말 PC 플래그 ON field-soak."
author: dev-foot
build_verified: "2026-08-03 — tsc -b --noEmit clean / vite build ✓ built in 6.96s / playwright unit 1664 passed, 2 skipped, 0 failed"
followups: []
---

# T-20260803-foot-CBAND-PAYBTN-DISABLED-TOOLTIP

## 요청 (planner NEW-TASK, MSG-20260803-115459-dl69)
코밴 직결결제(BETA) 버튼 — 미연결 시 **숨김 → 비활성 + 툴팁 + 버튼 옆/아래 1줄 사유**.
"왜 못 누르는지"가 마우스오버 없이도 항상 보이게(AC-6). go-live 前 필수(P1).

## 구현
| 파일 | 변경 |
|------|------|
| `src/lib/cband/gateCopy.ts` (신규, 순수·JSX無) | 6-상태 문구 SSOT — `cbandGateCopy(kind)` → reason(1줄)/tooltip/retryable/testid. |
| `src/components/CbandPayEntryButton.tsx` | ① `enabled`에서 `cfg` 결합 분리(플래그만) → TID 미등록은 숨김 아님. ② probe 미ok 3블록(안내박스/숨김) → `CbandGateButton` 단일 dispatch(비활성 버튼 + CSS 툴팁 + 상시 1줄 사유 + [다시 확인]). 결제/이중결제방지/전문 로직 무접촉. |
| `tests/e2e/T-20260803-...-DISABLED-TOOLTIP.spec.ts` (신규) | 6-상태 문구 결정론 검증 + 게이트 배선/disabled/툴팁 래퍼 소스 가드(15 case). |
| `tests/e2e/T-20260803-...-BETA-BADGE.spec.ts` | 회귀 갱신: enabled=플래그만(cfg 분리) 계약 반영, 플래그 OFF 숨김 유지 확인. |
| `playwright.config.ts` | 신규 spec unit 프로젝트 등록. |

## 6-상태 표 (AC-4)
| # | 상태 | 조건 | 버튼 | 1줄 사유(상시)/툴팁 |
|---|------|------|------|------|
| 1 | 기능 미도입 | 플래그 OFF | 숨김 | (렌더 안 함) |
| 2 | TID 미등록 | cfg==null | 비활성 | "이 PC의 단말기 정보(TID)가 등록되지 않았습니다. 관리자에게 문의하세요" |
| 3 | 단말 확인 중 | probe==null | 비활성 | "카드 단말 연결을 확인하고 있습니다…" |
| 4 | 접속 허용 대기 | probe=='awaiting' | 비활성 | "브라우저에서 카드 단말 접속을 [허용]해야…" + [다시 확인] |
| 5 | 연결 실패 | probe=='blocked' | 비활성 | "연결하지 못했습니다. 접속 차단 해제 또는 단말 프로그램 실행" (툴팁=두 조치 함께) + [다시 확인] |
| 6 | 연결됨 | probe=='ok' | 활성 | (정상) |

## 검증
- `tsc -b --noEmit` clean · `vite build` ✓ · playwright `--project=unit` **1664 passed / 0 failed**.
- db_change=false · 신규 npm 의존성 0(툴팁=경량 CSS group-hover).
- ⚠ 실단말 PC 플래그 ON 상태의 비활성/툴팁/1줄사유 시각 확인 = 총괄(최필경) field-soak(supervisor QA 후).
