---
ticket_id: T-20260618-foot-STAFF-CHART2-RRN-NOSAVE
id: T-20260618-foot-STAFF-CHART2-RRN-NOSAVE
status: deploy-ready
priority: P0
domain: foot
created_at: 2026-06-18
owner: agent-fdd-dev-foot
requester: 현장(2번차트 주민번호 "저장 안 됨" 오해 보고)
approved_by: data-architect CONSULT-REPLY MSG-20260618-185650-arwz (Option B GO, dev-foot 단독)
build_ok: true
spec_added: tests/e2e/T-20260618-foot-STAFF-CHART2-RRN-NOSAVE.spec.ts
db_changed: false
data_architect_consult: GO (MSG-20260618-185650-arwz). Option B=FE 안내문 = PHI 무변경·ADDITIVE(FE-only)로 DA 자문/대표 게이트 모두 면제. A1(전직원 복원)·A2(역할 한정 복원)는 대표 PHI 게이트 통과 전까지 HOLD — rrn_decrypt 게이트 변경 없음(.PHI_GATE_HOLD migration 미적용 유지).
risk_level: GO (1/5 — FE 표시 분기만. rrn_decrypt/rrn_encrypt RPC·DB 권한·스키마 무변경. PHI 표면 동일·축소(권한없는 호출 생략))
deploy_ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-06-18
deploy_commit: 9ee86dbf
commit_sha: 9ee86dbf
qa_result: pass (AC-1 게이트일치 / AC-2 viewer 상호배타 / AC-4 PHI 통과, AC-3 non-viewer 분기는 admin 시드라 skip — 실기기 confirm 대상)
field_soak_gate: 실 Galaxy Tab — 권한 없는 직원(예 therapist) 로그인 → 2번차트 주민번호칸이 '미입력' 대신 '조회 권한 없음' 표기 + 관리자(admin/manager/director)는 기존대로 마스킹값/수정·입력 정상 + 김주연 총괄 현장 confirm (최종 게이트)
---

# T-20260618-foot-STAFF-CHART2-RRN-NOSAVE — 주민번호 조회권한 없는 직원 '미입력' 오해 해소 (Option B)

## 문제 (현장 보고)
권한 없는 직원이 2번차트(고객 차트) 주민번호칸에서 빈 값을 보고 "주민번호가 저장이 안 됐다"고 오해.

## 원인 (RC)
prod `rrn_decrypt` 게이트1 = `is_admin_or_manager()` (admin/manager/director). 그 외 역할은
주민번호가 실제 저장돼 있어도 복호화 결과가 `null` → 기존 UI 가 `null` 을 **'미입력'** 으로 표기.
즉 "권한 없음(가려짐)"과 "미저장(비어있음)"을 화면이 구분하지 못해 발생한 오해.
(데이터 무손실은 DA가 이미 확인 — customers 56건 rrn_enc 전부 복호화 정상, clinic_id NULL 0건.)

## 결정 (DA CONSULT-REPLY MSG-20260618-185650-arwz)
- **Option B (FE 안내문) = GO, dev-foot 단독.** ← 본 티켓 구현
- Option A1(is_approved_user 전직원 복원) = REJECT
- Option A2(역할 한정 복원) = CONDITIONAL — 대표 PHI 게이트 + 업무근거 문서화 선결 → **HOLD**

## 구현 (FE-only, PHI/DB 무변경)
1. `src/lib/permissions.ts` — `canViewRrn(role)` + `RRN_VIEW_ROLES`(admin/manager/director) 추가.
   prod `rrn_decrypt` 게이트1을 FE에서 미러(SSOT 일치).
2. `src/pages/CustomerChartPage.tsx`
   - `userCanViewRrn = canViewRrn(profile.role)` 도출.
   - rrn 로드 useEffect: 권한 없으면 `rrn_decrypt` RPC 호출 **생략**(항상 null → 불필요·감사노이즈 제거).
   - 주민번호 행 비편집 표시 분기:
     - viewer(admin/manager/director): 기존 그대로(마스킹값/'미입력' + 수정·입력 버튼).
     - non-viewer: **'조회 권한 없음'** 안내 배지(amber, Lock 아이콘) + tooltip
       "주민번호는 관리자·매니저·원장만 조회할 수 있습니다. 저장되어 있어도 화면에 표시되지 않으며, 빈 값이 곧 '미저장'을 뜻하지 않습니다."
     - 입력 동선은 유지(rrn_encrypt 는 별도 권한 — 본 티켓에서 변경 없음).

## 변경 금지 항목 (DA 지시 준수)
- `rrn_decrypt` / `rrn_encrypt` RPC, DB 권한, 스키마 **무변경**.
- `20260618190000_rrn_decrypt_staff_read_restore.sql.PHI_GATE_HOLD` **미적용 유지**(A1/A2 보류).
- T-20260615-foot-RLS-CLINIC-ISOLATION 게이트2(clinic 격리) **유지·무관**.

## AC / 검증
- AC-1(logic): `canViewRrn` = admin/manager/director 정확 일치 (Playwright 순수함수, PASS).
- AC-2(UI): viewer 모드와 non-viewer 안내문 상호배타 (PASS).
- AC-3(UI 회귀): non-viewer 안내문 시 같은 행 '미입력' 부재 (admin 시드라 CI skip → 실기기 confirm).
- AC-4(PHI): 주민번호 행 평문 미노출 (PASS).
- build: `tsc -b && vite build` PASS.

## 후속 (본 티켓 범위 밖)
현장이 실제 RRN 자릿수 가시성을 계속 요구하면 → A2 업무근거를 responder 경유 김주연 총괄에게 수집 →
DA가 대표 PHI 게이트 ask로 패키징. 그 전까지 prod rrn_decrypt 게이트 변경 금지.
