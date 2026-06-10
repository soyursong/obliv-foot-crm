# Scope Guard — 종로 오리진점(`jongno-foot`) 전용

> **Standing 제약 (모든 후속 foot 작업에 상속).** 코드 변경 아님 — dev-foot/supervisor가 풋 작업 착수·QA 시 참조하는 단일 스코프 가드.
>
> 출처: `T-20260609-foot-JONGNO-ORIGIN-SCOPE-GUARD` (김주연 총괄, 슬랙 `C0ATE5P6JTH`, MSG-20260609-100051-q768)
> SSOT 원본: `~/claude-sync/memory/_handoff/tickets/T-20260609-foot-JONGNO-ORIGIN-SCOPE-GUARD.md`

## 원문

> "이 채널에서 요청하는 작업들은 무조건 종로 오리진점(jongno-foot) 내용이야. 타지점, 타센터에 절대 영향 주지말고 영향 받지도 마."

## 전제

- 이 채널(`C0ATE5P6JTH`)에서 들어오는 모든 풋 요청의 default scope = **`jongno-foot`(종로 오리진점) 단일 지점**.
- 이 CRM(`obliv-foot-crm`)은 데이터 계층에서 이미 jongno-foot 단일 지점으로 핀됨:
  코드 앵커 → `src/lib/clinic.ts` `const SLUG = 'jongno-foot'` (`getClinic()` 단일 진입).
- 셀프접수: `foot-checkin.pages.dev/jongno-foot`.
- 본 요청 구현이 타지점·타센터(롱레/피부/도수/도파민 등)의 동작/데이터에 **영향을 주거나 받아서는 안 됨.**

## Standing 제약 (4)

1. **쓰기 스코프 격리** — 코드/쿼리/마이그레이션은 `clinic_slug='jongno-foot'`(또는 동등 지점 식별자)로 필터·스코프.
   전역(branch-agnostic) write 금지. 불가피하면 planner `DECISION-REQUEST`.
2. **공유 모듈 변경 가드** — 타지점·타센터가 공유하는 컴포넌트/RPC/테이블을 건드리는 변경이면
   착수 전 planner 회신(공유 영향 범위 1줄). 무단 공유 변경 금지.
3. **cross-domain redirect 금지 재확인** — `window.location.replace`/외부 도메인 이동 등
   cross-domain runtime 동작 신설 금지. 기존 LOCKDOWN(`incident_jongnofoot_redirect_l2_pattern.md` §1-1) 그대로 유효.
4. **QA 게이트(supervisor)** — 풋 배포 시 변경 코드가 타지점·타센터 경로를 회귀시키지 않는지 확인
   (스코프 누수 회귀 가드). 의심 시 `qa-fail` + planner 회부.

## 갱신 조건

"이 채널 = jongno-foot" 전제가 깨지는 요청(예: 타지점 동시 적용 명시)이 오면 reporter(김주연 총괄) 확인 후 본 가드 갱신.

## 정합 참조

- `~/claude-sync/memory/_handoff/logic_lock_registry.md` (L-001~L-006 foot 락)
- `~/claude-sync/memory/incident_jongnofoot_redirect_l2_pattern.md` §1-1 (cross-domain redirect LOCKDOWN)
- `agents/docs/cross_crm_data_contract.md` (foot `clinic_slug=jongno-foot` 스코프 = 본 가드와 동치)
