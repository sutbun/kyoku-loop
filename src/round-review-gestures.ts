import { useEffect, type RefObject } from "react";

// Wheel events already contain platform inertia. Queue individual steps instead
// of locking a whole wheel burst; touch has the same bounded, decaying motion.
export function useReviewGestures(
  ref: RefObject<HTMLDivElement | null>,
  move: (delta: number) => boolean,
) {
  useEffect(() => {
    const board = ref.current?.querySelector<HTMLElement>(".table");
    if (!board) return;
    let pending = 0,
      frame = 0,
      lastStep = 0,
      suppressedUntil = 0;
    let touch: {
      x: number;
      y: number;
      lastY: number;
      at: number;
      velocity: number;
      swiped: boolean;
    } | null = null;
    let velocity = 0,
      lastFrame = 0;
    const tick = (now: number) => {
      const elapsed = Math.min(40, now - (lastFrame || now));
      lastFrame = now;
      if (velocity) {
        pending += velocity * elapsed;
        velocity *= Math.exp(-elapsed / 180);
        if (Math.abs(velocity) < 0.03) velocity = 0;
      }
      pending = Math.max(-480, Math.min(480, pending));
      if (Math.abs(pending) >= 60 && now - lastStep >= 75) {
        const direction = Math.sign(pending);
        if (!move(direction)) {
          pending = 0;
          velocity = 0;
        } else {
          pending -= direction * 60;
          lastStep = now;
        }
      }
      if (Math.abs(pending) >= 60 || velocity)
        frame = requestAnimationFrame(tick);
      else {
        frame = 0;
        lastFrame = 0;
      }
    };
    const start = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const wheel = (e: WheelEvent) => {
      if (
        e.ctrlKey ||
        Math.abs(e.deltaY) <= Math.abs(e.deltaX) ||
        (e.target as Element).closest("button,input,textarea,select")
      )
        return;
      e.preventDefault();
      pending +=
        e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 120 : 1);
      start();
    };
    const touchStart = (e: TouchEvent) => {
      velocity = pending = 0;
      if (
        e.touches.length !== 1 ||
        (e.target as Element).closest("button,input,textarea,select")
      ) {
        touch = null;
        return;
      }
      const p = e.touches[0];
      touch = {
        x: p.clientX,
        y: p.clientY,
        lastY: p.clientY,
        at: performance.now(),
        velocity: 0,
        swiped: false,
      };
    };
    const touchMove = (e: TouchEvent) => {
      if (!touch || e.touches.length !== 1) {
        touch = null;
        return;
      }
      const p = e.touches[0],
        dy = touch.y - p.clientY,
        dx = touch.x - p.clientX;
      if (
        !touch.swiped &&
        (Math.abs(dy) < 24 || Math.abs(dy) < Math.abs(dx) * 1.2)
      )
        return;
      e.preventDefault();
      const now = performance.now(),
        delta = touch.lastY - p.clientY;
      touch.velocity = Math.max(
        -2.5,
        Math.min(2.5, delta / Math.max(16, now - touch.at)),
      );
      pending += touch.swiped ? delta : dy;
      touch.lastY = p.clientY;
      touch.at = now;
      touch.swiped = true;
      suppressedUntil = now + 500;
      start();
    };
    const touchEnd = () => {
      if (touch?.swiped) {
        suppressedUntil = performance.now() + 500;
        velocity = performance.now() - touch.at < 100 ? touch.velocity : 0;
        start();
      }
      touch = null;
    };
    const touchCancel = () => {
      touch = null;
      velocity = pending = 0;
      suppressedUntil = performance.now() + 500;
    };
    const click = (e: MouseEvent) => {
      if (performance.now() < suppressedUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (
        !(e.target as Element).closest(
          "button,.tile,.river,.table-center,.hand-layer",
        )
      )
        move(1);
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.target !== board) return;
      if (["ArrowRight", "ArrowLeft"].includes(e.key)) {
        e.preventDefault();
        move(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    board.tabIndex = 0;
    board.addEventListener("wheel", wheel, { passive: false });
    board.addEventListener("touchstart", touchStart, { passive: true });
    board.addEventListener("touchmove", touchMove, { passive: false });
    board.addEventListener("touchend", touchEnd);
    board.addEventListener("touchcancel", touchCancel);
    board.addEventListener("click", click, true);
    board.addEventListener("keydown", keydown);
    return () => {
      cancelAnimationFrame(frame);
      board.removeEventListener("wheel", wheel);
      board.removeEventListener("touchstart", touchStart);
      board.removeEventListener("touchmove", touchMove);
      board.removeEventListener("touchend", touchEnd);
      board.removeEventListener("touchcancel", touchCancel);
      board.removeEventListener("click", click, true);
      board.removeEventListener("keydown", keydown);
    };
  }, [ref, move]);
}
