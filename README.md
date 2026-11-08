# dimos-react

React UI toolkit for [dimOS Desktop](https://github.com/dimensionalOS/dimos-desktop) apps: themed components that follow
Desktop's skin live, URL state the backend can drive, zenoh data hooks, and a generic three.js 3D view (TF, point
clouds, paths, poses, robot models).

TypeScript + TSX. No-build pages import the source straight from a GitHub tag through esm.sh (it compiles the .ts/.tsx);
bundlers can use the Vite build (`dist/`, with `.d.ts` types). React, react-dom and three are peer dependencies — never
bundled — so the library and your app share one copy.

## Quick start

```html
<script type="importmap">
    {
        "imports": {
            "react": "https://esm.sh/react@19.2.0",
            "react/": "https://esm.sh/react@19.2.0/",
            "react-dom": "https://esm.sh/react-dom@19.2.0",
            "react-dom/": "https://esm.sh/react-dom@19.2.0/",
            "three": "https://esm.sh/three@0.180.0",
            "three/": "https://esm.sh/three@0.180.0/",
            "dimos-react": "https://esm.sh/gh/jeff-hykin/dimos-react@v0.2.0/src/index.ts?external=react,react-dom,three",
            "dimos-react/three": "https://esm.sh/gh/jeff-hykin/dimos-react@v0.2.0/src/three.ts?external=react,react-dom,three"
        }
    }
</script>
<div id="root"></div>
<script type="module" src="./main.js"></script>
```

```tsx
// main.tsx (a Vite / TSX app; a no-build page writes the same with React's createElement)
import { createRoot } from "react-dom/client"
import { AppProvider, Button, Card, Toggle, TopBar, useToast, useUrlState } from "dimos-react"

function App() {
    const toast = useToast()
    const [tab, setTab] = useUrlState("tab", "overview")
    const [follow, setFollow] = useUrlState("follow", true, { codec: "boolean" })
    return (
        <div>
            <TopBar title="My app" icon="robot" />
            <Card title={tab}>
                <Toggle value={follow} onChange={setFollow} label="Follow robot" />
                <Button
                    variant="primary"
                    onClick={() => {
                        setTab("map")
                        toast.ok("Switched")
                    }}
                >
                    Show map
                </Button>
            </Card>
        </div>
    )
}

createRoot(document.getElementById("root")!).render(
    <AppProvider>
        <App />
    </AppProvider>,
)
```

`h` (React's `createElement`) is no longer exported (v0.2): a no-build app imports it from React,
`import { createElement as h } from "react"`.

`AppProvider` = `DimThemeProvider` (Desktop's skin, live) + the data source (Desktop's zenoh-gateway) +
`UrlStateProvider` (backend url events) + toasts + confirm/prompt dialogs. Each also works on its own.

The demo / storybook renders every component: `deno task dev`, then open the printed URL (`?skin=research`,
`?skin=vibeslop`, … picks a skin; `?section=scene` one section). `deno task build:demo` writes it as one self-contained
file, `dist-demo/index.html`.

## Theme

Desktop serves every skin's tokens at `/theme.css` and saves the user's choice in localStorage (`portal.theme`,
`portal.corners`). `<DimThemeProvider>` links that stylesheet when the page is a Desktop app (`/apps/<name>/`), sets
`html[data-skin]` / `html[data-corners]`, and follows every change live (Settings → Appearance in Desktop reaches every
open app through the `storage` event). Off Desktop it uses a bundled copy of the tokens (`src/theme/tokens.ts`,
regenerated with `deno task sync-tokens`).

```tsx
<DimThemeProvider><App /></DimThemeProvider> // Desktop's skin, followed live
<DimThemeProvider skin="research"><App /></DimThemeProvider> // pinned (screenshots, demos)
const { skin, dark, corners, colors } = useTheme() // colors: --primary, --scene-bg, … for canvases / 3D
```

Every component is styled only with Desktop's tokens (`var(--primary)`, `var(--radius)`, `color-mix()` of tokens: no
color literals, checked by `test/theme.test.ts`), with light rules plus `:root[data-dr-dark]` rules for dark skins, so
an app looks like Desktop in every skin. Your own CSS can use the same tokens. `--dim-inset-bottom` etc. say how much of
the page Desktop's dock covers.

