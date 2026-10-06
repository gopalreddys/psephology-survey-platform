const APPLY = process.argv.includes("--apply");
const SERVICE_ROOT =
  "https://tgrac.telangana.gov.in/arcgis/rest/services/" +
  "AdministrativeInfoSystem_Folder/Administrative_Information_System_Query/MapServer";
const SOURCE_NAME = "Telangana Remote Sensing Applications Centre (TGRAC)";
const DEMO_CONSTITUENCY = "Serilingampally";
const DEMO_CONSTITUENCY_NUMBER = "52";

const layers = [
  {
    id: 6,
    type: "STATE",
    objectId: "OBJECTID",
    fields: ["OBJECTID", "Dist_Name"],
    name: () => "Telangana"
  },
  {
    id: 5,
    type: "DISTRICT",
    objectId: "OBJECTID_1",
    fields: ["OBJECTID_1", "District"],
    name: (attributes) => attributes.District
  },
  {
    id: 1,
    type: "ASSEMBLY_CONSTITUENCY",
    objectId: "OBJECTID",
    fields: ["OBJECTID", "District", "Assembly", "Assembly_Name"],
    name: (attributes) => attributes.Assembly,
    district: (attributes) => attributes.District
  },
  {
    id: 3,
    type: "MANDAL",
    objectId: "OBJECTID",
    fields: [
      "OBJECTID", "District", "Mandal", "Revenue_Division",
      "District_Code", "Census_District_Code", "Census_Mandal_Code"
    ],
    name: (attributes) => attributes.Mandal,
    district: (attributes) => attributes.District,
    division: (attributes) => attributes.Revenue_Division
  }
];

function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase("en-IN");
}

function isDemoLocality(value) {
  return normalized(value).replace(/[^a-z]/g, "").startsWith("serilingampall");
}

function closeRing(ring) {
  const points = ring.map(([longitude, latitude]) => [Number(longitude), Number(latitude)]);
  if (!points.length) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first]);
  return points;
}

function ringArea(ring) {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    sum += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return sum / 2;
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [currentX, currentY] = ring[current];
    const [previousX, previousY] = ring[previous];
    const crosses = ((currentY > y) !== (previousY > y)) &&
      (x < ((previousX - currentX) * (y - currentY)) /
        ((previousY - currentY) || Number.EPSILON) + currentX);
    if (crosses) inside = !inside;
  }
  return inside;
}

function esriPolygonToGeoJson(esriGeometry) {
  const rings = (esriGeometry?.rings || [])
    .map(closeRing)
    .filter((ring) => ring.length >= 4)
    .map((ring) => ({ ring, area: Math.abs(ringArea(ring)), parent: null, depth: 0 }))
    .sort((left, right) => right.area - left.area);

  for (let index = 0; index < rings.length; index += 1) {
    const child = rings[index];
    let smallestParent = null;
    for (let candidateIndex = 0; candidateIndex < index; candidateIndex += 1) {
      const candidate = rings[candidateIndex];
      if (pointInRing(child.ring[0], candidate.ring) &&
          (!smallestParent || candidate.area < smallestParent.area)) {
        smallestParent = candidate;
      }
    }
    child.parent = smallestParent;
    child.depth = smallestParent ? smallestParent.depth + 1 : 0;
  }

  const polygons = rings
    .filter((entry) => entry.depth % 2 === 0)
    .map((outer) => {
      const holes = rings.filter((entry) => {
        if (entry.depth % 2 === 0) return false;
        let ancestor = entry.parent;
        while (ancestor && ancestor.depth % 2 !== 0) ancestor = ancestor.parent;
        return ancestor === outer;
      });
      return [outer.ring, ...holes.map((entry) => entry.ring)];
    });

  if (polygons.length === 1) return { type: "Polygon", coordinates: polygons[0] };
  return { type: "MultiPolygon", coordinates: polygons };
}

