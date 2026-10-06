"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Layers3, LoaderCircle, MapPinned, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/api";
import styles from "./quick.module.css";

type LayerName = "STATE" | "DISTRICT" | "ASSEMBLY_CONSTITUENCY" | "MANDAL";
type Position = [number, number];
type BoundaryGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: Position[][] | Position[][][];
};
type BoundaryFeature = {
  type: "Feature";
  properties: {
    code: string | null;
    name: string;
    district: string | null;
    division: string | null;
    demoScope: "PRIMARY" | "CONTEXT" | null;
  };
  geometry: BoundaryGeometry;
};
type BoundaryResponse = {
  layer: LayerName;
  featureCount: number;
  source: { name: string; url: string; verifiedAt: string } | null;
  demoConstituency: { number: number; name: string; district: string };
  featureCollection: { type: "FeatureCollection"; features: BoundaryFeature[] };
};

const WIDTH = 900;
const HEIGHT = 570;
const PADDING = 24;
const LAYERS: Array<{ value: LayerName; label: string }> = [
  { value: "DISTRICT", label: "Districts" },
  { value: "ASSEMBLY_CONSTITUENCY", label: "Constituencies" },
  { value: "MANDAL", label: "Mandals" }
];

function positions(geometry: BoundaryGeometry): Position[] {
  const found: Position[] = [];
  function visit(value: unknown) {
    if (!Array.isArray(value)) return;
    if (value.length === 2 && value.every((entry) => typeof entry === "number")) {
      found.push(value as Position);
      return;
    }
    value.forEach(visit);
  }
  visit(geometry.coordinates);
  return found;
}

function projector(features: BoundaryFeature[]) {
  const all = features.flatMap((feature) => positions(feature.geometry));
  if (!all.length) return () => [0, 0] as Position;
  const longitudes = all.map(([longitude]) => longitude);
  const latitudes = all.map(([, latitude]) => latitude);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const longitudeSpan = Math.max(maxLongitude - minLongitude, Number.EPSILON);
  const latitudeSpan = Math.max(maxLatitude - minLatitude, Number.EPSILON);
  const availableWidth = WIDTH - PADDING * 2;
  const availableHeight = HEIGHT - PADDING * 2;
  const scale = Math.min(availableWidth / longitudeSpan, availableHeight / latitudeSpan);
  const renderedWidth = longitudeSpan * scale;
  const renderedHeight = latitudeSpan * scale;
  const offsetX = (WIDTH - renderedWidth) / 2;
  const offsetY = (HEIGHT - renderedHeight) / 2;
  return ([longitude, latitude]: Position): Position => [
    offsetX + (longitude - minLongitude) * scale,
    offsetY + (maxLatitude - latitude) * scale
  ];
}

