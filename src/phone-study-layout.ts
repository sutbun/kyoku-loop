import { useLayoutEffect, useRef } from "react";

// Measure the actual surrounding UI: safe areas, notices, hand rows and melds
// all consume space that a fixed viewport subtraction cannot account for.
export function usePhoneStudyLayout(active: boolean, item?: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (active) window.scrollTo(0, 0);
  }, [active, item]);
  useLayoutEffect(() => {
    const app = ref.current;
    if (!active || !app) return;
    let frame = 0;
    const fit = () => {
      const quiz = app.querySelector<HTMLElement>(".quiz-layout");
      const wrap = quiz?.querySelector<HTMLElement>(".table-wrap");
      const table = wrap?.querySelector<HTMLElement>(".table");
      const board = quiz?.querySelector<HTMLElement>(".board-panel");
      const answer = quiz?.querySelector<HTMLElement>(".quiz-answer");
      const nav = app.querySelector<HTMLElement>(".phone-nav");
      if (!quiz || !wrap || !table || !board || !answer || !nav) return;
      const sideBySide =
        getComputedStyle(quiz).gridTemplateColumns.split(" ").length > 1;
      const viewport = window.visualViewport;
      const viewportBottom = viewport
        ? viewport.height + viewport.offsetTop
        : innerHeight;
      const bottom =
        getComputedStyle(nav).display === "none"
          ? viewportBottom - parseFloat(getComputedStyle(app).paddingBottom)
          : Math.min(nav.getBoundingClientRect().top, viewportBottom);
      const style = getComputedStyle(wrap);
      const width =
        wrap.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      // Opening optional detail must not make the board jump or disappear.
      let answerHeight = answer.offsetHeight;
      for (const details of answer.querySelectorAll<HTMLDetailsElement>(
        "details[open]",
      )) {
        const summary = details.querySelector("summary");
        if (summary)
          answerHeight -=
            details.offsetHeight - summary.getBoundingClientRect().height;
      }
      answerHeight = Math.max(
        answerHeight,
        parseFloat(getComputedStyle(answer).minHeight) || 0,
      );
      const overhead = board.offsetHeight - table.offsetHeight;
      const available =
        bottom -
        (quiz.getBoundingClientRect().top + window.scrollY) -
        overhead -
        4 -
        (sideBySide
          ? 0
          : answerHeight + parseFloat(getComputedStyle(quiz).rowGap));
      const ratio = getComputedStyle(table).aspectRatio.split("/").map(Number);
      const aspect = ratio[0] / (ratio[1] || 1);
      // Very short windows, expanded details and large text retain scrolling
      // rather than hiding content or shrinking the table without a lower bound.
      const target = Math.floor(
        Math.min(width, Math.max(190, available * aspect)),
      );
      const value = `${target}px`;
      if (app.style.getPropertyValue("--study-table-width") !== value)
        app.style.setProperty("--study-table-width", value);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const observer = new ResizeObserver(schedule);
    for (const element of app.querySelectorAll(
      ".phone-header, .content, .study-heading, .quiz-layout, .board-panel, .quiz-answer, .phone-nav",
    ))
      observer.observe(element);
    fit();
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  });
  return ref;
}
