// LOGIC-LOCK: L-003 — 차트 수정사항 CRM 전체 고객 동일 적용. 변경 시 현장 승인 필수
// LOGIC-LOCK: L-004 — 차트 접근 경로 잠금. createPortal 제거 금지. AdminLayout 단일 마운트. 변경 시 현장 승인 필수
/**
 * T-20260514-foot-CHART2-OPEN-BUG (재오픈 수정)
 * 고객차트(2번차트) 오른쪽 슬라이드 패널
 *
 * AC-4: 모든 진입 경로(대시보드, 고객차트보기, URL 직접, 체크인 상세)에서 정상 열림
 *
 * v2 재구현 (2026-05-14):
 * - @base-ui/react Sheet 중첩 방식 제거
 *   → nested Dialog Portal-inside-Portal race condition으로 인터랙션 블로킹 발생
 * - ReactDOM.createPortal + CSS 슬라이드로 재구현
 *   → 외부 dialog context 완전 독립, 모든 진입 경로 안정적 동작
 * - ESC 키, 백드롭 클릭 닫기 지원
 * - zLevel=1 대응: z-[60](백드롭) / z-[70](패널)
 *
 * T-20260603-foot-CHART-UNSAVED-GUARD (AC-1): 차팅 중 미저장 데이터 손실 방어
 * - 차트 내부에서 한 번이라도 사용자 입력(input 이벤트)이 발생한 dirty 상태면,
 *   백드롭 클릭 / ESC 시 즉시 닫지 않고 확인 다이얼로그("작성 중인 내용이 있습니다...")를 띄운다.
 * - 입력이 없던(non-dirty) 상태면 기존처럼 즉시 닫힘 — 불필요한 마찰/기존 ESC-닫기 플로우 보존.
 * - 메신저 확인 후 복귀 클릭이 백드롭에 닿아도 작성 중 내용이 사라지지 않음.
 * - 명시적 닫기 버튼(X)은 의도적 닫기이므로 즉시 닫힘 유지.
 * - dirty 판정은 패널 하위 input/textarea의 input 이벤트로 추적
 *   (사용자 입력만 발화 — React setState 기반 값 변경은 DOM input 이벤트를 발화하지 않음).
 */
// T-20260516-foot-CHART2-STATE-UNIFY: MemoryRouter 제거 — RR6.30 nested Router 금지
// CustomerChartPage에 customerId prop 직접 주입으로 대체
import { useEffect, useRef, useState, useCallback, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Maximize2 } from 'lucide-react';
import { ChartSheetCloseCtx, ChartSheetSaveRegistryCtx, ChartSheetMarkCleanCtx, ChartSheetDockCtx, type ChartSaveFn } from '@/lib/chartSheetContext';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
// T-20260623-foot-CHART2-POPUP-WINDOW-AUTOREFRESH Part B: 차트 미저장 입력 시 헤더 자동 새로고침 카운트다운을 일시정지(무손실)
import { setDirty } from '@/lib/dashboardRefreshBus';

const CHART_DIRTY_KEY = 'customer-chart';

const CustomerChartPage = lazy(() => import('@/pages/CustomerChartPage'));

interface Props {
  customerId: string | null;
  onClose: () => void;
}

