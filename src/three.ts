// dimos-react's 3D view (three.js): import from ".../three.js" so apps without a 3D view never load three.
export {
    colorFor,
    FrameHighlight,
    FramePicker,
    KeyboardFly,
    Layer,
    Path,
    placeInFixedFrame,
    PointCloud,
    pointCloud2ToPositions,
    Pose,
    PoseArray,
    poseMatrix,
    poseOf,
    RobotModel,
    Scene3D,
    SceneControls,
    SceneStats,
    TfFeed,
    TfFrames,
    TfProvider,
    TopicLayers,
    useFixedFrame,
    useLayer,
    useScene,
    useSceneActions,
    useSceneFrame,
    useTf,
    useTfFrames,
    useTfIssues,
    useViewer,
} from "./three/react.tsx"
export { LayersPanel, TfFootnote, TfPanel, useLayerManager } from "./three/panels.tsx"
export { cubeRegion, regionDirection, regionLabel, ViewCube } from "./three/view_cube.ts"
export type { CubeRegion, ViewCubeCorner, ViewCubeOptions } from "./three/view_cube.ts"
export {
    CubeShadePicker,
    NearShrinkSetting,
    PointLookEditor,
    RangeInput,
    RenderingSettings,
    StylePicker,
} from "./three/look_editor.tsx"
export { LayerManager } from "./three/layers/manager.ts"
export {
    allLayerTypes,
    allOverlayTypes,
    defaultSettings,
    followOnTop,
    layerTypeById,
    layerTypeFor,
    overlayTypeFor,
    placeLayer,
    registerLayer,
    registerOverlay,
    rgba,
    RobotPose,
    subscribeDecoded,
} from "./three/layers/registry.ts"
export { CloudLayer, CloudQualitySelect, CloudSettingsEditor, isMapTopic } from "./three/layers/pointcloud.tsx"
export { ColorSetting, PoseLayer } from "./three/layers/pose.tsx"
export { PathLayer, pathPoints } from "./three/layers/path.tsx"
export { PoseArrayLayer } from "./three/layers/pose_array.tsx"
export { GraphLayer } from "./three/layers/graph.tsx"
export { MARKER_TYPE, MarkerLayer } from "./three/layers/marker.ts"
export { boxesOf, BoxLayer } from "./three/layers/boxes.tsx"
export { entitiesOf, LabeledPoints } from "./three/layers/labeled_points.ts"
export { GridLayer } from "./three/layers/occupancy.tsx"
export { TfFramesLayer } from "./three/layers/tf_frames.tsx"
export { Camera3dLayer } from "./three/layers/camera3d.tsx"
export { checkTf, confirmedIssues, TF_STALE_MS } from "./three/tf_check.ts"
export { FrameHighlighter } from "./three/frame_highlight.ts"
export { ChaseHeading, headingOf, isOpticalFrame, turnAbout, wrapAngle } from "./three/follow_heading.ts"
export {
    appRendering,
    FRAME_BUDGET_MS,
    rendering,
    resolveLook,
    resolveNearShrink,
    resolveStyle,
    setRenderingDefaults,
    splatFallback,
} from "./three/rendering.ts"
export {
    CLOUD_PRESETS,
    cloudChanges,
    cloudOptions,
    cloudPreset,
    cloudQualities,
    cloudQualityOf,
    cloudRates,
    CloudStream,
    formatBytes,
    formatCount,
    setCloudQuality,
    setCloudRate,
} from "./three/cloud_quality.ts"
export { GradientPicker } from "./three/gradient_picker.tsx"
export { Viewer } from "./three/viewer.ts"
export type { FrameInfo, PickResult, RenderStats, ViewerOptions } from "./three/viewer.ts"
export { ON_TOP_CHANNEL } from "./three/on_top.ts"
export type { LayerCommonSettings } from "./three/layers/registry.ts"
export { STALE_MS, TfTree, WORLD_NAMES } from "./three/tf.ts"
export type { TfProblems, TfSnapshot, TfSnapshotEdge } from "./three/tf.ts"
export { CATCH_UP_SECONDS, PanGate, SmoothFollow } from "./three/follow.ts"
export { DEFAULT_GRADIENT, gradientCss, GRADIENTS, gradientTexture, RAMPS, sampleGradient } from "./three/gradients.ts"
export {
    applyLook,
    CUBE_SHADES,
    DEFAULT_LOOK,
    focusDistance,
    makePointMaterial,
    POINT_STYLES,
    setClipBox,
    splatBackground,
} from "./three/point_material.ts"
export { FatLines, pushBox } from "./three/lines.ts"
export { LabelPool } from "./three/labels.ts"
export { cssColor, disposeTree, ROBOT_KINDS, robotModel } from "./three/robot_model.ts"
export { localStore, readLocal, Store, useStore, writeLocal } from "./three/store.ts"
export * from "./camera/depth.ts"
export { DEFAULT_DEPTH_LOOK } from "./three/layers/camera3d.tsx"
export { Map2D } from "./map2d/react.tsx"
export { Map2DRenderer } from "./map2d/renderer.ts"
export {
    chooseMapTopic,
    chooseOverlay,
    fitView as fitMapView,
    followFrameOptions,
    isGridTopic,
    mapCandidates,
    overlayCandidates,
    screenToWorld as mapScreenToWorld,
    worldToScreen as mapWorldToScreen,
    zoomAt as mapZoomAt,
} from "./map2d/math.ts"
export { basePose, Kinematics, urdfPositions } from "./three/urdf/description.ts"
export type {
    DescriptionGeometry,
    DescriptionJoint,
    DescriptionLink,
    JointPositions,
    Origin,
    RobotDescription,
} from "./three/urdf/description.ts"
export { decodeMeshFile, meshGeometry, meshUris, parseUrdf } from "./three/urdf/parse.ts"
export { isUsda, parsePrims, parseUsda, usdaMeshUris } from "./three/urdf/usda.ts"
export type { Prim } from "./three/urdf/usda.ts"
export { solveIk } from "./three/urdf/ik.ts"
export type { IkResult } from "./three/urdf/ik.ts"
export {
    addCameraColor,
    CameraDepthPass,
    cameraModel,
    cameraUniforms,
    curvedPicture,
    distortRay,
    pixelRay,
    setCameraModel,
    undistortPixel,
} from "./three/camera_lens.ts"
export type { CameraModel, CameraUniforms } from "./three/camera_lens.ts"
