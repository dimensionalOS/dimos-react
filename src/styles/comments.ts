// Comments (dimos-react/comments): the composer, a thread, the badge, and the floating card they open in.
export const COMMENTS_CSS = /* css */ `
.dr-comment-card {
    width: min(340px, calc(100vw - 16px));
    max-height: min(70vh, 520px);
    overflow-y: auto;
    padding: 10px 12px;
    color: var(--fg);
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    backdrop-filter: var(--blur);
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.dr-comment-card > .dr-menu { margin: -6px -8px; border: none; box-shadow: none; background: none; padding: 0; }
.dr-comment-composer, .dr-comment-thread, .dr-comment-writer { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dr-comment-thread + .dr-comment-thread { border-top: 1px solid var(--border); padding-top: 10px; }
.dr-comment-heading { display: flex; align-items: center; gap: 7px; font: 12.5px var(--sans); color: var(--muted-fg); }
.dr-comment-heading b { color: var(--fg); font-weight: 600; }
.dr-comment-heading > svg { color: var(--primary); flex: none; }
.dr-comment-target { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); }
.dr-comment-thread--resolved .dr-comment-heading > svg { color: var(--ok); }
.dr-comment-thread--resolved .dr-comment-entries { opacity: 0.7; }
.dr-comment-entries { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.dr-comment-entry { padding-left: 9px; border-left: 2px solid var(--border-strong); }
.dr-comment-entry--agent { border-left-color: var(--primary); }
.dr-comment-meta { display: flex; gap: 8px; align-items: baseline; font: 11.5px var(--sans); color: var(--muted-fg); }
.dr-comment-author { font-weight: 600; color: var(--fg); }
.dr-comment-entry--agent .dr-comment-author { color: var(--primary); }
.dr-comment-text { font: 13px/1.45 var(--sans); white-space: pre-wrap; overflow-wrap: anywhere; }
.dr-comment-writer .dr-textarea { width: 100%; min-height: 0; resize: vertical; font: 13px/1.4 var(--sans); }
.dr-comment-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.dr-comment-hint { margin-right: auto; font: 11px var(--sans); color: var(--muted-fg); }
.dr-comment-error { font: 12px var(--sans); color: var(--danger); }
.dr-comment-badge {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 6px 1px 5px;
    font: 600 11px var(--sans);
    color: var(--primary-fg);
    background: var(--primary);
    border: none;
    border-radius: var(--radius-pill);
    cursor: pointer;
}
`