## Components

All take `className`, `style` and DOM props; controls take `value` + `onChange(value)` (the value, not the event).

| Group         | Components                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buttons       | `Button` (variant default/primary/ghost/danger/ok/warn, size, icon, pressed, loading, `href` = a link), `IconButton`, `HoldButton` (acts while held), `Fab` (round floating action: tone, active, attention pulse/glow/spin), `CopyButton`, `ButtonGroup`                                                                                                                                |
| Forms         | `Field`, `TextInput` (`onCommit`: report on Enter / blur), `NumberInput` (`nullable`), `TextArea`, `SearchInput`, `Select`, `Checkbox`, `Toggle` (`Switch`), `Radio`, `RadioGroup`, `Slider`, `RangeSlider`, `AngleDial`, `ColorSwatch`, `FileDrop`, `SettingInput` / `SettingChoice` / `SettingRow` / `SettingGroup` / `SettingSection` (a settings form)                                                                                                                                      |
| Status        | `Badge`, `Chip`, `TagList` (read-only tags; `oneLine`: then "+N"), `StatusDot`, `ConnectionStatus`, `Kbd` (`pressed`), `KeyHints`, `Spinner`, `Progress`, `ProgressRing`, `Skeleton`                                                                                                                                                                                                     |
| Feedback      | `Alert`, `toast()` / `useToast()` / `ToastProvider`, `Modal` (`size` sm/md/lg/xl), `useConfirm()`, `usePrompt()` (`DialogProvider`), `EmptyState`, `ErrorBoundary`                                                                                                                                                                                                                                            |
| Layout        | `AppShell` (`insetBottom`: end above Desktop's dock), `TopBar`, `Toolbar`, `BottomBar`, `Card`, `Tile` + `TileGrid` (a picker's selectable cards), `Panel` (collapsible, glass), `FloatingPanel` (draggable), `ResizeHandle`, `SplitPane`, `Hud`, `Embed` (an iframe filling its parent), `Disclosure` (a folding section under a label, `persistKey`), `Row`, `Column`, `Spacer`, `Separator`, `Heading`, `Label`, `Text`, `Link`, `Icon` (+ `ICONS`) |
| Navigation    | `Tabs`, `Segmented` (`vertical`), `Menu` (items' `data-*`/`aria-*` reach their buttons), `MenuList`, `ContextMenu`, `MenuAt` (a menu at a point), `Popover`, `Tooltip`, `Sidebar`, `NavRail`, `Stepper` (or each step's own `state`, incl. failed), `Breadcrumbs`, `CommandPalette` (`useCommandPalette`)                                                                                |
| Data          | `Table` (sortable; `sortRows: false` when a backend sorts), `Tree`, `List`, `ListRow`, `KeyValue`, `KeyValueRow`, `Stat`, `LogView`, `StructuredLog`, `Traceback`, `CodeBlock` (`highlightLine`, `fill`, `header={false}`), `TopicRates`, `Sparkline`, `AttitudeIndicator`, `Timeline` (scrubber), `MediaFrame` (+ `captureFrame`), `SafeHtml` (a server's HTML, sanitized)                                                                                                      |
| Input devices | `Joystick`, `StickIndicator`, `DPad`                                                                                                                                                                                                                                                                                                                                                     |
| Hooks         | `copyText` (http-safe clipboard), `usePersistentState`, `useHotkeys`, `useHeldKeys`, `useEscape`, `useMobile`, `useMediaQuery`, `useDrag`, `useNow`, `useGamepad`                                                                                                                                                                                                                        |

## Developer panels (logs, tracebacks, settings, topics)

The parts of a view onto a running dimOS (the gateway's blueprint view is built from them):

- `StructuredLog` — structlog-style records (`{ timestamp, level, logger, event, extra }`): time, level, logger and
  event, short fields as chips, multi-line ones below, a traceback in `extra` (`traceback_lines`, or an `exception`
  that is one) drawn by `Traceback`. `follow` / `onFollowChange` keep the newest in view (scrolling up or opening
  folded frames turns it off); `level` / `onLevelChange`, `query` / `onQueryChange` add a level picker and a search
  (the filtering is yours, e.g. the server's); `note` ("loading…", an error), `banner`. `LOG_LEVELS`, `splitRecord`.
- `Traceback({ text, onOpenFile, formatPath })` — a Python traceback (plain, chained, exception groups) frame by frame:
  your own frames are buttons that open in an editor, each run of library frames folds, and what was raised is summed
  up with the innermost in bold. `parseTraceback`, `exceptionsOf`, `isTraceback` without the DOM.
- Settings — `SettingInput({ field, value, onChange })` takes a `field` `{ name, kind, nullable, options,
  optionLabels, secret, placeholder }` and draws its kind's control: bool → Toggle, enum → Select, integer / number /
  string / path / json → a box that reports on Enter or blur, parsed by kind ("needs a number" when it doesn't parse),
  a secret → a password box with show / hide. `SettingRow` (name, "saved", reset, a docs link; `wide`),
  `SettingGroup` (bordered, with a saved count; `accent`), `SettingSection` (`highlight` for the ones to decide first),
  `SettingChoice` (a Segmented for up to four named choices, a Select past that). Kinds come from a JSON schema
  (`resolveSchema`, `schemaKind`, `schemaNullable`) or a Python annotation (`pythonTypeKind`); `parseSettingText`,
  `settingText`, `settingLabel`, `sameValue`.
- `TopicRates({ rows })` — topics with their Hz and bandwidth, each in its message type's color, hot cells tinted
  (`heatStyle`), quiet rows dim. `messageTypeColor(type)` (`var(--warn)` for images, …), `messageTypeName`,
  `formatRate`, `formatBandwidth`.
- Framed by Desktop — `framedByDesktop()`, `toDesktop(message)`, `useDesktopMessage(type, handler)`,
  `useDesktopChrome()` (whether to draw your own top bar), `useDesktopEditor()` (`open(file, line)` in the user's
  editor, and its answer for `EditorNote`).

## Live data (zenoh)

Hooks and 3D layers read through a _data source_. By default it is the page's one zenoh-gateway connection (dim-app's
`getZenoh()`); `DataSourceProvider` swaps in another (`memorySource()` for tests, demos and replays).

```js
const { value: odom } = useTopic("dimos/odom/nav_msgs.Odometry", { maxHz: 10 })   // decoded LCM
const topics = useTopicList()                         // [{ key, name: "/odom", type: "nav_msgs.Odometry" }]
const state = useConnectionState()                    // connecting | connected | degraded | lost
useBackendEvents((event) => { ... })                  // the app backend's `events` frontend topic
const [recordings, { loading, refresh }] = useBackendState("recordings")   // GET api/state/recordings, live
```

## URL state

The URL is the UI's state: back/forward, reloads and shared links reproduce the same screen, and **the backend drives
the UI by changing the URL**. The backend publishes a url event on its `events` frontend topic (dim-app's
`publishEvent`); `UrlStateProvider` (in `AppProvider`) applies it with `history.pushState`; components render from the
URL with `useUrlState`.

```js
// backend (dim-app): publishEvent({ type: "url", set: { recording: "run3", t: 12.5 } })
//   set: params to merge (null removes one) · replace: true → replaceState · clear: true → drop the other params

const [recording, setRecording] = useUrlState("recording") // string | undefined
const [t, setT] = useUrlState("t", 0, { codec: "number", replace: true }) // codec: string|number|boolean|json
const [params, setParams] = useUrlParams() // all of them
```

`test/url_state.test.ts` proves the round trip: a backend event → the URL → the rendered UI, then back/forward and a
fresh deep link reproduce the same UI. Without React: `createUrlStore()`, `bindUrlEvents(source, store)`. `mode: "hash"`
keeps params in `#a=1&b=2` instead of the query string.

## Media (camera views, playback)

`ImageView` draws the latest frame of an image topic (`sensor_msgs.Image`, `CompressedImage`, or a source's pre-decoded
`{ kind: "image" | "depth", width, height, encoding, data }` frames; pass `encoding` for a source that delivers those)
or a `frame` prop. Depth (16UC1 / 32FC1) goes through a colormap (`colormap`, `near` / `far` in meters, null = auto);
`overlayTopic` draws `vision_msgs.Detection2DArray` boxes over it; `onInfo` reports size, fps, quality.

```tsx
<ImageView topic="dimos/color_image/sensor_msgs.Image" style={{ height: 240 }} />
<ImageView topic="dimos/depth/sensor_msgs.Image" colormap="magma" near={0.3} far={6} />
```

`PlaybackBar` is a recording player's bar: play / pause, time, speed, loop, a scrubber that zooms (ctrl/⌘ + wheel) and
pans, and expanded, a lane per stream with a tick per message
(`lanes: [{ id, label, meta, count, leading, menu,
active, ticks: { times } | { counts } }]`). `onScrubStart` /
`onSeek(t)` / `onScrubEnd` while dragging; `keyboard` adds space / ← → / Home / End. The colormaps (`RAMPS`,
`sampleGradient`) come without three.js from the main entry.

## View panels, driving input, cameras

- `ViewPanel` — a view's chrome: `placement` "float" (header drag via `onMove(x, y)`, corner `resize` with optional
  `aspect`), "dock" (`dock: { region, rect, maximized, onMaximize, tiles? }`: a layout places it, a maximize button,
  dragging a tile's header onto another swaps them) or "main" (fills its parent). Helpers: `clampPanelBox`, `swapTiles`,
  `startPanelDrag`, `startPanelResize`, `PanelInfo` (a header readout), class `dr-view-panel-title`.
- `Map2D` (from `dimos-react/three`) — a top-down 2D map filling its parent: `topic` (OccupancyGrid, or a PointCloud2 as a height
  heatmap), `overlay` (a costmap over it), `path` (a nav_msgs.Path key), the robot arrow + trail at `robotFrame`, axes,
  grid, scale bar; wheel/pinch zoom, drag pan, follows `followFrame` until a pan; `onPick({ x, y, frame })` on a click
  (e.g. a goal); `onView` / `view` to remember the view; `onMap(renderer)` for `recenter()` / `fit()`. Placed through
  `tf`. Helpers: `mapCandidates`, `chooseMapTopic`, `chooseOverlay`, `overlayCandidates`, `followFrameOptions`.
- `ThumbStick` — a phone thumb stick: the stick centers where the thumb lands, `axes` "xy" | "x" | "y", dead zone + expo
  (`shapeStick`) and easing (`smoothToward`), zeroed at once on any release; `releaseAllThumbSticks()` for STOP.
  `KeyPad` / `KeyCap` show keyboard keys lit while held.
- Cameras: `CameraView({ topic, overlay, fill, depthLook, onInfo })` draws a camera topic: on Desktop's gateway a color
  topic is its H.264 video track at this viewer's latency ↔ quality preset (`useVideoQuality(topic)`, `VIDEO_PRESETS`,
  changed in place), depth and replayed frames go through `ImageView`; optional 2D detection overlay. `CameraTabs`,
  `CameraStreams` / `CameraStreamsProvider` (shared, counted subscriptions; `element()` gives a `<video>` for textures),
  `cameraTabs`, `pickCamera`, `retargetCameras`, `cameraInfoFor`. The `dimos-react/three` entry adds `DepthMaterial` (the depth
  colormap as a three.js material, for a camera's 3D projection).

## 3D view (three.js)

The 3D view is its own entry, `dimos-react/three` (`src/three.ts`), so apps without one never load three. It is the Controller's view made
generic: a Z-up (ROS) scene in a fixed frame, orbit/pan/zoom (mouse: left-drag orbit, right- or shift-drag pan, wheel
zoom; touch: one finger orbit, two fingers pan and pinch zoom), a smoothed follow camera, TF streaming, and layers for
point clouds, paths, poses and stand-in robot models. Layers take data **from a topic** (through the data source: live
zenoh-gateway by default, or a replay / test source via `DataSourceProvider`) **or from props**.

```tsx
import { Path, PointCloud, Pose, RobotModel, Scene3D, SceneControls, SceneStats, TfFeed, TfFrames } from "dimos-react/three"

// live, from topics: dimos/<topic>/<msg type> keys on Desktop's zenoh-gateway
<Scene3D followFrame="base_link" style={{ height: "100vh" }}>
    <TfFeed /> {/* every tf2_msgs.TFMessage topic → the TF tree */}
    <TfFrames axesSize={0.25} /> {/* axes + names + parent links */}
    <PointCloud topic="dimos/lidar/sensor_msgs.PointCloud2" style="voxel" size={0.05} />
    <PointCloud topic="dimos/global_map/sensor_msgs.PointCloud2" mode="accumulate" size={0.1} />
    <Path topic="dimos/path/nav_msgs.Path" />
    <Pose topic="dimos/odom/nav_msgs.Odometry" trail />
    <RobotModel kind="dog" frame="base_link" /> {/* dog | humanoid | wheeled | drone | arrow */}
    <SceneControls /> {/* frame-all, top-down, resume-follow buttons (onFrameAll / onTopDown override) */}
    <SceneStats /> {/* fps · points · frame ms · latency */}
</Scene3D>
```

From props (a replay, a file, computed data): the same layers, no topic.

```tsx
<Scene3D fixedFrame="world" style={{ height: 480 }}>
    <TfFeed transforms={[{ parent: "world", child: "base_link", translation: [1, 2, 0], rotation: [0, 0, 0, 1] }]} />
    <PointCloud points={float32xyz} intensity={uint8} frame="world" colorMode="intensity" gradient="turbo" />
    <Path poses={[[0, 0, 0], [1, 0, 0], [2, 1, 0]]} frame="world" color="var(--ok)" />
    <Pose pose={{ x: 1, y: 2, yaw: 0.5 }} frame="world" />
    <PoseArray poses={waypoints} frame="world" />
    <RobotModel kind="wheeled" pose={{ x: 1, y: 2, yaw: 0.5 }} poseFrame="world" />
</Scene3D>
```

A replay app can also keep the topic props and feed its own source: `memorySource()` + `DataSourceProvider`, then
`source.publish(key, lcmBytes)` (or `publish(key, { positions, intensity, frame })` for clouds).

**Scene3D props**: `fixedFrame` (default: the TF tree's world/map/odom root), `followFrame` (a TF frame the camera
follows; orbit and zoom keep following, a pan pauses it until `viewer.resumeFollow()`), `grid`,
`onPick({ point, on,
event })` (click → nearest cloud point / mesh / ground point), `cameraPosition`, `cameraTarget`,
`tf` (bring your own `TfTree`, e.g. to share it with a `FramePicker` outside the scene), `onViewer(viewer)`. DOM
children are laid over the canvas (use `className="dr-scene-overlay"` and position them).

**Layer props**: `PointCloud` — `topic` | `points` (+ `intensity`, `frame`), `mode` latest|accumulate, `windowSeconds`,
`maxPoints`, look: `style` voxel|disc|square|splat, `size` (m), `colorMode` height|intensity|range| solid, `gradient`
(memworld, turbo, viridis, magma, plasma, ice, sunset, grayscale) or a repeating palette (aurora, ember, rose: one
up-and-back cycle every `period` meters, so floors read apart), `axis`, `rangeMin/Max`, `color`, `opacity`. `Path` —
`topic` | `poses` (+ `frame`), `color`, `width` (px), `lift`. `Pose` — `topic` (Odometry / PoseStamped /
PoseWithCovarianceStamped) | `pose` (+ `frame`), `axesSize`, `trail`, `trailLength`, `jumpMeters`,
`onPose(matrixInFixedFrame)`. Colors accept any CSS color or a theme token (`"var(--primary)"`); axes use the theme's
`--axis-x/y/z`. Every layer takes `onStatus({ info, problem, frame })` (e.g. "no TF path from lidar to world") and
`onTop` (default off): drawn over everything else, so walls and voxels in front never hide it, instead of sitting in
the scene depth-tested. It switches live (no re-created layer, no resubscribe): the layer's objects move to a second
render pass drawn after the depth buffer is cleared (`viewer.setOnTop(object, on)`, three.js layer channel
`ON_TOP_CHANNEL`; on-top objects still hide each other). A `<Layer>` takes it in `settings` like any type's own.

Viewer options (Scene3D props, read once): `near`, `far`, `fov` (a small model like a URDF wants `near: 0.001`),
`gridSize` (m) / `gridDivisions`, `freeOrbit` (orbit below the ground too). `<KeyboardFly speed lookSpeed />`
inside a Scene3D adds keyboard flying: W/A/S/D over the ground, Q/E down/up, I/J/K/L look around. `viewer.capture()`
returns the view as a PNG data URL.

`GradientPicker` picks a point-cloud gradient (`GRADIENTS`).

**Hooks**: `useViewer()`, `useTf()`, `useFixedFrame()`, `useScene()`, `useSceneFrame(fn)` (per animation frame),
`useTfFrames()` (frame names, throttled), and `FramePicker` (a Select of TF frames).

**Custom layers** with `useLayer(create, deps)`: `create({ viewer, tf })` returns
`{ root, update?(frame), dispose?() }`; `root` is added to the scene, `update` runs every frame
(`frame = { now, fixedFrame, camera }`). Push new data into the returned ref from your own effects rather than
re-creating the layer.

```tsx
function Marker({ frame, color = "var(--warn)" }: { frame: string; color?: string }) {
    useLayer(({ viewer, tf }) => {
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.2),
            new THREE.MeshLambertMaterial({ color: cssColor(color) }),
        )
        mesh.matrixAutoUpdate = false
        return {
            root: mesh,
            update: ({ fixedFrame }) => placeInFixedFrame(viewer, tf, mesh, frame, fixedFrame),
            dispose: () => disposeTree(mesh),
        }
    }, [frame, color])
    return null
}
```

**Viewer API** (`useViewer()`, or `new Viewer(element)` without React): `scene`, `camera`, `controls` (OrbitControls),
`renderer`, `fixedFrame`, `requestRender()`, `noteData(timestampMs)`, `onFrame(fn)`, `pick(clientX, clientY)`,
`frame(target, distance)`, `frameAll()`, `topDown(target, extent)`, `dataBounds()`, `pauseFollow()` / `resumeFollow()`,
`followPaused` and `stats` (stores: `{ fps, frameMs, latencyP50, latencyP95, drawCalls, points }`), `setTheme()`,
`setGrid(visible)`, `setOnTop(object, on)` (draw an object of your own over the scene; a raycaster of your own
needs `raycaster.layers.enable(ON_TOP_CHANNEL)` to hit it), `capture(type?)`, `paused` (a hidden view draws nothing until unpaused), `dispose()`. Point
materials of your own: `makePointMaterial(viewer.pixelsPerMeter)`, `applyLook(material, look, range)`,
`setClipBox(material, min, max)` (draw only inside a box). `TfTree` (pure, no DOM):
`set(parent, child, xyz, quat, isStatic)`, `setMessage(tfMessage)`, `lookup(frame, fixed)` → `Matrix4 | null`,
`defaultFixedFrame()`, `frames()`, `snapshot()` (with problems: double parents, several roots, cycles, stale edges),
`onChange(fn)`.

### Topic layers (every topic, by type)

The Controller's layer list, generic: a `LayerManager` watches the data source's topics and makes an entry per topic
some **layer type** draws; `<TopicLayers>` (in the scene) runs the switched-on ones, `<LayersPanel>` (anywhere) switches
them and edits each one's settings (every row's settings start with "Draw on top", the common `onTop`). Built-in types: `pointcloud` (PointCloud2, with this viewer's bandwidth preset),
`pose` (Odometry / PoseStamped / PoseWithCovarianceStamped + trail, and the whole route when the source knows it),
`path`, `posearray`, `graph` (LineSegments3D), `marker` (Marker / MarkerArray: every RViz type but meshes), `boxes3d`
(Detection3DArray / BoundingBox3DArray), `labeled-points` (EntityMarkers / PointStamped), `occupancy` (OccupancyGrid:
costmap floor plan or gray map), `tf` (TFMessage) and `camera3d` (Image / CompressedImage frustum with the picture,
depth as a heat map; off by default). A 2D overlay type, `detection2d`, draws Detection2DArray boxes over camera images
(`overlayTypeFor(type).draw(ctx, message, image)`).

```tsx
import {
    FrameHighlight,
    LayersPanel,
    RobotModel,
    Scene3D,
    SceneControls,
    TfFeed,
    TfFootnote,
    TfPanel,
    TfTree,
    TopicLayers,
    useLayerManager,
    useTfIssues,
} from "dimos-react/three"

function View() {
    const layers = useLayerManager() // which topics are on + each one's settings persist (localStorage, or `persist`)
    const tf = useMemo(() => new TfTree(), []) // shared by the scene and the TF panel
    const [hovered, setHovered] = useState<string | null>(null)
    const issues = useTfIssues({ tf, layers: () => layers.layerFrames() })
    return (
        <Row>
            <Scene3D tf={tf} followFrame="base_link" style={{ height: 600, flex: 1 }}>
                <TfFeed />
                <TopicLayers manager={layers} />
                <RobotModel kind="dog" />
                <FrameHighlight frame={hovered} />
                <TfFootnote issues={issues} />
                <SceneControls />
            </Scene3D>
            <Column>
                <LayersPanel manager={layers} />
                <TfPanel tf={tf} issues={issues} onHover={setHovered} />
            </Column>
        </Row>
    )
}
```

A single typed layer is `<Layer type="occupancy" topic="dimos/costmap/nav_msgs.OccupancyGrid" settings={settings} />`. Your
own type: `registerLayer({ id, label, types, defaults, create(context, topic, settings), Settings })` (see
`src/three/layers/registry.ts`; a later registration with the same id replaces a built-in one).

**Replays.** `memorySource({ clock: () => playheadMs, route })` makes the playhead the data clock: point-cloud windows
fade, marker lifetimes run and TF goes stale by it (a paused replay doesn't age). Call `source.seek()` when the playhead
jumps (seek, scrub, loop): every layer resets (accumulated maps start over, markers clear, a pose trail is rebuilt from
`route(key)` — `{ frame, points: [tSeconds, x, y, z][] }` — up to the playhead). Publish LCM bytes or decoded values;
images may be `{ kind: "image" | "depth", width, height, encoding, data }` frames, a decoded Image / CompressedImage, or
their LCM bytes.

**Scene extras**: `Scene3D` also takes `follow` + `onFollowChange` (following on/off; `useSceneActions().recenter()`
turns it back on), `robotFrame` (framed once on arrival; a Pose layer's pose stands in while it isn't in TF),
`viewDistance`, `layerOptions: { baseFrame, cameraInfo: { [imageTopicName]: infoTopicName } }`. `useScene().frameInfo`
is a store of `{ fixedFrame, robotFound, followFound, following }`. `SceneControls` = follow / top-down (around the
robot) / frame-all; `SceneStats({ detailed: true, rttMs })` = the full numbers. `RenderingSettings`, `StylePicker`,
`CubeShadePicker` and `PointLookEditor` edit point looks (the page-wide default style lives in the `rendering` store;
splats that can't keep up fall back to cubes, `splatFallback`).

**Cameras**: the `camera3d` layer shares CameraStreams (`dimos-react`'s cameras) with every CameraView of the same
topic; a replay source may publish frames (`{ kind, width, height, encoding, data }`, jpeg/png/webp or raw), decoded
Image / CompressedImage values or their LCM bytes, and CameraStreams decodes them.

## Graph view

`dimos-react/graph` lays out a directed graph of boxes (hierarchy, vertical, force, radial, circular) and draws it as a
pannable, zoomable SVG. You size the nodes and draw their contents; it places them without overlap and draws the edges.
`layout(id, nodes, edges)` alone (no DOM) gives each node's centre and, for the layered layouts, each edge's bends.

```tsx
import { GraphView } from "dimos-react/graph"

<GraphView
    nodes={[{ id: "a", w: 80, h: 30 }, { id: "b", w: 80, h: 30 }]}
    edges={[{ from: "a", to: "b" }]}
    layout="hierarchy"
    renderNode={(node) => <text x={8} y={node.h / 2}>{node.id}</text>}
    onNodeClick={(node) => console.log(node.id)}
/>
```

It draws on a dotted grid that pans and zooms with the graph; edges and nodes carry the classes `edge` / `node` plus
yours (an edge with class `flow` animates, `--dr-graph-edge` colors a lit or flowing edge). `focus` (a node id) lights
that node, its neighbours and the edges between them and dims the rest. `GraphControls({ graph, layout,
onLayoutChange })`, as a child, adds the zoom buttons and the layout picker.

`<BlueprintGraph modules={blueprint.modules} />` draws a dimos blueprint's module graph straight from the gateway's
`GET blueprints/{name}` answer (modules, the topics they write and read, tinted by message type), with the controls and
a Fullscreen button (the Fullscreen API, or a full-window overlay where it's refused; Esc leaves both). `rates` (Hz per
topic) shows live topics flowing; `spot`, `onModule`, `onTopic` and `onHover` let a page drive the lighting.

Uncontrolled, it starts on the layout the user picked last (`useGraphLayoutSetting()`: Desktop's UI setting
`graphLayout`, else localStorage). A search box (top right; a magnifier on narrow screens) shows while the pointer moves
and finds modules and topics. A ref adds `highlight(kind, id, times = 2)`, a soft flash; with `app="<desktop app>"` it
also flashes what Desktop's `view-highlight` events name, and nodes and edges take comments (right click / long press →
Comment, a badge where some are open, a thread with replies and Resolve; `commentSource(target)` attaches source code for
the agent; `blueprintCommentSource(modules, read)` makes one that sends the module's Python class). `onViewChange({ visible: { modules, connections }, selected, layout })` reports what's on screen (debounced);
`putView(app, state)` sends it to Desktop for agents.

`dimos-react/comments` is that comment kit for any app: `commentsClient()` (list / create / reply / resolve / subscribe
against `/gateways/desktop/comments`, quietly empty on a Desktop without them), `useComments(app, filter)`,
`<CommentComposer>`, `<CommentThread>`, `<CommentBadge>`, and `desktopEvents(onEvent)` for Desktop's event stream.

## Installing

- **No build (import map / esm.sh)** — the main path, as in the quick start:
  `https://esm.sh/gh/jeff-hykin/dimos-react@vX.Y.Z/src/index.ts` and `.../src/three.ts`, with
  `?external=react,react-dom,three` so your page's React and three are used. esm.sh compiles the TypeScript / TSX from
  the tag (types stripped, JSX through `react/jsx-runtime`, which the `react/` import-map entry covers). The source
  stays importable this way: every relative import names its file with its extension, and nothing relies on a bundler
  (`test/imports.test.ts` checks both).
- **Deno / vendored source**: Deno runs and type-checks the `.ts`/`.tsx` source as-is (copy `src/` in, map `react`,
  `react-dom` and `three` in your import map; `deno check` wants `@types/react` and `@types/three` for the types).
- **JSR (Deno, or Vite / npm through JSR's npm mirror)**: `deno add jsr:@robotics/dimos-react`, or
  `npx jsr add @robotics/dimos-react` (`import { AppProvider } from "@robotics/dimos-react"`,
  `import { Scene3D } from "@robotics/dimos-react/three"`). JSR ships the TypeScript source with its types; react,
  react-dom and three come from your app. Have `@types/react` (and `@types/three` for the 3D entry).

## Development

```sh
deno task dev         # the demo / storybook, live
deno task test        # vitest: theme tokens, URL-state round trip (happy-dom), TF math, TF check, layer list, replay clock, the export list
deno task check       # deno check, strict
deno task lint        # deno lint + deno fmt --check (deno task fmt fixes)
deno task build:demo  # dist-demo/index.html, the demo as one self-contained file
```

**Releasing**: bump `version` in deno.json, commit, `git tag vX.Y.Z`, push the tag, `deno publish --allow-slow-types`.
esm.sh compiles the tagged source; nothing is built into git.

## Layout

`src/index.ts` (everything but 3D) · `src/three.ts` (3D) · `src/theme` (provider, tokens, CSS assembly) · `src/styles`
(component CSS as strings the theme provider puts in the page, tokens only) · `src/components` · `src/three` ·
`src/data.ts` · `src/url_state.tsx` · `src/vendor` (dim-app's zenoh client, the dimos LCM schemas; plain JS,
`deno task vendor`) · `demo/` (a Vite app) · `tools/` (vendor, sync-tokens).

The 3D code is ported from dim-controller's view; the icons are the shared dimOS set.