async function fetchLayer(layer) {
  const query = new URL(`${SERVICE_ROOT}/${layer.id}/query`);
  query.search = new URLSearchParams({
    where: "1=1",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: "5",
    maxAllowableOffset: "0.001",
    resultRecordCount: "1000",
    f: "json"
  }).toString();
  const response = await fetch(query, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`TGRAC layer ${layer.id} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`TGRAC layer ${layer.id}: ${body.error.message}`);
  return (body.features || []).map((feature) => ({
    layer,
    attributes: feature.attributes,
    geometry: esriPolygonToGeoJson(feature.geometry)
  }));
}

const fetched = [];
for (const layer of layers) fetched.push(...await fetchLayer(layer));
const demoAssembly = fetched.find(({ layer, attributes }) =>
  layer.type === "ASSEMBLY_CONSTITUENCY" &&
  normalized(layer.name(attributes)) === normalized(DEMO_CONSTITUENCY)
);
if (!demoAssembly) throw new Error("Official TGRAC data does not contain Serilingampally Assembly constituency");
const demoDistrict = normalized(demoAssembly.layer.district(demoAssembly.attributes));

const rows = fetched.map(({ layer, attributes, geometry }) => {
  const name = String(layer.name(attributes) || "").trim();
  const district = String(layer.district?.(attributes) || "").trim() || null;
  let demoScope = null;
  if (layer.type === "ASSEMBLY_CONSTITUENCY" && normalized(name) === normalized(DEMO_CONSTITUENCY)) {
    demoScope = "PRIMARY";
  } else if (
    layer.type === "STATE" ||
    (layer.type === "DISTRICT" && normalized(name) === demoDistrict) ||
    (layer.type === "MANDAL" && isDemoLocality(name) && normalized(district) === demoDistrict)
  ) {
    demoScope = "CONTEXT";
  }
  return {
    boundaryType: layer.type,
    layerId: layer.id,
    objectId: Number(attributes[layer.objectId]),
    boundaryCode: demoScope === "PRIMARY" ? DEMO_CONSTITUENCY_NUMBER : null,
    boundaryName: name,
    district,
    division: String(layer.division?.(attributes) || "").trim() || null,
    geometry,
    attributes,
    sourceUrl: `${SERVICE_ROOT}/${layer.id}`,
    demoScope
  };
});

console.table(layers.map((layer) => ({
  layer: layer.type,
  features: rows.filter((row) => row.boundaryType === layer.type).length
})));
console.log({
  demoConstituency: `AC ${DEMO_CONSTITUENCY_NUMBER} ${DEMO_CONSTITUENCY}`,
  district: demoAssembly.layer.district(demoAssembly.attributes),
  source: SOURCE_NAME,
  apply: APPLY
});

if (!APPLY) {
  console.log("Dry run only. Re-run with --apply to replace the governed boundary snapshot.");
  process.exit(0);
}

const { getDb } = await import("../db/postgres.js");
const db = await getDb();
const client = await db.connect();
try {
  await client.query("BEGIN");
  await client.query("UPDATE analytics_geo_boundary_reference SET is_active = FALSE, updated_at = now()");
  for (const row of rows) {
    await client.query(
      `INSERT INTO analytics_geo_boundary_reference (
         boundary_type, source_layer_id, source_object_id, boundary_code,
         boundary_name, parent_district_name, parent_division_name, geometry,
         source_attributes, source_name, source_url, source_spatial_reference,
         demo_scope, verified_at, is_active
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11,
         'EPSG:4326', $12, now(), TRUE
       )
       ON CONFLICT (boundary_type, source_layer_id, source_object_id)
       DO UPDATE SET
         boundary_code = EXCLUDED.boundary_code,
         boundary_name = EXCLUDED.boundary_name,
         parent_district_name = EXCLUDED.parent_district_name,
         parent_division_name = EXCLUDED.parent_division_name,
         geometry = EXCLUDED.geometry,
         source_attributes = EXCLUDED.source_attributes,
         source_name = EXCLUDED.source_name,
         source_url = EXCLUDED.source_url,
         source_spatial_reference = EXCLUDED.source_spatial_reference,
         demo_scope = EXCLUDED.demo_scope,
         verified_at = EXCLUDED.verified_at,
         is_active = TRUE,
         updated_at = now()`,
      [
        row.boundaryType, row.layerId, row.objectId, row.boundaryCode,
        row.boundaryName, row.district, row.division, JSON.stringify(row.geometry),
        JSON.stringify(row.attributes), SOURCE_NAME, row.sourceUrl, row.demoScope
      ]
    );
  }
  await client.query("COMMIT");
  console.log(`Synchronized ${rows.length} official Telangana administrative boundaries.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await db.end();
}
