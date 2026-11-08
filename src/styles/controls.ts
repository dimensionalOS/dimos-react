// Buttons, inputs, selects, checks, switches, sliders, badges, chips, dots. Tokens only (see base.js).
export const CONTROLS_CSS = /* css */ `
/* buttons: Research a filled card with a hairline; Portal transparent with a hairline */
.dr-btn {
    appearance: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: var(--dr-control-h);
    font: 500 13px/1.25 var(--sans);
    letter-spacing: var(--track-btn);
    text-transform: var(--chip-case, none);
    color: var(--fg);
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 7px 14px;
    white-space: nowrap;
    user-select: none;
    transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease, color 0.15s ease;
}
:root[data-dr-dark] .dr-btn {
    font-weight: 400;
    font-size: 12px;
    background: transparent;
}
.dr-btn:hover { background: var(--hover); border-color: var(--border-strong); }
.dr-btn:focus-visible { outline: none; border-color: var(--ring); box-shadow: var(--dr-focus); }
.dr-btn:active { background: var(--sel); }
.dr-btn:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
.dr-btn--primary { color: var(--primary-fg); background: var(--primary); border-color: var(--primary); }
.dr-btn--primary:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
:root[data-dr-dark] .dr-btn--primary { color: var(--primary); background: var(--sel); border-color: var(--primary); }
:root[data-dr-dark] .dr-btn--primary:hover { background: var(--sel); box-shadow: var(--glow-accent); }
.dr-btn--ghost { background: transparent; border-color: transparent; color: var(--muted-fg); }
.dr-btn--ghost:hover { color: var(--fg); background: var(--hover); border-color: transparent; }
:root[data-dr-dark] .dr-btn--ghost:hover { border-color: var(--border); }
.dr-btn--danger { color: var(--danger); border-color: var(--danger-line); }
.dr-btn--danger:hover { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); }
.dr-btn--ok { color: var(--ok); border-color: var(--ok-line); }
.dr-btn--ok:hover { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 8%, transparent); }
.dr-btn--warn { color: var(--warn); border-color: var(--warn-line); }
.dr-btn--warn:hover { border-color: var(--warn); background: color-mix(in srgb, var(--warn) 8%, transparent); }
.dr-btn--danger[aria-pressed="true"] { color: var(--danger); border-color: var(--danger); background: color-mix(in srgb, var(--danger) 14%, transparent); }
.dr-btn[aria-pressed="true"] { color: var(--primary); background: var(--sel); border-color: var(--primary); }
.dr-btn--sm { min-height: var(--dr-control-h-sm); font-size: 12px; padding: 3px 10px; gap: 5px; }
:root[data-dr-dark] .dr-btn--sm { font-size: 11px; }
.dr-btn--lg { min-height: 42px; padding: 10px 22px; font-size: 14px; font-weight: 600; }
.dr-btn--block { display: flex; width: 100%; }
.dr-btn--icon { padding: 0; width: var(--dr-control-h); flex: none; }
.dr-btn--icon.dr-btn--sm { width: var(--dr-control-h-sm); }
.dr-btn--icon.dr-btn--lg { width: 42px; }
.dr-btn--round { border-radius: var(--radius-round); }
.dr-btn-group { display: inline-flex; }
.dr-btn-group > .dr-btn { border-radius: 0; }
.dr-btn-group > .dr-btn + .dr-btn { margin-left: -1px; }
.dr-btn-group > .dr-btn:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.dr-btn-group > .dr-btn:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
.dr-btn-group > .dr-btn:hover, .dr-btn-group > .dr-btn[aria-pressed="true"] { position: relative; z-index: 1; }

/* fields */
.dr-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dr-field-label { font-size: 12.5px; color: var(--muted-fg); }
:root[data-dr-dark] .dr-field-label { font-size: 12px; letter-spacing: 0.02em; }
.dr-field-control { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dr-field-control > .dr-input-wrap, .dr-field-control > .dr-select, .dr-field-control > .dr-textarea, .dr-field-control > .dr-slider { flex: 1; }
.dr-field-hint { font-size: 12px; color: var(--muted-fg); }
.dr-field-error { font-size: 12px; color: var(--danger); }
.dr-field--inline { flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: space-between; column-gap: 12px; }
/* inline: a hint or error takes its own line under the label and control */
.dr-field--inline > .dr-field-hint, .dr-field--inline > .dr-field-error { flex-basis: 100%; }
.dr-field--inline > .dr-field-label { flex: 0 0 auto; min-width: 84px; }
.dr-field--inline > .dr-field-control { flex: 1; justify-content: flex-end; }
.dr-field--error .dr-input, .dr-field--error .dr-select { border-color: var(--danger); }

/* text inputs */
.dr-input-wrap { position: relative; display: inline-flex; align-items: center; min-width: 0; }
.dr-input, .dr-select {
    appearance: none;
    width: 100%;
    min-height: var(--dr-control-h);
    font: 400 14px/1.3 var(--sans);
    color: var(--fg);
    background: var(--input-bg);
    border: 1px solid var(--input);
    border-radius: var(--radius);
    padding: 7px 11px;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.dr-input.dr-mono { font-family: var(--mono); font-size: 13px; }
.dr-input::placeholder { color: var(--placeholder); }
.dr-input:hover, .dr-select:hover { border-color: var(--border-strong); }
.dr-input:focus, .dr-select:focus { border-color: var(--ring); box-shadow: var(--dr-focus); }
.dr-input:disabled, .dr-select:disabled { opacity: 0.55; cursor: not-allowed; }
.dr-input[aria-invalid="true"] { border-color: var(--danger); }
.dr-input--sm, .dr-select--sm { min-height: var(--dr-control-h-sm); font-size: 12.5px; padding: 3px 8px; }
.dr-input--with-icon { padding-left: 32px; }
.dr-input--with-unit { padding-right: 38px; }
.dr-input-icon { position: absolute; left: 10px; display: inline-flex; color: var(--muted-fg); pointer-events: none; }
.dr-input-unit { position: absolute; right: 10px; font: 12px var(--mono); color: var(--muted-fg); pointer-events: none; }
.dr-input-clear {
    position: absolute;
    right: 6px;
    display: inline-flex;
    padding: 4px;
    border: 0;
    background: none;
    color: var(--muted-fg);
    cursor: pointer;
    border-radius: var(--radius-sm);
}
.dr-input-clear:hover { color: var(--fg); background: var(--hover); }
.dr-search input::-webkit-search-cancel-button { display: none; }
.dr-number { width: 100%; }
/* a box of lines rounds like a card, not a control: a pill skin's 999px --radius made it a stadium */
.dr-textarea { min-height: 84px; line-height: 1.5; resize: vertical; padding: 9px 11px; border-radius: min(var(--radius), var(--radius-lg)); }
.dr-select {
    cursor: pointer;
    padding-right: 32px;
    background-image:
        linear-gradient(45deg, transparent 50%, var(--muted-fg) 50%),
        linear-gradient(135deg, var(--muted-fg) 50%, transparent 50%);
    background-position: right 15px center, right 10px center;
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
}
.dr-select option, .dr-select optgroup { background: var(--raised); color: var(--fg); }

/* checkbox + radio: a filled accent box with a tick in --primary-fg (every skin); Portal radios a hairline ring */
.dr-check { position: relative; display: inline-flex; align-items: center; gap: 9px; cursor: pointer; font-size: 14px; color: var(--fg); user-select: none; }
:root[data-dr-dark] .dr-check { font-size: 13.5px; }
.dr-check input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
.dr-check-box {
    --dr-tick: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.6 8.4l2.9 2.9 5.9-6.3' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    width: 15px;
    height: 15px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--input-bg);
    transition: background 0.13s ease, border-color 0.13s ease;
}
.dr-radio .dr-check-box { border-radius: var(--radius-round); }
.dr-check:hover .dr-check-box { border-color: var(--primary); }
.dr-check input:checked + .dr-check-box { background: var(--primary); border-color: var(--primary); }
.dr-check input:checked + .dr-check-box::after {
    content: "";
    width: 100%;
    height: 100%;
    background: var(--primary-fg);
    -webkit-mask: var(--dr-tick) center / 100% 100% no-repeat;
    mask: var(--dr-tick) center / 100% 100% no-repeat;
}
.dr-check input:indeterminate + .dr-check-box { background: var(--primary); border-color: var(--primary); }
.dr-check input:indeterminate + .dr-check-box::after { content: ""; width: 8px; height: 2px; background: var(--primary-fg); -webkit-mask: none; mask: none; }
.dr-radio input:checked + .dr-check-box { background: var(--input-bg); border-width: 4.5px; }
.dr-radio input:checked + .dr-check-box::after { content: none; }
.dr-check input:focus-visible + .dr-check-box { box-shadow: var(--dr-focus); border-color: var(--ring); }
:root[data-dr-dark] .dr-check-box { width: 14px; height: 14px; border-color: var(--muted-fg); }
:root[data-dr-dark] .dr-radio input:checked + .dr-check-box { background: var(--input-bg); border: 1px solid var(--primary); }
.dr-check--disabled { opacity: 0.5; cursor: not-allowed; }
.dr-check-label { min-width: 0; }
.dr-radio-group { display: flex; gap: 8px 16px; }
.dr-radio-group--column { flex-direction: column; }
.dr-radio-group--row { flex-direction: row; flex-wrap: wrap; }

/* switch */
.dr-toggle { position: relative; display: inline-flex; align-items: center; gap: 9px; cursor: pointer; font-size: 14px; user-select: none; }
.dr-toggle input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
.dr-toggle-track {
    position: relative;
    width: 34px;
    height: 20px;
    flex: none;
    border-radius: var(--radius-pill);
    background: var(--track);
    border: 1px solid var(--border-strong);
    transition: background 0.15s ease, border-color 0.15s ease;
}
.dr-toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: var(--radius-round);
    background: var(--muted-fg);
    transition: transform 0.15s ease, background 0.15s ease;
}
.dr-toggle input:checked + .dr-toggle-track { background: var(--primary); border-color: var(--primary); }
.dr-toggle input:checked + .dr-toggle-track .dr-toggle-knob { transform: translateX(14px); background: var(--primary-fg); }
/* --toggle-on / --toggle-on-knob: a skin whose accent is neutral (Vibeslop) fills an on switch solid; unset, the accent tint */
:root[data-dr-dark] .dr-toggle input:checked + .dr-toggle-track { background: var(--toggle-on, var(--sel)); }
:root[data-dr-dark] .dr-toggle input:checked + .dr-toggle-track .dr-toggle-knob { background: var(--toggle-on-knob, var(--primary)); box-shadow: var(--glow); }
.dr-toggle input:focus-visible + .dr-toggle-track { box-shadow: var(--dr-focus); }
.dr-toggle--sm .dr-toggle-track { width: 28px; height: 16px; }
.dr-toggle--sm .dr-toggle-knob { width: 10px; height: 10px; }
.dr-toggle--sm input:checked + .dr-toggle-track .dr-toggle-knob { transform: translateX(12px); }

/* sliders */
.dr-slider { display: flex; align-items: center; gap: 10px; min-width: 120px; --dr-fill: 50%; }
.dr-slider input[type="range"] {
    appearance: none;
    -webkit-appearance: none;
    flex: 1;
    min-width: 0;
    height: 18px;
    margin: 0;
    background: transparent;
    cursor: pointer;
}
.dr-slider input[type="range"]::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: var(--radius-pill);
    background: linear-gradient(90deg, var(--primary) var(--dr-fill), var(--track) var(--dr-fill));
    border: 1px solid var(--border);
}
.dr-slider input[type="range"]::-moz-range-track { height: 4px; border-radius: var(--radius-pill); background: var(--track); border: 1px solid var(--border); }
.dr-slider input[type="range"]::-moz-range-progress { height: 4px; background: var(--primary); }
.dr-slider input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    margin-top: -6px;
    border-radius: var(--radius-round);
    background: var(--primary);
    border: 2px solid var(--bg);
    box-shadow: 0 0 0 1px var(--primary);
}
.dr-slider input[type="range"]::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: var(--radius-round);
    background: var(--primary);
    border: 2px solid var(--bg);
}
:root[data-dr-dark] .dr-slider input[type="range"]::-webkit-slider-thumb { box-shadow: 0 0 0 1px var(--primary), var(--glow); }
.dr-slider input[type="range"]:focus-visible { outline: none; }
.dr-slider input[type="range"]:focus-visible::-webkit-slider-thumb { box-shadow: var(--dr-focus); }
/* touch: only the thumb takes a finger (a tap or a scroll that starts on the track scrolls the page instead of moving
   the value), and the thumb is big enough to grab; the range slider's inputs already work this way */
@media (pointer: coarse) {
    .dr-slider input[type="range"] { pointer-events: none; height: 26px; }
    .dr-slider input[type="range"]::-webkit-slider-thumb { pointer-events: auto; width: 22px; height: 22px; margin-top: -10px; }
    .dr-slider input[type="range"]::-moz-range-thumb { pointer-events: auto; width: 20px; height: 20px; }
}
.dr-slider-value { font: 12px var(--mono); color: var(--muted-fg); min-width: 3.5em; text-align: right; white-space: nowrap; }
.dr-slider--disabled { opacity: 0.5; }
.dr-range { --dr-from: 0%; --dr-to: 100%; }
.dr-range-inputs { position: relative; flex: 1; height: 18px; }
.dr-range-inputs::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 7px;
    height: 4px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--border);
    background: linear-gradient(90deg, var(--track) var(--dr-from), var(--primary) var(--dr-from), var(--primary) var(--dr-to), var(--track) var(--dr-to));
}
.dr-range-inputs input[type="range"] { position: absolute; inset: 0; width: 100%; pointer-events: none; }
.dr-range-inputs input[type="range"]::-webkit-slider-runnable-track { background: transparent; border-color: transparent; }
.dr-range-inputs input[type="range"]::-moz-range-track { background: transparent; border-color: transparent; }
.dr-range-inputs input[type="range"]::-moz-range-progress { background: transparent; }
.dr-range-inputs input[type="range"]::-webkit-slider-thumb { pointer-events: auto; }
.dr-range-inputs input[type="range"]::-moz-range-thumb { pointer-events: auto; }

/* badges + chips */
.dr-badge, .dr-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: 400 12px/1.4 var(--mono);
    padding: 2px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    color: var(--secondary-fg);
    background: var(--secondary);
    white-space: nowrap;
    vertical-align: middle;
}
:root[data-dr-dark] .dr-badge, :root[data-dr-dark] .dr-chip { font-size: 11.5px; padding: 2px 8px; }
.dr-badge--info { color: var(--primary); border-color: var(--accent-line); background: var(--sel); }
.dr-badge--ok { color: var(--ok); border-color: var(--ok-line); }
.dr-badge--warn { color: var(--warn); border-color: var(--warn-line); }
.dr-badge--danger { color: var(--danger); border-color: var(--danger-line); }
.dr-badge--solid { font: 500 10.5px/1.5 var(--mono); padding: 1px 7px; color: var(--primary-fg); background: var(--primary); border-color: var(--primary); }
.dr-badge--solid.dr-badge--ok { background: var(--ok); border-color: var(--ok); color: var(--primary-fg); }
.dr-badge--solid.dr-badge--warn { background: var(--warn); border-color: var(--warn); color: var(--primary-fg); }
.dr-badge--solid.dr-badge--danger { background: var(--danger); border-color: var(--danger); color: var(--danger-fg); }
.dr-badge-dot { width: 6px; height: 6px; border-radius: var(--radius-round); background: currentColor; }
.dr-chip[role="button"] { cursor: pointer; user-select: none; }
.dr-chip[role="button"]:hover { border-color: var(--border-strong); color: var(--fg); }
.dr-chip[aria-pressed="true"] { color: var(--primary); border-color: var(--primary); background: var(--sel); }
.dr-chip:focus-visible { outline: none; box-shadow: var(--dr-focus); }
.dr-chip-remove { display: inline-flex; padding: 1px; margin-right: -3px; border: 0; background: none; color: inherit; cursor: pointer; opacity: 0.7; border-radius: var(--radius-sm); }
.dr-chip-remove:hover { opacity: 1; background: var(--hover); }

/* tag lists */
.dr-tags { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; align-items: center; }
.dr-tags--one-line { flex-wrap: nowrap; overflow: hidden; }
.dr-tags--one-line > * { flex: none; }

/* status dots */
.dr-dot { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: var(--radius-round); background: var(--ok); color: var(--ok); vertical-align: middle; }
.dr-dot--ok { background: var(--ok); color: var(--ok); }
.dr-dot--warn { background: var(--warn); color: var(--warn); }
.dr-dot--danger { background: var(--danger); color: var(--danger); }
.dr-dot--info { background: var(--info); color: var(--info); }
.dr-dot--off { background: var(--off); color: var(--off); }
:root[data-dr-dark] .dr-dot:not(.dr-dot--off) { box-shadow: 0 0 6px currentColor; }
.dr-dot--pulse { animation: dr-pulse 1.4s ease-in-out infinite; }
@keyframes dr-pulse { 50% { opacity: 0.35; } }
.dr-conn { display: inline-flex; align-items: center; gap: 7px; font: 12px var(--mono); color: var(--muted-fg); white-space: nowrap; }
.dr-conn-label { color: var(--fg); }
.dr-conn--danger .dr-conn-label { color: var(--danger); }
.dr-conn--warn .dr-conn-label { color: var(--warn); }
.dr-conn-detail { color: var(--muted-fg); }
.dr-kbd-group { display: inline-flex; gap: 3px; }

/* a link styled as a button */
a.dr-btn { text-decoration: none; }
a.dr-btn[aria-disabled="true"] { opacity: 0.5; pointer-events: none; }

/* floating action button (Fab) */
.dr-fab {
    --dr-fab-tone: var(--primary);
    appearance: none;
    width: var(--dr-fab-size, 52px);
    height: var(--dr-fab-size, 52px);
    flex: none;
    display: inline-grid;
    place-items: center;
    padding: 0;
    border-radius: var(--radius-round);
    border: 2px solid var(--dr-fab-tone);
    background: color-mix(in srgb, var(--card) 92%, transparent);
    color: var(--fg);
    cursor: pointer;
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--dr-fab-tone) 14%, transparent), var(--shadow-md, var(--shadow));
    transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.dr-fab:hover:not(:disabled) { transform: scale(1.06); }
.dr-fab:focus-visible { outline: none; box-shadow: var(--dr-focus), var(--shadow-md, var(--shadow)); }
.dr-fab:disabled { opacity: 0.35; cursor: default; }
.dr-fab--info { --dr-fab-tone: var(--info); }
.dr-fab--ok { --dr-fab-tone: var(--ok); }
.dr-fab--warn { --dr-fab-tone: var(--warn); }
.dr-fab--danger { --dr-fab-tone: var(--danger); }
.dr-fab--active { background: var(--dr-fab-tone); color: var(--primary-fg); }
.dr-fab--pulse:not(:disabled) { animation: dr-fab-pulse 1.6s ease-in-out infinite; }
.dr-fab--glow:not(:disabled) { animation: dr-fab-glow 2.4s ease-in-out infinite; }
.dr-fab--spin:not(:disabled) { animation: dr-fab-spin 1.4s linear infinite; }
@keyframes dr-fab-pulse {
    50% { box-shadow: 0 0 0 10px color-mix(in srgb, var(--dr-fab-tone) 25%, transparent), var(--shadow-md, var(--shadow)); }
}
@keyframes dr-fab-glow {
    50% {
        box-shadow: 0 0 0 12px color-mix(in srgb, var(--dr-fab-tone) 28%, transparent),
            0 0 32px 6px color-mix(in srgb, var(--dr-fab-tone) 45%, transparent), var(--shadow-md, var(--shadow));
        transform: scale(1.05);
    }
}
@keyframes dr-fab-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dr-fab { animation: none !important; } }

/* angle dial */
.dr-dial {
    --dr-dial-tone: var(--primary);
    position: relative;
    flex: none;
    border-radius: var(--radius-round);
    border: 2px solid var(--dr-dial-tone);
    background: radial-gradient(circle, color-mix(in srgb, var(--dr-dial-tone) 15%, transparent), transparent 70%);
    cursor: grab;
    touch-action: none;
}
.dr-dial:active { cursor: grabbing; }
.dr-dial:focus-visible { outline: none; box-shadow: var(--dr-focus); }
.dr-dial--info { --dr-dial-tone: var(--info); }
.dr-dial--ok { --dr-dial-tone: var(--ok); }
.dr-dial--warn { --dr-dial-tone: var(--warn); }
.dr-dial--danger { --dr-dial-tone: var(--danger); }
.dr-dial--disabled { opacity: 0.45; cursor: default; }
.dr-dial-hand {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 44%;
    height: 2px;
    margin-top: -1px;
    background: var(--dr-dial-tone);
    transform-origin: 0 50%;
}
`
