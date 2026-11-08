// The graph view (dimos-react/graph): a dotted grid that pans and zooms with the drawing, edges in the muted ink
// (or --dr-graph-edge, set per edge), a focused node's neighbourhood lit and the rest dimmed, and its controls.
export const GRAPH_CSS = /* css */ `
.dr-graph {
    position: relative;
    overflow: hidden;
    background-color: var(--bg);
    /* --dr-graph-dots: the dots' strength, set by zoom (they thin and fade out as you zoom out) */
    background-image: radial-gradient(circle, color-mix(in srgb, var(--muted-fg) var(--dr-graph-dots, 35%), transparent) 1.1px, transparent 1.4px);
}
.dr-graph > svg.graph { position: absolute; inset: 0; width: 100%; height: 100%; cursor: grab; user-select: none; }
.dr-graph > svg.graph.panning { cursor: grabbing; }
.dr-graph .edge {
    fill: none;
    stroke: color-mix(in srgb, var(--muted-fg) 88%, var(--fg));
    stroke-width: 1.6;
    opacity: 0.8;
}
.dr-graph .edge.lit, .dr-graph .edge.flow {
    opacity: 1;
    stroke: color-mix(in srgb, var(--dr-graph-edge, var(--muted-fg)) 70%, var(--muted-fg));
}
.dr-graph .edge.lit { stroke-width: 2.2; }
/* an edge with data moving along it */
.dr-graph .edge.flow { stroke-width: 2.6; stroke-dasharray: 7 5; animation: dr-graph-flow 0.8s linear infinite; }
@keyframes dr-graph-flow { to { stroke-dashoffset: -12; } }
.dr-graph .node:focus-visible { outline: none; }
/* a wide invisible stroke over each edge, so a right click finds it */
.dr-graph .edge-hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; }
/* a soft flash (GraphView's flash(), an agent's highlight): a glow that swells and fades, --dr-graph-flash-times times */
.dr-graph .node.flash { animation: 0.9s ease-in-out var(--dr-graph-flash-times, 2) both; }
.dr-graph .node.flash-0 { animation-name: dr-graph-flash-0; }
.dr-graph .node.flash-1 { animation-name: dr-graph-flash-1; }
.dr-graph .edge.flash { animation: 0.9s ease-in-out var(--dr-graph-flash-times, 2) both; }
.dr-graph .edge.flash-0 { animation-name: dr-graph-edge-flash-0; }
.dr-graph .edge.flash-1 { animation-name: dr-graph-edge-flash-1; }
@keyframes dr-graph-flash-0 { 0%, 100% { filter: none; } 50% { filter: drop-shadow(0 0 10px color-mix(in srgb, var(--primary) 90%, transparent)) brightness(1.22); } }
@keyframes dr-graph-flash-1 { 0%, 100% { filter: none; } 50% { filter: drop-shadow(0 0 10px color-mix(in srgb, var(--primary) 90%, transparent)) brightness(1.22); } }
@keyframes dr-graph-edge-flash-0 { 0%, 100% { stroke-width: 1.6; } 50% { stroke-width: 4.5; stroke: var(--primary); opacity: 1; } }
@keyframes dr-graph-edge-flash-1 { 0%, 100% { stroke-width: 1.6; } 50% { stroke-width: 4.5; stroke: var(--primary); opacity: 1; } }
.dr-graph--focus .node.flash, .dr-graph--focus .edge.flash { opacity: 1; }
.dr-graph--focus .node:not(.lit), .dr-graph--focus .edge:not(.lit) { opacity: 0.5; }
.dr-graph__zoom, .dr-graph__layouts { position: absolute; bottom: 12px; }
.dr-graph__zoom { left: 12px; }
.dr-graph__layouts { right: 12px; flex-wrap: wrap; max-width: calc(100% - 160px); }
/* <BlueprintGraph>: module and topic nodes, the fullscreen button, and the graph filling the window */
.dr-bpgraph { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: var(--bg); touch-action: pan-x pan-y; }
.dr-bpgraph > .dr-graph { position: absolute; inset: 0; }
.dr-bpgraph--overlay { position: fixed; inset: 0; z-index: 2147483000; }
.dr-bpgraph:fullscreen { width: 100vw; height: 100vh; }
/* top right: the search, then the fullscreen button */
.dr-bpgraph__top { position: absolute; top: 10px; right: 10px; display: flex; align-items: flex-start; gap: 6px; z-index: 2; pointer-events: none; }
.dr-bpgraph__top > * { pointer-events: auto; }
.dr-bpgraph__search { position: relative; transition: opacity 0.25s ease; }
.dr-bpgraph__search--hidden { opacity: 0; pointer-events: none; }
.dr-bpgraph__search .dr-search { width: 210px; }
.dr-bpgraph__search .dr-input { height: 30px; font-size: 13px; }
.dr-bpgraph__hits {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    width: max(100%, 240px);
    max-height: 300px;
    overflow-y: auto;
    padding: 4px;
    margin: 0;
    list-style: none;
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
}
.dr-bpgraph__hit {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    font: 13px var(--sans);
    color: var(--fg);
    cursor: pointer;
}
.dr-bpgraph__hit[aria-selected="true"] { background: var(--sel); }
.dr-bpgraph__hit-kind { flex: none; width: 3.2em; font: 600 9.5px var(--sans); letter-spacing: 0.12em; color: var(--primary); }
.dr-bpgraph__hit--topic .dr-bpgraph__hit-kind { color: var(--dr-bpgraph-type, var(--muted-fg)); }
.dr-bpgraph__hit--topic .dr-bpgraph__hit-name { font-family: var(--mono); font-size: 12px; }
.dr-bpgraph__hit-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr-bpgraph__hit-also { flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted-fg); font-size: 11.5px; }
.dr-bpgraph__nohit { padding: 6px 8px; font: 12.5px var(--sans); color: var(--muted-fg); }
/* comment badges on nodes and edges */
.dr-bpgraph .comment-badge { cursor: pointer; }
.dr-bpgraph .comment-badge circle { fill: var(--primary); stroke: var(--bg); stroke-width: 2; }
.dr-bpgraph .comment-badge text { fill: var(--primary-fg); font: 700 10px var(--sans); text-anchor: middle; dominant-baseline: central; }
.dr-bpgraph .comment-badge:hover circle { filter: brightness(1.15); }
.dr-bpgraph__empty { display: grid; place-items: center; height: 100%; min-height: 80px; color: var(--muted-fg); font: 13px var(--sans); }
.dr-bpgraph .node text { dominant-baseline: central; }
.dr-bpgraph .node.module { cursor: pointer; }
/* a module is a raised card: the graph's own --bg a step lighter (darker in a light skin), same hue and chroma, so it
   never drifts warmer or cooler than the canvas; topics stay on the graph's background */
.dr-bpgraph { --dr-step: 1; }
:root:not([data-dr-dark]) .dr-bpgraph { --dr-step: -0.6; }
.dr-bpgraph .node.module .box {
    fill: var(--surface);
    fill: oklch(from var(--bg) calc(l + 0.06 * var(--dr-step)) c h);
    stroke: var(--border-strong);
    stroke-width: 1.5;
}
.dr-bpgraph .node.module:is(:hover, :focus-visible, .lit) .box { stroke: var(--primary); }
.dr-bpgraph .node.module :is(.bar, .tag) { fill: var(--primary); stroke: none; }
.dr-bpgraph .node.module .tag { font: 600 9.5px var(--sans); letter-spacing: 0.18em; }
.dr-bpgraph .node.module .name { fill: var(--fg); font: 600 15px var(--sans); }
.dr-bpgraph .node.module .more { fill: var(--muted-fg); font: 16px var(--sans); text-anchor: middle; }
.dr-bpgraph .node.topic .box { fill: var(--bg); stroke: color-mix(in srgb, var(--dr-bpgraph-type, var(--muted-fg)) 60%, transparent); stroke-width: 1.3; }
.dr-bpgraph .node.topic:is(.loose, .extra):not(:hover) .box { stroke: var(--border-strong); stroke-dasharray: 4 3; }
.dr-bpgraph .node.topic.live .box { stroke: var(--dr-bpgraph-type, var(--muted-fg)); }
.dr-bpgraph__view--running .node.topic:not(.live) { opacity: 0.85; }
.dr-bpgraph .node.topic .name { fill: var(--fg); font: 500 12px var(--mono); }
.dr-bpgraph .node.topic .rate { fill: var(--dr-bpgraph-type, var(--muted-fg)); font: 10px var(--mono); }
.dr-bpgraph .node .port { fill: var(--bg); stroke: var(--muted-fg); }
`
