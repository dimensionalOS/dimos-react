// Alerts, toasts, modals, spinners, progress, empty states. Tokens only (see base.js).
export const FEEDBACK_CSS = /* css */ `
.dr-alert {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-left: max(var(--list-rule, 2px), 1px) solid var(--dr-tone, var(--info));
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--dr-tone, var(--info)) 7%, var(--surface));
    color: var(--fg);
    font-size: 13.5px;
    --dr-tone: var(--info);
}
.dr-alert--ok { --dr-tone: var(--ok); }
.dr-alert--warn { --dr-tone: var(--warn); }
.dr-alert--danger { --dr-tone: var(--danger); }
.dr-alert-icon { display: inline-flex; color: var(--dr-tone); padding-top: 1px; }
.dr-alert-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dr-alert-title { font-weight: 600; }
:root[data-dr-dark] .dr-alert-title { font-weight: 500; letter-spacing: 0.02em; }
.dr-alert-text { color: var(--muted-fg); }
.dr-alert-actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }

.dr-toasts {
    position: fixed;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: min(420px, calc(100vw - 24px));
    pointer-events: none;
}
.dr-toasts--bottom-right { right: 12px; bottom: calc(12px + var(--dim-inset-bottom, 0px)); }
.dr-toasts--bottom { left: 50%; transform: translateX(-50%); bottom: calc(12px + var(--dim-inset-bottom, 0px)); }
.dr-toasts--top-right { right: 12px; top: calc(12px + var(--dim-inset-top, 0px)); }
.dr-toasts--top { left: 50%; transform: translateX(-50%); top: calc(12px + var(--dim-inset-top, 0px)); }
.dr-toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 8px 8px 12px;
    background: var(--raised);
    color: var(--fg);
    border: 1px solid var(--border);
    border-left: max(var(--list-rule, 2px), 1px) solid var(--dr-tone, var(--info));
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    backdrop-filter: var(--blur);
    font-size: 13.5px;
    animation: dr-rise-in 0.18s ease;
    --dr-tone: var(--info);
}
.dr-toast--ok { --dr-tone: var(--ok); }
.dr-toast--warn { --dr-tone: var(--warn); }
.dr-toast--danger { --dr-tone: var(--danger); }
.dr-toast-icon { display: inline-flex; color: var(--dr-tone); }
.dr-toast-body { flex: 1; min-width: 0; }
.dr-toast-title { font-weight: 600; }
.dr-toast-text { color: var(--muted-fg); overflow-wrap: anywhere; }
.dr-toast-title + .dr-toast-text { font-size: 12.5px; }

.dr-scrim {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: var(--scrim);
    animation: dr-fade-in 0.15s ease;
}
.dr-modal {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: calc(100vh - 32px);
    background: var(--raised);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg);
    outline: none;
    animation: dr-rise-in 0.18s ease;
}
.dr-modal--sm { max-width: 400px; }
.dr-modal--md { max-width: 560px; }
.dr-modal--lg { max-width: 860px; }
.dr-modal--xl { max-width: 1100px; height: min(720px, calc(100vh - 32px)); }
.dr-modal--xl .dr-modal-body { flex: 1; min-height: 0; }
.dr-modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 12px 12px 16px;
    border-bottom: 1px solid var(--hair);
}
.dr-modal-title { font: 400 20px/1.2 var(--display); }
:root[data-dr-dark] .dr-modal-title { font-size: 11px; letter-spacing: var(--track-label); text-transform: var(--label-case); color: var(--muted-fg); }
.dr-modal-body { padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
.dr-modal-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--hair); }
.dr-modal-message { margin: 0; color: var(--muted-fg); }

.dr-spinner {
    display: inline-block;
    flex: none;
    width: 18px;
    height: 18px;
    border: 2px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: dr-edges 1.2s linear infinite;
}
/* it doesn't turn (a square one, in a square skin, wobbled): the highlight walks its edges, top → right → bottom → left */
@keyframes dr-edges {
    0%, 100% { border-color: var(--primary) var(--border) var(--border) var(--border); }
    25% { border-color: var(--border) var(--primary) var(--border) var(--border); }
    50% { border-color: var(--border) var(--border) var(--primary) var(--border); }
    75% { border-color: var(--border) var(--border) var(--border) var(--primary); }
}
@media (prefers-reduced-motion: reduce) {
    .dr-spinner { animation-name: none !important; }
}
.dr-spinner--inline { width: 13px; height: 13px; border-width: 2px; }
.dr-progress { position: relative; height: 4px; width: 100%; overflow: hidden; border-radius: var(--radius-pill); background: var(--track); --dr-tone: var(--primary); }
.dr-progress--ok { --dr-tone: var(--ok); }
.dr-progress--warn { --dr-tone: var(--warn); }
.dr-progress--danger { --dr-tone: var(--danger); }
.dr-progress-fill { height: 100%; background: var(--dr-tone); transition: width 0.2s ease; }
:root[data-dr-dark] .dr-progress-fill { box-shadow: var(--glow); }
.dr-progress--indeterminate .dr-progress-fill { width: 35%; position: absolute; animation: dr-progress-slide 1.2s ease-in-out infinite; }
@keyframes dr-progress-slide { from { left: -35%; } to { left: 100%; } }
.dr-ring { position: relative; display: inline-flex; align-items: center; justify-content: center; --dr-tone: var(--primary); }
.dr-ring--ok { --dr-tone: var(--ok); }
.dr-ring--warn { --dr-tone: var(--warn); }
.dr-ring--danger { --dr-tone: var(--danger); }
.dr-ring svg { position: absolute; inset: 0; }
.dr-ring-track { stroke: var(--track); }
.dr-ring-fill { stroke: var(--dr-tone); stroke-linecap: round; transition: stroke-dashoffset 0.2s ease; }
.dr-ring-label { font: 11px var(--mono); color: var(--fg); }
.dr-skeleton {
    display: block;
    border-radius: var(--radius-sm);
    background: linear-gradient(90deg, var(--hover), var(--sel), var(--hover));
    background-size: 200% 100%;
    animation: dr-shimmer 1.4s ease infinite;
}
@keyframes dr-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

.dr-empty { display: flex; align-items: center; justify-content: center; padding: 32px 16px; text-align: center; }
.dr-empty--layer { position: absolute; inset: 0; z-index: 5; pointer-events: none; padding-bottom: calc(32px + var(--dim-inset-bottom, 0px)); }
.dr-empty--layer .dr-empty-inner { pointer-events: auto; background: var(--glass, var(--surface)); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px 24px; backdrop-filter: var(--blur); }
.dr-empty-inner { display: flex; flex-direction: column; align-items: center; gap: 8px; max-width: 420px; }
.dr-empty-icon { color: var(--muted-fg); display: inline-flex; }
.dr-empty--danger .dr-empty-icon { color: var(--danger); }
.dr-empty--warn .dr-empty-icon { color: var(--warn); }
.dr-empty-title { font: 400 18px/1.3 var(--display); color: var(--fg); }
:root[data-dr-dark] .dr-empty-title { font-size: 11px; letter-spacing: var(--track-label); text-transform: var(--label-case); }
.dr-empty-text { color: var(--muted-fg); font-size: 13.5px; }
.dr-empty-actions { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; justify-content: center; }
/* notice: Desktop's first-run card. Research: a hairline card, a display sentence, a mono micro-label in the accent;
   Portal: a square panel with an accent edge, a sans sentence, a display micro-label */
.dr-empty--notice { padding: 16px; }
.dr-empty--notice.dr-empty--layer { display: grid; place-items: center; padding: 16px; }
.dr-empty--notice .dr-empty-inner,
.dr-empty--notice.dr-empty--layer .dr-empty-inner {
    box-sizing: border-box;
    width: min(480px, 100%);
    max-width: none;
    align-items: stretch;
    gap: 10px;
    padding: 22px 24px;
    text-align: left;
    background: var(--card);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    backdrop-filter: none;
}
.dr-empty--notice .dr-empty-label {
    font: 500 10.5px/1.5 var(--mono);
    letter-spacing: var(--track-label);
    text-transform: var(--label-case);
    color: var(--primary);
}
.dr-empty--notice .dr-empty-inner--warn .dr-empty-label { color: var(--warn); }
.dr-empty--notice .dr-empty-inner--busy .dr-empty-label::after { content: " …"; }
.dr-empty--notice .dr-empty-title { font: 400 24px/1.2 var(--display); letter-spacing: -0.01em; text-transform: none; }
.dr-empty--notice .dr-empty-text { font: 400 13.5px/1.55 var(--sans); }
.dr-empty--notice .dr-empty-text code { font-size: 12.5px; }
.dr-empty--notice .dr-empty-actions { justify-content: flex-start; }
:root[data-dr-dark] .dr-empty--notice .dr-empty-inner {
    background: var(--panel);
    border: 1px solid var(--line);
    border-left: 2px solid var(--primary);
    box-shadow: none;
}
:root[data-dr-dark] .dr-empty--notice .dr-empty-inner--warn { border-left-color: var(--warn); }
:root[data-dr-dark] .dr-empty--notice .dr-empty-label { font: 400 10px/1.5 var(--display); color: var(--dim); }
:root[data-dr-dark] .dr-empty--notice .dr-empty-title { font: 500 16px/1.4 var(--sans); letter-spacing: 0; text-transform: none; }
`
