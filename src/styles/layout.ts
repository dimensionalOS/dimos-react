// Cards, panels, split panes, bars, stacks, HUD. Tokens only (see base.js).
export const LAYOUT_CSS = /* css */ `
.dr-card, .dr-panel {
    background: var(--card);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    min-width: 0;
}
.dr-card { display: flex; flex-direction: column; gap: 12px; }
.dr-card--padded { padding: 16px; }
.dr-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dr-card-titles { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dr-card-title {
    margin: 0;
    font: 500 10.5px/1.5 var(--mono);
    letter-spacing: var(--track-label);
    text-transform: var(--label-case);
    color: var(--head-color, var(--primary));
}
:root[data-dr-dark] .dr-card-title { font: 400 10px/1.5 var(--display); color: var(--muted-fg); }
.dr-card-desc { color: var(--muted-fg); font-size: 13px; }
.dr-card-actions { display: flex; gap: 6px; align-items: center; }
.dr-glass { background: var(--glass, var(--panel)); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); }

.dr-panel { display: flex; flex-direction: column; overflow: hidden; }
.dr-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; padding: 0 8px 0 4px; border-bottom: 1px solid var(--hair); }
.dr-panel--closed .dr-panel-head { border-bottom-color: transparent; }
.dr-panel-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 6px;
    border: 0;
    background: none;
    color: var(--muted-fg);
    cursor: pointer;
    border-radius: var(--radius-sm);
}
.dr-panel-toggle:hover { color: var(--fg); }
.dr-panel-toggle:focus-visible { outline: none; box-shadow: var(--dr-focus); }
.dr-panel-toggle--static { cursor: default; }
.dr-panel-toggle--static:hover { color: var(--muted-fg); }
.dr-panel-title {
    font: 500 10.5px/1.5 var(--mono);
    letter-spacing: var(--track-label);
    text-transform: var(--label-case);
    color: var(--fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
:root[data-dr-dark] .dr-panel-title { font: 400 10px/1.5 var(--display); }
.dr-panel-actions { display: flex; align-items: center; gap: 4px; }
.dr-panel-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; overflow: auto; min-height: 0; }
.dr-panel-close { display: inline-flex; padding: 5px; border: 0; background: none; color: var(--muted-fg); cursor: pointer; border-radius: var(--radius-sm); }
.dr-panel-close:hover { color: var(--fg); background: var(--hover); }
.dr-floating { position: fixed; z-index: 50; max-height: calc(100vh - 24px - var(--dim-inset-bottom, 0px)); box-shadow: var(--shadow-md, var(--shadow-lg)); }
.dr-floating-head { cursor: grab; user-select: none; }
.dr-floating-head:active { cursor: grabbing; }

.dr-split { display: flex; min-width: 0; min-height: 0; width: 100%; height: 100%; }
.dr-split--column { flex-direction: column; }
.dr-split-pane { min-width: 0; min-height: 0; overflow: auto; flex: 0 0 auto; }
.dr-split-pane--rest { flex: 1 1 0; }
.dr-split-divider { flex: none; position: relative; background: var(--border); transition: background 0.15s ease; }
.dr-split--row > .dr-split-divider { width: 1px; cursor: col-resize; }
.dr-split--column > .dr-split-divider { height: 1px; cursor: row-resize; }
.dr-split-divider::after { content: ""; position: absolute; inset: -4px; }
.dr-split-divider:hover, .dr-split-divider:focus-visible { background: var(--primary); outline: none; }

.dr-topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    padding: 6px 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
}
.dr-topbar-left, .dr-topbar-right, .dr-topbar-center { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dr-topbar-left { color: var(--head-color, var(--primary)); }
.dr-topbar-center { flex: 1; justify-content: center; }
.dr-topbar-right { justify-content: flex-end; }
/* a phone: the center (a search, tabs) gets a row of its own under the title and the right-side controls */
@media (max-width: 700px) {
    .dr-topbar { flex-wrap: wrap; row-gap: 8px; }
    .dr-topbar-left { flex: 1; overflow: hidden; }
    .dr-topbar-center:not(:empty) { order: 3; flex-basis: 100%; }
    .dr-topbar-center:not(:empty) > * { flex: 1; }
}
.dr-disclosure__summary { display: block; margin-bottom: 6px; cursor: pointer; list-style: none; }
.dr-disclosure__summary::-webkit-details-marker { display: none; }
.dr-disclosure__summary::before { content: "▸ "; }
.dr-disclosure[open] > .dr-disclosure__summary::before { content: "▾ "; }
/* card: the border and corners live on the box itself, so the title row and the open body can never leave a gap between them */
.dr-disclosure--card { border: 1px solid var(--border); border-radius: var(--radius-lg); background: color-mix(in srgb, var(--fg) 4%, var(--card, var(--surface))); overflow: hidden; }
.dr-disclosure--card > .dr-disclosure__summary { display: flex; align-items: center; gap: 8px; min-height: 40px; box-sizing: border-box; margin: 0; padding: 0 12px;
    color: var(--fg); letter-spacing: 0; text-transform: none; font-size: 13px; font-weight: 500; }
.dr-disclosure--card > .dr-disclosure__summary:hover { background: var(--hover, color-mix(in srgb, var(--fg) 6%, transparent)); }
.dr-disclosure--card > .dr-disclosure__summary::before, .dr-disclosure--card[open] > .dr-disclosure__summary::before { content: none; }
.dr-disclosure--card > .dr-disclosure__summary::after { content: "›"; margin-left: auto; color: var(--muted-fg); font-size: 17px; transition: transform 120ms; }
.dr-disclosure--card[open] > .dr-disclosure__summary::after { transform: rotate(90deg); }
.dr-disclosure--card[open] > .dr-disclosure__summary { border-bottom: 1px solid var(--border); }
.dr-disclosure__count { margin-left: 4px; color: var(--muted-fg); letter-spacing: 0; text-transform: none; }
.dr-toolbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dr-toolbar--vertical { flex-direction: column; flex-wrap: nowrap; }
.dr-toolbar--floating { padding: 4px; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow); }
.dr-bottombar {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    padding: 4px 12px;
    padding-bottom: calc(4px + var(--dim-inset-bottom, 0px));
    background: var(--surface);
    border-top: 1px solid var(--border);
    font-size: 12.5px;
    color: var(--muted-fg);
}
.dr-sep { display: block; flex: none; height: 1px; width: 100%; background: var(--hair); margin: 4px 0; }
.dr-sep--vertical { width: 1px; height: 20px; margin: 0 4px; align-self: center; background: var(--border); }
.dr-row { display: flex; flex-direction: row; min-width: 0; }
.dr-col { display: flex; flex-direction: column; min-width: 0; }
.dr-spacer { flex: 1; }

.dr-hud { position: absolute; z-index: 10; display: flex; flex-direction: column; gap: 8px; pointer-events: none; padding: 12px; }
.dr-hud > * { pointer-events: auto; }
.dr-hud--top-left { top: 0; left: 0; }
.dr-hud--top-right { top: 0; right: 0; align-items: flex-end; }
.dr-hud--bottom-left { bottom: var(--dim-inset-bottom, 0px); left: 0; }
.dr-hud--bottom-right { bottom: var(--dim-inset-bottom, 0px); right: 0; align-items: flex-end; }
.dr-hud--top { top: 0; left: 50%; transform: translateX(-50%); align-items: center; }
.dr-hud--bottom { bottom: var(--dim-inset-bottom, 0px); left: 50%; transform: translateX(-50%); align-items: center; }
.dr-hud--center { top: 50%; left: 50%; transform: translate(-50%, -50%); align-items: center; }

.dr-shell { display: flex; flex-direction: column; height: 100vh; height: 100dvh; min-height: 0; background: var(--bg); color: var(--fg); }
.dr-shell-main { flex: 1; display: flex; min-height: 0; }
.dr-shell--inset { padding-bottom: var(--dim-inset-bottom, 0px); box-sizing: border-box; }
.dr-embed { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; background: var(--bg); }
.dr-shell-content { flex: 1; min-width: 0; min-height: 0; overflow: auto; position: relative; }
.dr-resize-handle {
    position: absolute;
    bottom: 0;
    width: 22px;
    height: 22px;
    z-index: 3;
    touch-action: none;
}
.dr-resize-handle--bottom-right { right: 0; cursor: nwse-resize; }
.dr-resize-handle--bottom-left { left: 0; cursor: nesw-resize; }
.dr-resize-handle::before {
    content: "";
    position: absolute;
    bottom: 4px;
    width: 11px;
    height: 11px;
    border-bottom: 2px solid color-mix(in srgb, var(--fg) 55%, transparent);
    opacity: 0.7;
    transition: opacity 0.15s, border-color 0.15s;
}
.dr-resize-handle--bottom-right::before { right: 4px; border-right: 2px solid color-mix(in srgb, var(--fg) 55%, transparent); }
.dr-resize-handle--bottom-left::before { left: 4px; border-left: 2px solid color-mix(in srgb, var(--fg) 55%, transparent); }
.dr-resize-handle:hover::before, .dr-resize-handle:active::before { opacity: 1; border-color: var(--fg); }

/* tiles */
.dr-tile-grid { display: grid; gap: 10px; }
.dr-tile {
    appearance: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    min-width: 0;
    padding: 16px 12px 14px;
    font: inherit;
    text-align: center;
    color: var(--fg);
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s, transform 0.12s;
}
.dr-tile:hover:not(:disabled) { border-color: var(--border-strong); background: var(--hover); }
.dr-tile:focus-visible { outline: none; box-shadow: var(--dr-focus); }
.dr-tile:active:not(:disabled) { transform: translateY(1px); }
.dr-tile:disabled { opacity: 0.5; cursor: default; }
.dr-tile--start { align-items: stretch; text-align: left; padding: 12px 14px; }
.dr-tile--start .dr-tile__title, .dr-tile--start .dr-tile__subtitle { white-space: normal; }
.dr-tile--selected { border-color: var(--primary); background: var(--sel); }
.dr-tile--loading { cursor: default; }
.dr-tile__media { display: flex; align-items: center; justify-content: center; width: 72px; height: 72px; color: var(--primary); }
.dr-tile__media img { max-width: 100%; max-height: 100%; }
.dr-tile__title { font-size: 13.5px; font-weight: 500; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr-tile__subtitle { font-size: 12px; color: var(--muted-fg); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr-tile__bar { display: block; width: 70%; height: 12px; }
.dr-tile__bar--short { width: 45%; }
`