function geometryPath(geometry: BoundaryGeometry, project: (point: Position) => Position) {
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates as Position[][]]
    : geometry.coordinates as Position[][][];
  return polygons.map((polygon) => polygon.map((ring) => ring.map((point, index) => {
    const [x, y] = project(point);
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ") + " Z").join(" ")).join(" ");
}

function displayName(layer: LayerName) {
  if (layer === "ASSEMBLY_CONSTITUENCY") return "Assembly constituency";
  return layer.charAt(0) + layer.slice(1).toLocaleLowerCase("en-IN");
}

export default function TelanganaBoundaryMap() {
  const cache = useRef<Partial<Record<LayerName, BoundaryResponse>>>({});
  const [layer, setLayer] = useState<LayerName>("ASSEMBLY_CONSTITUENCY");
  const [stateLayer, setStateLayer] = useState<BoundaryResponse | null>(null);
  const [activeLayer, setActiveLayer] = useState<BoundaryResponse | null>(null);
  const [selected, setSelected] = useState<BoundaryFeature | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLayer = useCallback(async function (requestedLayer: LayerName) {
    if (cache.current[requestedLayer]) return cache.current[requestedLayer] as BoundaryResponse;
    const response = await apiFetch(
      `/api/enterprise-dashboard/geography-boundaries?layer=${requestedLayer}`
    ) as BoundaryResponse;
    cache.current[requestedLayer] = response;
    return response;
  }, []);

  useEffect(function () {
    let current = true;
    Promise.all([fetchLayer("STATE"), fetchLayer(layer)])
      .then(([stateResponse, layerResponse]) => {
        if (!current) return;
        setStateLayer(stateResponse);
        setActiveLayer(layerResponse);
        setSelected(
          layerResponse.featureCollection.features.find(
            (feature) => feature.properties.demoScope === "PRIMARY"
          ) || layerResponse.featureCollection.features.find(
            (feature) => feature.properties.demoScope === "CONTEXT"
          ) || null
        );
      })
      .catch((reason) => {
        if (!current) return;
        setError(reason instanceof Error ? reason.message : "Unable to load Telangana map");
      })
      .finally(() => { if (current) setLoading(false); });
    return function () { current = false; };
  }, [fetchLayer, layer]);

  const stateFeatures = useMemo(
    () => stateLayer?.featureCollection.features || [],
    [stateLayer]
  );
  const layerFeatures = activeLayer?.featureCollection.features || [];
  const project = useMemo(() => projector(stateFeatures), [stateFeatures]);

  return <section className={styles.boundaryPanel}>
    <div className={styles.boundaryHeader}>
      <div className={styles.boundaryTitle}>
        <MapPinned size={22} />
        <div>
          <span>OFFICIAL TELANGANA GEOGRAPHIC FRAME</span>
          <h2>Administrative boundary explorer</h2>
          <p>State, district, Assembly constituency and Mandal boundaries with Serilingampally highlighted for the governed demo.</p>
        </div>
      </div>
      <div className={styles.layerSwitch} aria-label="Map boundary layer">
        <Layers3 size={15} />
        {LAYERS.map((option) => <button
          type="button"
          key={option.value}
          className={layer === option.value ? styles.activeLayer : ""}
          aria-pressed={layer === option.value}
          onClick={function () {
            if (option.value === layer) return;
            setLoading(true);
            setError(null);
            setLayer(option.value);
          }}
        >{option.label}</button>)}
      </div>
    </div>

    {loading && <div className={styles.mapLoading}><LoaderCircle className={styles.spin} size={22} />Loading official boundaries…</div>}
    {!loading && error && <div className={styles.mapError}>
      <strong>Boundary map is not available yet</strong>
      <span>{error}. Run the governed TGRAC boundary sync on the API host.</span>
    </div>}
    {!loading && !error && stateFeatures.length > 0 && <div className={styles.mapLayout}>
      <div className={styles.mapCanvas}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Telangana ${displayName(layer)} boundary map`}>
          <rect width={WIDTH} height={HEIGHT} className={styles.mapWater} />
          {stateFeatures.map((feature) => <path
            key={`state-${feature.properties.name}`}
            d={geometryPath(feature.geometry, project)}
            className={styles.stateShape}
            fillRule="evenodd"
          />)}
          {layerFeatures.map((feature, index) => {
            const primary = feature.properties.demoScope === "PRIMARY";
            const context = feature.properties.demoScope === "CONTEXT";
            const chosen = selected === feature;
            return <path
              key={`${feature.properties.name}-${feature.properties.district || "state"}-${index}`}
              d={geometryPath(feature.geometry, project)}
              className={`${styles.boundaryShape} ${primary ? styles.demoShape : ""} ${context ? styles.contextShape : ""} ${chosen ? styles.selectedShape : ""}`}
              fillRule="evenodd"
              tabIndex={0}
              role="button"
              aria-label={`${displayName(layer)} ${feature.properties.name}`}
              onClick={function () { setSelected(feature); }}
              onKeyDown={function (event) {
                if (event.key === "Enter" || event.key === " ") setSelected(feature);
              }}
            ><title>{feature.properties.name}{feature.properties.district ? ` · ${feature.properties.district}` : ""}</title></path>;
          })}
        </svg>
        <div className={styles.mapLegend}>
          <span><i className={layer === "ASSEMBLY_CONSTITUENCY" ? styles.legendDemo : styles.legendContext} />
            {layer === "ASSEMBLY_CONSTITUENCY" ? "Demo constituency" : "Demo geography context"}
          </span>
          <span><i className={styles.legendBoundary} />{displayName(layer)} boundary</span>
        </div>
      </div>

      <aside className={styles.mapDetail}>
        <span>DEMO FOCUS</span>
        <strong>AC 52 · Serilingampally</strong>
        <small>Rangareddy · Telangana</small>
        <dl>
          <div><dt>Current layer</dt><dd>{displayName(layer)}</dd></div>
          <div><dt>Official features</dt><dd>{activeLayer?.featureCount || 0}</dd></div>
          <div><dt>Selected area</dt><dd>{selected?.properties.name || "Select a boundary"}</dd></div>
          {selected?.properties.district && <div><dt>District</dt><dd>{selected.properties.district}</dd></div>}
        </dl>
        <div className={styles.privacyNote}><ShieldCheck size={15} /><span>Administrative polygons only. No respondent coordinates or identities are plotted.</span></div>
        {activeLayer?.source && <a href={activeLayer.source.url} target="_blank" rel="noreferrer">
          {activeLayer.source.name} <ExternalLink size={13} />
        </a>}
      </aside>
    </div>}
  </section>;
}
