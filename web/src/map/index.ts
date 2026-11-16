// Public API of the map module (owner: globe-map agent).
// GlobeView pulls Cesium lazily from /cesium; FlatMap/FieldMap pull MapLibre.
// For the smallest main bundle, import these through React.lazy in the app shell.
export { GlobeView } from './GlobeView'
export { FlatMap } from './FlatMap'
export { FieldMap, metaFromCsb } from './FieldMap'
export { WindRose, monthRanges } from './WindRose'
export type { WindRoseProps } from './WindRose'
export { detectGlobeSupport, parseKml, areaHa, bboxOf, centroidOf } from './geo'
export { GIBS_OVERLAYS, ATTRIBUTION } from './sources'
export type {
  ArcEnd,
  BBox,
  FieldGeometryInput,
  FieldMapProps,
  FieldMeta,
  FlatMapProps,
  FlyToTarget,
  GeometryInputInfo,
  GlobeArc,
  GlobeViewProps,
  LayerId,
  MapHandle,
  TerrainZone,
  WindRoseData,
} from './types'
