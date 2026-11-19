// JsonView (a JSON value for people) and JsonLine (one colored line). Tokens only.
export const JSON_VIEW_CSS = /* css */ `
/* JsonView: no braces or quotes */
.dr-json {
    font-size: 12px;
    color: var(--fg);
    min-width: 0;
}
.dr-json-str {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
.dr-json-num {
    font-family: var(--mono);
    color: var(--code-num, var(--warn));
}
.dr-json-true { color: var(--ok); }
.dr-json-false { color: var(--danger); }
.dr-json-empty {
    color: var(--muted-fg);
    font-style: italic;
}
.dr-json-table {
    display: inline-grid;
    grid-template-columns: max-content minmax(0, auto);
    gap: 2px 12px;
    text-align: left;
    align-items: baseline;
    max-width: 100%;
}
.dr-json-key {
    color: var(--muted-fg);
    font-size: 10.5px;
}
.dr-json-value { min-width: 0; }
.dr-json-value > .dr-json-table {
    padding-left: 8px;
    border-left: 1px solid var(--hair);
}
.dr-json-list {
    margin: 0;
    padding: 0;
    list-style: none;
    max-width: 100%;
}
/* fits on one line: items side by side, each in a soft chip */
.dr-json-inline {
    display: inline-flex;
    flex-wrap: nowrap;
    gap: 4px;
    overflow: hidden;
    vertical-align: top;
}
.dr-json-inline > .dr-json-item {
    flex: none;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--hover);
}
/* too wide: one item per line, numbered */
.dr-json-column {
    display: inline-flex;
    flex-direction: column;
    text-align: left;
    counter-reset: dr-json;
}
.dr-json-column > .dr-json-item {
    display: grid;
    grid-template-columns: 20px minmax(0, auto);
    counter-increment: dr-json;
}
.dr-json-column > .dr-json-item::before {
    content: counter(dr-json);
    color: var(--muted-fg);
    font-family: var(--mono);
    font-size: 10px;
}

/* JsonLine */
.dr-json-line {
    font-family: var(--mono);
    white-space: nowrap;
}
.dr-jl-key { color: var(--code-loc, var(--info)); }
.dr-jl-str { color: var(--code-str); }
.dr-jl-num { color: var(--code-num); }
.dr-jl-bool { color: var(--code-kw); }
.dr-jl-null {
    color: var(--code-com, var(--muted-fg));
    font-style: italic;
}
.dr-jl-punct { color: var(--muted-fg); }
`
