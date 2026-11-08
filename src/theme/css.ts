// Every component's CSS, in one string the theme provider puts in the page. Each part is written against Desktop's
// theme tokens only (var(--…)): no color literals, so every skin restyles it.
import { BASE_CSS } from "../styles/base.ts"
import { CONTROLS_CSS } from "../styles/controls.ts"
import { FEEDBACK_CSS } from "../styles/feedback.ts"
import { LAYOUT_CSS } from "../styles/layout.ts"
import { DATA_CSS } from "../styles/data.ts"
import { NAV_CSS } from "../styles/nav.ts"
import { INPUT_DEVICES_CSS } from "../styles/input_devices.ts"
import { SCENE_CSS } from "../styles/scene.ts"
import { TEXT_CSS } from "../styles/text.ts"
import { MEDIA_CSS } from "../styles/media.ts"
import { VIEW_PANEL_CSS } from "../styles/view_panel.ts"
import { LOGS_CSS } from "../styles/logs.ts"
import { SETTINGS_CSS } from "../styles/settings.ts"
import { TOPICS_CSS } from "../styles/topics.ts"
import { GRAPH_CSS } from "../styles/graph.ts"
import { COMMENTS_CSS } from "../styles/comments.ts"

export const COMPONENT_CSS = [
    BASE_CSS,
    CONTROLS_CSS,
    FEEDBACK_CSS,
    LAYOUT_CSS,
    DATA_CSS,
    NAV_CSS,
    INPUT_DEVICES_CSS,
    SCENE_CSS,
    TEXT_CSS,
    MEDIA_CSS,
    VIEW_PANEL_CSS,
    LOGS_CSS,
    SETTINGS_CSS,
    TOPICS_CSS,
    GRAPH_CSS,
    COMMENTS_CSS,
].join("\n")
