// The image view and the playback bar. Tokens only (the play button, rail, fill and thumb reuse .dr-timeline__*).
export const MEDIA_CSS = /* css */ `
/* image view */
.dr-image {
    position: relative;
    display: block;
    overflow: hidden;
    min-height: 0;
    background: var(--scene-bg, var(--bg));
}
.dr-image__media {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
}
.dr-image--cover .dr-image__media { object-fit: cover; }
.dr-image__overlay { pointer-events: none; }
.dr-image__media[data-quality="low"] { filter: blur(0.4px); opacity: 0.85; }
.dr-image__waiting {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted-fg);
    opacity: 0.6;
}

/* playback bar */
.dr-playback {
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--surface);
    border-top: 1px solid var(--border);
    color: var(--fg);
}
.dr-playback__bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    min-width: 0;
}
.dr-playback__controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
}
.dr-playback__time {
    font: 12px var(--mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.dr-playback__now { color: var(--fg); }
.dr-playback__length { color: var(--muted-fg); }
.dr-playback__speed { width: auto; }
.dr-playback__expand {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 8px;
    font: 500 12px var(--sans);
    color: var(--muted-fg);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius);
    cursor: pointer;
}
.dr-playback__expand:hover { color: var(--fg); background: var(--hover); }
.dr-playback__expand:focus-visible { outline: none; box-shadow: var(--dr-focus); }
.dr-playback__on,
.dr-playback__on:hover { color: var(--primary); background: var(--sel); }
.dr-playback__lane {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 28px;
    cursor: pointer;
    touch-action: none;
}
.dr-playback__thumb--active { transform: scale(1.25); }
.dr-playback__hover,
.dr-playback__window {
    position: absolute;
    top: -16px;
    font: 10.5px var(--mono);
    color: var(--muted-fg);
    pointer-events: none;
    white-space: nowrap;
}
.dr-playback__hover { transform: translateX(-50%); color: var(--fg); }
.dr-playback__window { right: 0; }
.dr-playback__rows {
    display: flex;
    flex-direction: column;
    max-height: min(40vh, 360px);
    overflow-y: auto;
    border-top: 1px solid var(--hair);
}
.dr-playback__row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    min-height: 30px;
    /* the rows box is a flex column with a max height, so a row would otherwise be shrunk to its
       min-height and its text would spill over the row below -- which the narrow layout always hit,
       because there the name is two lines (37px) and min-height is 30px */
    flex-shrink: 0;
    border-bottom: 1px solid var(--hair);
}
.dr-playback__row--busy { opacity: 0.5; pointer-events: none; }
.dr-playback__name {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    width: min(40%, 340px);
    min-width: 0;
}
.dr-playback__leading { width: 28px; flex: none; }
.dr-playback__label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 12px var(--mono);
    color: var(--muted-fg);
}
.dr-playback__row--active .dr-playback__label { color: var(--fg); }
.dr-playback__meta,
.dr-playback__count {
    flex: none;
    font: 11px var(--mono);
    color: var(--muted-fg);
    white-space: nowrap;
}
.dr-playback__row .dr-playback__lane { height: 22px; }
.dr-playback__ticks {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    color: var(--muted-fg);
}
.dr-playback__row--active .dr-playback__ticks { color: var(--primary); }
.dr-playback__cursor {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--primary);
    pointer-events: none;
}
@media (max-width: 700px) {
    .dr-playback__bar { flex-wrap: wrap; }
    .dr-playback__track { flex-basis: 100%; }
    /* the name gets its own line beside the switch; type (cut short if it must), count and menu go under it */
    .dr-playback__name {
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr) auto auto;
        column-gap: 6px;
        width: 50%;
        padding-block: 2px;
    }
    .dr-playback__name > :first-child { grid-row: 1 / 3; }
    .dr-playback__label { grid-column: 2 / 5; }
    .dr-playback__meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
}
`