export function CustomerChartSheet({ customerId, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  // T-20260603-foot-CHART-UNSAVED-GUARD AC-1: 닫기 전 확인 다이얼로그
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  // ESC 핸들러(capture)가 항상 최신 상태를 읽도록 ref 동기화
  const showConfirmRef = useRef(false);
  showConfirmRef.current = showCloseConfirm;
  // 차트 내부에서 사용자 입력이 한 번이라도 발생했는지 (미저장 여부 proxy)
  const dirtyRef = useRef(false);
  // T-20260609-foot-CHART2-SAVE-CLOSE-BTN: 본문 저장 핸들러 등록 채널 + "저장 후 닫기" 진행 상태
  const saveFnRef = useRef<ChartSaveFn | null>(null);
  const [savingClose, setSavingClose] = useState(false);

  // T-20260630-foot-RESV-CUSTCTX-PREFILL [Q2 — 동선2 차트 오버레이 = 옵션 ①+③]:
  //   in-page 서랍 모드에서 [다음예약] 클릭 시 차트를 닫지 않고 '도킹' 모드로 전환한다.
  //   - docked=true: 차트를 우측 상단 작은 플로팅 창으로 축소 + 헤더 드래그로 화면 한쪽 이동 + CSS resize로 크기 조절,
  //     backdrop pointer-events 해제(pass-through) → 배경 예약판 빈 슬롯 클릭이 차트에 가로채이지 않고 동작.
  //   - L-002('[예약하기]類=항상 full전환,예외없음') + L-004('차트 접근경로 잠금') LOGIC-LOCK variance =
  //     현장 권위자 김주연 총괄 명시승인(ticket frontmatter logic_lock_variance, ts 1782819349.054839). 임의변경 아님.
  const [docked, setDocked] = useState(false);
  const [dockPos, setDockPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ active: boolean; offsetX: number; offsetY: number }>({ active: false, offsetX: 0, offsetY: 0 });

  const requestDock = useCallback(() => setDocked(true), []);

  const clampDockPos = useCallback((x: number, y: number) => {
    const margin = 8;
    const w = panelRef.current?.offsetWidth ?? 380;
    const maxX = (typeof window !== 'undefined' ? window.innerWidth : 1280) - w - margin;
    const maxY = (typeof window !== 'undefined' ? window.innerHeight : 800) - 48; // 헤더는 항상 잡히게 하단 여유
    return { x: Math.max(margin, Math.min(x, Math.max(margin, maxX))), y: Math.max(margin, Math.min(y, Math.max(margin, maxY))) };
  }, []);

  const onDockPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!docked) return;
    if ((e.target as HTMLElement).closest('button')) return; // 헤더 버튼 위에서는 드래그 시작 안 함(오발동 방지)
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { active: true, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 미지원 무시 */ }
  }, [docked]);

  const onDockPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    e.preventDefault();
    setDockPos(clampDockPos(e.clientX - dragRef.current.offsetX, e.clientY - dragRef.current.offsetY));
  }, [clampDockPos]);

  const onDockPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }, []);

  // 차트 재오픈(customerId 변경) 시 dirty/확인창/도킹 리셋
  useEffect(() => {
    dirtyRef.current = false;
    setDirty(CHART_DIRTY_KEY, false); // Part B: 새 차트는 clean으로 시작 → 카운트다운 보류 해제
    setShowCloseConfirm(false);
    setSavingClose(false);
    setDocked(false);
    setDockPos(null);
  }, [customerId]);

  // Part B: 차트 언마운트(닫힘 포함) 시 dirty 신호 해제 — 닫힌 차트가 카운트다운을 무한 보류시키지 않게
  useEffect(() => () => { setDirty(CHART_DIRTY_KEY, false); }, []);

  // T-20260609-foot-CHART2-SAVE-CLOSE-BTN AC-2/AC-3: 저장 후 닫기
  //  - 본문 저장 버튼과 동일한 핸들러(handleInfoPanelSave) 호출 → 성공 시 닫기, 실패 시 유지(내용 보존)
  //  - 저장 중 중복 클릭 방지(savingClose 가드 + 버튼 disabled)
  const handleSaveAndClose = async () => {
    if (savingClose) return; // AC-3: 더블클릭 중복 저장 방지
    setSavingClose(true);
    try {
      const fn = saveFnRef.current;
      // 등록된 저장 핸들러가 없으면(이론상 미마운트) 저장할 본문 없음 → 그대로 닫기
      const ok = fn ? await fn() : true;
      if (ok) {
        setShowCloseConfirm(false);
        onClose();
      }
      // ok === false: 다이얼로그 유지. 저장 핸들러가 이미 구체 에러 toast를 띄움(내용 보존).
    } catch (e) {
      console.error('[CHART2-SAVE-CLOSE] 저장 중 예외:', e);
      toast.error('저장 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setSavingClose(false);
    }
  };

  // ESC 키 핸들러 — dirty 가드 적용 (AC-1)
  useEffect(() => {
    if (!customerId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 확인 다이얼로그가 떠 있으면 base-ui가 자체 ESC(취소)를 처리하도록 통과
        if (showConfirmRef.current) return;
        e.stopPropagation();
        // dirty 아니면 즉시 닫힘(기존 동작 보존), dirty면 확인 노출
        if (dirtyRef.current) {
          setShowCloseConfirm(true);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [customerId, onClose]);

  // 패널이 열릴 때 포커스 이동
  useEffect(() => {
    if (customerId && panelRef.current) {
      panelRef.current.focus();
    }
  }, [customerId]);

  if (!customerId) return null;

  // T-20260611-foot-CHART2-SAVE-DIRTY-RESET AC-1: 본문 저장 성공 시 기존 dirty 가드를 clean으로 리셋.
  //  - 신규 dirty 메커니즘 X — onInput proxy가 쓰는 dirtyRef를 그대로 끈다(= baseline을 방금 저장값으로 갱신).
  //  - 이후 추가 입력이 발생하면 onInput이 다시 dirtyRef=true로 올려 가드 재노출(AC-2).
  const markChartClean = () => { dirtyRef.current = false; setDirty(CHART_DIRTY_KEY, false); };

  // 백드롭/요청 닫기 — dirty면 확인, 아니면 즉시 닫기
  const requestClose = () => {
    if (dirtyRef.current) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  };

  // LOGIC-LOCK: L-004 [CHART-LOCK-006] — createPortal 제거 금지. AdminLayout 외부에서 중복 마운트 절대 금지.
  return createPortal(
    <>
      {/* 백드롭 — T-20260603-foot-CHART-UNSAVED-GUARD AC-1: dirty 시 확인 경유.
          T-20260630-foot-RESV-CUSTCTX-PREFILL [Q2]: docked 모드에서는 pointer-events 해제(pass-through) + 딤 제거
          → 배경 예약판 빈 슬롯 클릭이 차트에 가로채이지 않고 동작(L-004 variance, 현장 승인). */}
      <div
        className={
          docked
            ? 'fixed inset-0 z-[60] pointer-events-none'
            : 'fixed inset-0 z-[60] bg-black/40'
        }
        onClick={docked ? undefined : requestClose}
        data-testid="chart-backdrop"
        data-docked={String(docked)}
        aria-hidden="true"
      />
      {/* 슬라이드 패널 — flex-col: 닫기 버튼(고정) + 콘텐츠(스크롤) 분리.
          T-20260630-foot-RESV-CUSTCTX-PREFILL [Q2]: docked 모드 = 우측 상단 작은 플로팅 창(헤더 드래그 이동 + CSS resize 크기조절). */}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal={docked ? undefined : 'true'}
        aria-label="고객차트"
        data-testid="customer-chart-sheet"
        data-docked={String(docked)}
        // T-20260603-foot-CHART-UNSAVED-GUARD AC-1: 하위 입력 이벤트로 dirty 추적
        onInput={() => { dirtyRef.current = true; setDirty(CHART_DIRTY_KEY, true); }}
        className={
          docked
            ? 'fixed z-[70] w-[380px] h-[60vh] min-w-[300px] min-h-[280px] max-w-[90vw] max-h-[90vh] bg-background border rounded-lg shadow-2xl flex flex-col outline-none overflow-hidden resize'
            : 'fixed right-0 top-0 z-[70] h-full w-[95vw] sm:w-[88vw] max-w-5xl bg-background shadow-lg flex flex-col outline-none animate-in slide-in-from-right duration-300'
        }
        style={docked ? { left: dockPos?.x ?? undefined, top: dockPos?.y ?? 16, right: dockPos ? 'auto' : 16 } : undefined}
      >
        {/* 닫기 버튼 헤더 — flex-shrink-0: 스크롤 영역 밖, 항상 visible.
            docked 모드에서는 이 헤더가 드래그 핸들(cursor-move) + 전체화면 복귀 버튼 노출. */}
        <div
          className={
            docked
              ? 'relative flex-shrink-0 h-10 cursor-move touch-none select-none bg-muted/40 border-b'
              : 'relative flex-shrink-0 h-10'
          }
          data-testid="chart-sheet-header"
          onPointerDown={onDockPointerDown}
          onPointerMove={onDockPointerMove}
          onPointerUp={onDockPointerUp}
          onPointerCancel={onDockPointerUp}
        >
          {docked && (
            <button
              className="absolute right-10 top-2.5 z-10 rounded-md p-1 text-muted-foreground hover:bg-muted transition"
              onClick={() => { setDocked(false); setDockPos(null); }}
              aria-label="전체화면"
              data-testid="chart-undock-btn"
              type="button"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          )}
          <button
            className="absolute right-3 top-3 z-10 rounded-md p-1 text-muted-foreground hover:bg-muted transition"
            onClick={onClose}
            aria-label="닫기"
            type="button"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 콘텐츠 스크롤 영역 */}
        <div className="flex-grow overflow-y-auto">
          {/* T-20260609-foot-CHART2-SAVE-CLOSE-BTN: 본문 저장 핸들러 등록 채널 제공 */}
          {/* T-20260611-foot-CHART2-SAVE-DIRTY-RESET: 저장 성공 시 dirty 가드 리셋 채널 제공 */}
          {/* T-20260630-foot-RESV-CUSTCTX-PREFILL [Q2]: [다음예약] → 도킹 요청 채널 제공 */}
          <ChartSheetDockCtx.Provider value={requestDock}>
          <ChartSheetSaveRegistryCtx.Provider value={saveFnRef}>
          <ChartSheetMarkCleanCtx.Provider value={markChartClean}>
          <ChartSheetCloseCtx.Provider value={onClose}>
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
                  차트 불러오는 중…
                </div>
              }
            >
              {/* customerId prop 직접 주입 — useParams() 대신 prop 우선 사용 */}
              <CustomerChartPage customerId={customerId} />
            </Suspense>
          </ChartSheetCloseCtx.Provider>
          </ChartSheetMarkCleanCtx.Provider>
          </ChartSheetSaveRegistryCtx.Provider>
          </ChartSheetDockCtx.Provider>
        </div>
      </div>

      {/* T-20260603-foot-CHART-UNSAVED-GUARD AC-1: 닫기 확인 다이얼로그 (z-[80]/[90] — 차트 위) */}
      <Dialog open={showCloseConfirm} onOpenChange={(o) => { if (!o) setShowCloseConfirm(false); }}>
        <DialogContent className="max-w-lg" hideClose data-testid="chart-close-confirm">
          <DialogHeader>
            <DialogTitle>작성 중인 내용이 있습니다</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            저장하지 않은 작성 내용이 사라질 수 있습니다. 저장 후 닫으시겠습니까?
          </p>
          {/* T-20260609-foot-CHART2-SAVE-CLOSE-BTN: 3선택지 — 저장 후 닫기(primary) / 저장하지 않고 닫기 / 취소 */}
          {/* T-20260611-foot-CHART2-CONFIRM-BTN-OVERFLOW: max-w-lg + sm:flex-wrap 으로 3버튼 가로 배치 시 경계 밖 overflow 방지 (좁은 폭은 col-reverse 세로 스택) */}
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button
              variant="outline"
              data-testid="chart-close-cancel"
              disabled={savingClose}
              onClick={() => setShowCloseConfirm(false)}
            >
              취소(계속 작성)
            </Button>
            <Button
              variant="destructive"
              data-testid="chart-close-confirm-btn"
              disabled={savingClose}
              onClick={() => { setShowCloseConfirm(false); onClose(); }}
            >
              저장하지 않고 닫기
            </Button>
            <Button
              variant="default"
              data-testid="chart-save-close-btn"
              disabled={savingClose}
              onClick={handleSaveAndClose}
              className="bg-teal-600 hover:bg-teal-700"
            >
              {savingClose && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {savingClose ? '저장 중…' : '저장 후 닫기'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>,
    document.body,
  );
}
