// The graph's ties to Desktop: the remembered layout (Desktop's UI setting `graphLayout`, else localStorage) and the
// report of what's on screen (`PUT /gateways/desktop/views/{app}`) agents read to see what the user sees.
import { useCallback, useEffect, useRef, useState } from "react"
import { type DesktopApiOptions, desktopJson } from "../comments/desktop.ts"
import { type LayoutId, LAYOUTS } from "./layout.ts"

/** Desktop's UI setting, and the localStorage key used outside Desktop (and kept in step inside it). */
export const GRAPH_LAYOUT_SETTING = "graphLayout"
export const GRAPH_LAYOUT_STORAGE_KEY = "dimos-react.graphLayout"

type KeyStore = Pick<Storage, "getItem" | "setItem">

export interface GraphLayoutOptions extends DesktopApiOptions {
    /** where it's kept outside Desktop (default localStorage) */
    storage?: KeyStore | null
}

export interface GraphLayoutSettingOptions extends GraphLayoutOptions {
    /** false: neither read nor written (a graph whose layout the app controls) */
    enabled?: boolean
}

export const isLayoutId = (value: unknown): value is LayoutId => LAYOUTS.some((layout) => layout.id === value)

const storageOf = (options: GraphLayoutOptions): KeyStore | null => {
    if (options.storage !== undefined) {
        return options.storage
    }
    try {
        return globalThis.localStorage ?? null
    } catch {
        return null
    }
}

/** The layout this browser last picked (null: none, or no storage). */
export function storedGraphLayout(options: GraphLayoutOptions = {}): LayoutId | null {
    try {
        const saved = storageOf(options)?.getItem(GRAPH_LAYOUT_STORAGE_KEY)
        return isLayoutId(saved) ? saved : null
    } catch {
        return null
    }
}

/** The remembered layout: Desktop's setting when it has one, else this browser's, else null. */
export async function loadGraphLayout(options: GraphLayoutOptions = {}): Promise<LayoutId | null> {
    try {
        const settings = await desktopJson<Record<string, unknown>>("/settings/ui", {}, options)
        const layout = settings?.[GRAPH_LAYOUT_SETTING]
        if (isLayoutId(layout)) {
            return layout
        }
    } catch {
        // no Desktop, or one without the setting
    }
    return storedGraphLayout(options)
}

/** Remember a layout: in this browser, and in Desktop's settings when it takes it. Where it was kept, Desktop first. */
export async function saveGraphLayout(
    layout: LayoutId,
    options: GraphLayoutOptions = {},
): Promise<"desktop" | "local"> {
    try {
        storageOf(options)?.setItem(GRAPH_LAYOUT_STORAGE_KEY, layout)
    } catch {
        // storage blocked or full
    }
    try {
        await desktopJson("/settings/ui", { method: "PUT", body: { [GRAPH_LAYOUT_SETTING]: layout } }, options)
        return "desktop"
    } catch {
        return "local"
    }
}

/**
 * The graph layout the user picked last (any graph, any app), and a setter that remembers a new pick. Starts from this
 * browser's copy (no flash of the default), then takes Desktop's.
 */
export function useGraphLayoutSetting(
    fallback: LayoutId = "hierarchy",
    options: GraphLayoutSettingOptions = {},
): [LayoutId, (layout: LayoutId) => void] {
    const enabled = options.enabled ?? true
    const [layout, setLayout] = useState<LayoutId>(() => (enabled && storedGraphLayout(options)) || fallback)
    const picked = useRef(false)
    useEffect(() => {
        if (!enabled) {
            return
        }
        let live = true
        loadGraphLayout(options).then((remembered) => {
            // a pick made while it loaded wins
            if (live && remembered && !picked.current) {
                setLayout(remembered)
            }
        })
        return () => {
            live = false
        }
    }, [options.base, enabled])
    const pick = useCallback((next: LayoutId) => {
        picked.current = true
        setLayout(next)
        if (enabled) {
            saveGraphLayout(next, options)
        }
    }, [options.base, options.storage, options.fetch, enabled])
    return [layout, pick]
}

/** A module on screen. */
export interface ViewModule {
    id: string
    label: string
}

/** A connection on screen: a module writing a topic another module reads. */
export interface ViewConnection {
    from: string
    to: string
    topic: string
}

/** What the user sees: the modules and connections on screen, what's selected, the layout. */
export interface GraphViewState {
    visible: { modules: ViewModule[]; connections: ViewConnection[] }
    selected: { kind: string; id: string } | null
    layout: LayoutId
}

/** Tell Desktop what an app's graph shows (agents read it with `get_view`). False when Desktop didn't take it. */
export async function putView(
    app: string,
    state: GraphViewState & { view?: string; blueprint?: string },
    options: DesktopApiOptions = {},
): Promise<boolean> {
    try {
        await desktopJson(
            `/views/${encodeURIComponent(app)}`,
            { method: "PUT", body: { view: "module-graph", ...state } },
            options,
        )
        return true
    } catch {
        return false
    }
}
