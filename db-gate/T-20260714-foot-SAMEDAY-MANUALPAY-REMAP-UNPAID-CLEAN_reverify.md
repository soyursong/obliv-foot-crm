# T-20260714-foot-SAMEDAY-MANUALPAY-REMAP-UNPAID-CLEAN — 재검증(재조회) 결과

> 트리거: INFO MSG-20260714-161358-wity ("현장 구체데이터 보강 → 재조회 후 반영").
> 재조회 시각: 2026-07-14 (당일 일마감). SELECT only, write 0. probe = `scripts/..._p1b_reverify.mjs`.
> 결론: **선행 Phase1 snapshot(commit 72731055) 이 현재도 100% 유효. 보강 12건 데이터 이미 반영됨. drift 0. 신규 조사 불요.**

## 1. Freeze set drift 대사
| 항목 | 값 |
|------|-----|
| 현재 closing_manual_payments (close_date=2026-07-14) | **13건** |
| snapshot §4 freeze set | 13건 |
| snapshot에 있으나 DB에 없음(missing) | **0건** |
| DB에 있으나 snapshot에 없음(new drift) | **0건** |
| canonical 마커(T-20260714-SAMEDAY-REMAP) 사전 존재 | **0건** (타 세션 apply 없음) |

→ freeze set 13건 그대로 유효. 조회 이후 현장 추가입력/삭제 없음.

## 2. 보강 12건(스크린샷) ↔ 재조회 대사 (INFO 요청 핵심)
- 스크린샷 12건은 선행 snapshot §3에서 이미 대사 완료: 11:09 F-4695 이미현 2,890,000(=Part1 이미 canonical화) + 나머지 11건 일치 + 스크린샷 이후 신규 2건(F-4597 윤철희·F-4687 신용섭).
- 재조회 시점에도 동일 (신규 drift 없음). ∴ **보강 데이터는 이미 Phase1에 반영됨** — INFO의 "재조회 후 반영" 충족.

## 3. repro 진태주 F-4652 재확인 (버그 vs 운영 게이트)
- canonical payments/package_payments = **0건** (여전히 미연결).
- 패키지 1f7a61f1(무좀체험권) balance = 10,000 (미수 유지).
- closing_manual_payments dfd30a1a = 10,000/card/15:15 존재.
- → snapshot §1 판정 재확인: **운영-우세 하이브리드**. `Closing.tsx` 수기결제 UI 는 옵션A canonical 라우팅(`recordManualPayment`)을 보유하나 **기본값 `attrSel='manual'`(rollup)** 이라 스태프가 귀속 미선택 시 `closing_manual_payments` 로 폴백(설계상 net-zero, 이중계상 방지) → 2번차트 수납내역 미표시 + 미수 미해소. **자동연결 로직 '결함' 아님.**
- ⚠ 단, opt-A 코드(`manualPaymentWritePath.ts` 신규 + `Closing.tsx` 수정)는 현재 **working tree 미커밋(untracked/modified) = prod 미배포**. 즉 오늘 프로덕션 화면엔 귀속 드롭다운조차 없이 전건 rollup 폴백. → 후속 코드개선(귀속 자동제안/필수화) + opt-A 배포는 별도 티켓.

## 4. 대상 11개 패키지 현재 balance (미수 근거, before-state)
전부 status=active, paid_amount=0 (24회권 876e1a55 만 paid 380,000 / balance 4,500,000). 미수 미해소 상태 유지 = Phase3 정정 대상 그대로.

## 5. 실행 게이트 상태
- Phase 1(조회·진단·대사): **완료 + 재검증 완료.**
- Phase 3 apply/rollback SQL: 준비 완료(`scripts/..._apply.sql` / `..._rollback.sql`), 멱등 가드·net-zero. **미실행.**
- 현장(김주연 총괄) confirm: **미수신 → UPDATE 금지 유지.**

## 6. ⚠ 중복 세션 deconfliction (planner 조율 요망)
동일 13건 대상 티켓/세션 복수 확인:
- 본 티켓 `T-...-SAMEDAY-MANUALPAY-REMAP-UNPAID-CLEAN` (Phase1+Phase3 SQL 준비, commit 72731055).
- `T-...-DAYCLOSE-MANUALPAY-RETRO-BACKFILL-MISU-CLEANUP` (Phase A read-only 리포트, commit 170e6b18, FOLLOWUP MSG-165652-1uap) — 자체 signals 에 "(B)군 F-4695 별도세션 targeted 스크립트 in-flight — 중복 조율 요망" 기재.
- → 결제 원장(package_payments/payments) **double-canonicalize 위험**. confirm→UPDATE 전 planner 가 **단일 실행 소유 티켓 지정** 필요. (현재 canonical 마커 0건이라 아직 사고 없음.)
