import { useState } from "react";
import { observeResize } from "../../lib/observeResize";

function measureEditorContentBounds(editor: HTMLElement): {
  readonly width: number;
  readonly height: number;
  readonly blockCount: number;
} {
  const blocks = editor.querySelectorAll<HTMLElement>(
    "p, li, pre, blockquote, h1, h2, h3, h4, h5, h6",
  );
  const range = document.createRange();
  range.selectNodeContents(editor);
  const bounds = range.getBoundingClientRect();
  if (blocks.length !== 1) {
    return { width: bounds.width, height: bounds.height, blockCount: blocks.length };
  }
  const block = blocks[0]!;
  if (block.childNodes.length === 0) {
    return { width: 0, height: bounds.height, blockCount: 1 };
  }
  const inlineRange = document.createRange();
  inlineRange.selectNodeContents(block);
  const inlineBounds = inlineRange.getBoundingClientRect();
  return { width: inlineBounds.width, height: bounds.height, blockCount: 1 };
}

function measureComposerMultilinePrompt(body: HTMLElement): boolean | null {
  const editor = body.querySelector<HTMLElement>('[data-testid="composer-editor"]');
  if (!editor || editor.clientWidth === 0) return null;

  const bodyStyle = getComputedStyle(body);
  const expandedWidth =
    body.clientWidth -
    Number.parseFloat(bodyStyle.paddingLeft) -
    Number.parseFloat(bodyStyle.paddingRight);
  const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight);
  const { width, height, blockCount } = measureEditorContentBounds(editor);
  const singleLineBudget = Math.max(120, expandedWidth - 340);

  // Measure inline text against the expanded single-line budget so pill <-> stacked does not oscillate.
  return blockCount > 1 || height > lineHeight + 2 || width > singleLineBudget;
}

/** Whether the prompt wraps, and the ref callback that measures it on the composer body. */
export function useComposerMultilinePrompt(): readonly [
  boolean,
  (body: HTMLElement | null) => (() => void) | undefined,
] {
  const [isMultiline, setIsMultiline] = useState(false);
  const observeBody = (body: HTMLElement | null) => {
    if (!body) return;
    // Measuring reads layout, so one measurement per frame runs after all of the frame's DOM
    // writes instead of forcing a layout after each mutation.
    let frame: number | null = null;
    const measure = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const next = measureComposerMultilinePrompt(body);
        if (next !== null) setIsMultiline(next);
      });
    };
    measure();
    const editor = body.querySelector<HTMLElement>('[data-testid="composer-editor"]');
    const stopObserving = observeResize(editor ? [body, editor] : body, measure);
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(body, { childList: true, characterData: true, subtree: true });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      stopObserving();
      mutationObserver.disconnect();
    };
  };
  return [isMultiline, observeBody] as const;
}
