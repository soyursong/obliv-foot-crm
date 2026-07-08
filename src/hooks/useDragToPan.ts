// T-20260708-foot-DASH-HSCROLL-DRAGPAN
// 현장(풋센터) 요청: "대시보드 현황판에서 옆으로 넘기는거 스크롤 말고 화면 꾹 누르고 넘기기".
// = 가로 스크롤 영역을 마우스로 배경을 누른 채 좌우로 끌면 콘텐츠가 따라 이동하는 grab-and-drag(pan) 인터랙션.
//
// 설계 원칙 (티켓 AC + 리스크#5 신규 npm 지양):
//   - pointer 이벤트 + scrollLeft self-implement (외부 라이브러리 無)
//   - AC1: 배경/빈영역에서 눌러 끌면 pan, 떼면 멈춤
//   - AC2: 기존 휠/트랙패드/스크롤바 유지 (대체 아님 — 이 훅은 리스너를 얹기만 함)
//   - AC3: 커서 grab → grabbing
//   - AC4: 클릭 가능 요소(버튼/링크/입력/드래그 카드) 위에서는 pan을 시작하지 않음.
//          그 외 배경에서도 이동거리 임계(PAN_THRESHOLD)를 넘어야 pan으로 판정 → 짧은 클릭은 클릭 그대로.
//   - AC5: 가로 이동만 수행(scrollLeft). 세로 스크롤(휠/네이티브)은 건드리지 않음.
//   - touch: 태블릿 네이티브 스와이프가 이미 grab-and-drag이므로 JS pan 미적용(이중 스크롤 방지).
//            신규 capability는 마우스/펜(스크롤바·휠에만 의존하던 케이스)에 한정.

import { useEffect } from 'react';
import type { RefObject } from 'react';

// 클릭/드래그 목적이 명확한 요소 — 이 위에서는 pan을 시작하지 않는다.
// dnd-kit useDraggable/useSortable 카드는 aria-roledescription="draggable" 을 부여받는다.
const INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  '[role="button"]',
  '[role="menuitem"]',
  '[aria-roledescription="draggable"]',
  '[contenteditable="true"]',
  '[data-no-pan]',
].join(',');

const PAN_THRESHOLD = 5; // px — 이 거리를 넘겨야 클릭이 아닌 pan 으로 판정 (AC4)

// el 자신부터 위로 올라가며 가로 스크롤이 실제로 존재하는 컨테이너를 찾는다.
// (데스크톱: 칸반 자신이 스크롤 / 모바일: 상위 컨테이너가 스크롤 — 두 레이아웃 모두 커버)
function findHScrollTarget(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el;
  while (node) {
    if (node.scrollWidth > node.clientWidth + 1) return node;
    node = node.parentElement;
  }
  return el;
}

export function useDragToPan<T extends HTMLElement>(ref: RefObject<T>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let pointerId: number | null = null;
    let scrollTarget: HTMLElement | null = null;
    let startX = 0;
    let startScrollLeft = 0;
    let panning = false;

    const clearGrab = () => {
      el.style.cursor = '';
      if (scrollTarget) {
        scrollTarget.style.removeProperty('user-select');
        // AC6 정합: pan 중 억제했던 카드-snap(scroll-snap-type) 복원 → 놓으면 카드 경계로 snap.
        scrollTarget.style.removeProperty('scroll-snap-type');
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      // 마우스/펜만 (터치는 네이티브 스와이프에 위임 — AC2/AC5)
      if (e.pointerType === 'touch') return;
      // 주 버튼(좌클릭)만
      if (e.button !== 0) return;
      const target = e.target as Element | null;
      // 클릭 가능/드래그 요소 위에서는 pan 미시작 (AC4)
      if (target && target.closest(INTERACTIVE_SELECTOR)) return;

      scrollTarget = findHScrollTarget(el);
      // 가로 스크롤이 없으면(=넘길 것이 없으면) pan 불필요
      if (scrollTarget.scrollWidth <= scrollTarget.clientWidth + 1) {
        scrollTarget = null;
        return;
      }
      pointerId = e.pointerId;
      startX = e.clientX;
      startScrollLeft = scrollTarget.scrollLeft;
      panning = false;
      el.style.cursor = 'grab'; // AC3
    };

    const onPointerMove = (e: PointerEvent) => {
      if (pointerId === null || e.pointerId !== pointerId || !scrollTarget) return;
      const dx = e.clientX - startX;
      if (!panning) {
        if (Math.abs(dx) < PAN_THRESHOLD) return; // 임계 미만 → 아직 클릭 후보 (AC4)
        panning = true;
        try {
          el.setPointerCapture(pointerId);
        } catch {
          /* noop */
        }
        el.style.cursor = 'grabbing'; // AC3
        scrollTarget.style.setProperty('user-select', 'none'); // pan 중 텍스트 선택 방지
        // AC1×AC6 충돌 방지: 컨테이너의 snap-mandatory(카드 경계 강제정렬)가 imperative scrollLeft 와
        //   매 프레임 싸워 드래그가 튕기는 것을 막기 위해, pan 활성 동안만 scroll-snap-type 을 none 으로 억제.
        //   release(endPan→clearGrab) 시 복원 → 놓는 순간 가장 가까운 카드 경계로 snap.
        scrollTarget.style.setProperty('scroll-snap-type', 'none');
      }
      // AC5: 가로 이동만
      scrollTarget.scrollLeft = startScrollLeft - dx;
      e.preventDefault();
    };

    const endPan = (e: PointerEvent) => {
      if (pointerId === null || e.pointerId !== pointerId) return;
      const wasPanning = panning;
      if (wasPanning) {
        try {
          el.releasePointerCapture(pointerId);
        } catch {
          /* noop */
        }
        // pan 직후 따라오는 click 을 1회 억제 → 배경 위 요소의 오작동 방지 (AC4 보강)
        const suppressClick = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        el.addEventListener('click', suppressClick, { capture: true, once: true });
        // click 이 발생하지 않은 경우를 대비해 즉시 정리 예약
        window.setTimeout(() => {
          el.removeEventListener('click', suppressClick, true);
        }, 0);
      }
      clearGrab();
      pointerId = null;
      scrollTarget = null;
      panning = false;
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endPan);
    el.addEventListener('pointercancel', endPan);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endPan);
      el.removeEventListener('pointercancel', endPan);
      clearGrab();
    };
  }, [ref]);
}
