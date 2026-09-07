import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getDb } from "./postgres.js";

const SOURCE_NAME = "Election Commission of India";
const SOURCE_REFERENCE = "https://www.eci.gov.in/Documents/Delimitation/DelimitationofParliamentaryAssemblyConstituenciesOrder-2008%28English%29.pdf";
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(currentDirectory, "telangana-assembly-extents.json");

const specialScopes = {
  "AC-016": [full("Machareddy"), full("Domakonda"), full("Kamareddy"), full("Bhiknoor")],
  "AC-007": [full("Adilabad Rural"), full("Adilabad Urban"), full("Jainath"), full("Bela")],
  "AC-009": [full("Dilawarpur"), full("Nirmal U"), full("Nirmal Rural"), full("Laxmanchanda"), full("Mamada"), full("Sarangapur")],
  "AC-018": [full("Jakranpalle"), full("Sirkonda"), partial("Nizamabad Rural"), full("Dichpalle"), full("Dharpalle")],
  "AC-021": [full("Raikal"), full("Sarangapur"), full("Jagitial"), full("Jagitial Rural")],
  "AC-033": [full("Siddipet Urban"), full("Siddipet Rural"), full("Chinnakodur"), full("Nangnoor")],
  "AC-074": [full("Hanwada"), full("Mahabubnagar Urban"), full("Mahabubnagar Rural")],
  "AC-046": [partial("Balanagar")],
  "AC-049": [partial("Saroornagar")],
  "AC-050": [full("Maheswaram"), full("Kandukur"), partial("Saroornagar")],
  "AC-052": [full("Serilingampally"), partial("Balanagar")],
  "AC-057": [], "AC-058": [], "AC-059": [], "AC-060": [], "AC-061": [],
  "AC-062": [], "AC-063": [], "AC-064": [], "AC-065": [], "AC-066": [],
  "AC-067": [], "AC-068": [], "AC-069": [], "AC-070": [], "AC-071": [],
  "AC-105": [partial("Warangal")],
  "AC-106": [partial("Warangal")],
  "AC-118": [full("Mulikalapalle"), full("Chandrugonda"), full("Aswaraopeta"), full("Dammapeta")],
  "AC-119": [full("Wazeed"), full("Venkatapuram"), full("Cherla"), full("Dummugudem"), full("Bhadrachalam")]
};

const nameAliases = {
  kouthala: "Koutala", dahegaon: "Dahegoan", kotapalli: "Kotapally",
  bellampalli: "Bellampally", bhimini: "Bheemini", nennal: "Nennel",
  vemanpalli: "Vemanpally", dandepalli: "Dandepally", wankdi: "Wankidi",
  rebbana: "Rebbena", indervelly: "Inderavelly", gudihathnoor: "Gudihatnoor",
  bazarhathnoor: "Bazarhatnoor", mamda: "Mamada", armur: "Armoor",
  ranjal: "Renjal", yedpalle: "Yedapally", birkoor: "Birkur",
  kotgiri: "Kotagiri", nagareddipet: "Nagireddypet", sadasivanagar: "Sadashivanagar",
  jakranpalle: "Jakranpally", sirkonda: "Sirikonda", dichpalle: "Dichpally",
  dharpalle: "Dharpally", mortad: "Morthad", kammarpalle: "Kammarpally",
  velpur: "Vailpoor", koratla: "Korutla", metpalle: "Metpalli",
  jagtial: "Jagitial", gollapalle: "Gollapalli", velgatoor: "Velgatur",
  pegadapalle: "Pegadapalli", peddapalle: "Peddapalli", julapalle: "Julapalli",
  sultanabad: "Sulthanabad", boinpalle: "Boinpalli", konaraopeta: "Konaraopet",
  medipalle: "Medipalli", ellanthakunta: "Illanthakunta",
  timmapurlmdcolony: "Thimmapur LMD", saidapur: "V.Saidapur",
  bheemadevarpalle: "Bheemadevarpalli", elkathurthi: "Elkathurthy",
  alladurgh: "Alladurg", munpalle: "Munipally", kowdipalle: "Kowdipally",
  ramachandrapuram: "Ramchandrapuram", toguta: "Thoguta", tupran: "Toopran",
  quthbullapur: "Qutballapur", maheswaram: "Maheshwaram", kulkacherla: "Kulkacharla",
  yalal: "Yelal", bomraspet: "Bomaraspeta", damaragidda: "Damargidda",
  devarkadra: "Devarakadra", narva: "Narwa", ieez: "Ieeja",
  itikyal: "Itikyala", waddepalle: "Waddepally", bijinapalle: "Bijinapally",
  telkapalle: "Telkapally", talakondapalle: "Thalakondapally",
  veepangandla: "Weepangandla", peddakothapalle: "Peddakothapally",
  chintapalle: "Chinthapally", gundlapalle: "Gundlapally",
  chandampet: "Chandampeta", peddaadisarlapalle: "Pedda Adesherlapally",
  nidamanur: "Nidmanoor", thripuraram: "Tripuraram", vemulapalle: "Vemulapally",
  damercherla: "Dameracherla", neredcherla: "Nereducherla",
  garidepalle: "Garidepally", mattampalli: "Mattampally", chivvemla: "Chivemla",
  thipparthi: "Thipparthy", kangal: "Kanagal", narayanapur: "Narayanpur",
  nampalle: "Nampally", pochampalle: "B Pochampally", ramannapeta: "Ramannapet",
  chityala: "Chityal", kattangoor: "Kattangur", kethepalle: "Kethepally",
  narketpalle: "Narketpally", thungathurthi: "Thungaturthy",
  nuthankal: "Nuthanakal", jajireddigudem: "Jajireddygudem",
  saligouraram: "Shaligouraram", mturkapalle: "Thurkapally", rajapet: "Rajapeta",
  jangaon: "Jangoan", raghunathpalle: "Ragunathpally", palakurthi: "Palakurthy",
  raiparthy: "Rayaparthy",
  nallabelly: "Nallabelli", sangam: "Sangem", mogullapalle: "Mogullapally",
  bhupalpalle: "Bhupalpally", eturnagaram: "Eturunagaram", kamepalle: "Kamepalli",
  tekulapalle: "Tekulapalli", thirumalayapalem: "Tirumalayapalem",
  nelakondapalle: "Nelakondapalli", enkuru: "Enkoor", sathupalle: "Sathupalli",
  kallur: "Kalluru", tallada: "Thallada", mulikalapalle: "Mulkalapally",
  wazeed: "Wajedu"
};

// Only used when the current Administrative master contains the same Mandal name
// in more than one District. Unlisted ambiguity is deliberately left unresolved.
const districtPreferences = {
  "AC-003:tandur": "mancherial",
  "AC-006:khanapur": "nirmal",
  "AC-009:sarangapur": "nirmal",
  "AC-018:sirkonda": "nizamabad",
  "AC-020:ibrahimpatnam": "jagitial",
  "AC-021:sarangapur": "jagitial",
  "AC-028:medipalle": "jagitial",
  "AC-042:mulug": "siddipet",
  "AC-046:balanagar": "medchalmalkajgiri",
  "AC-048:ibrahimpatnam": "rangareddy",
  "AC-052:serilingampally": "rangareddy",
  "AC-052:balanagar": "medchalmalkajgiri",
  "AC-053:nawabpet": "vikarabad",
  "AC-056:tandur": "vikarabad",
  "AC-072:maddur": "narayanpet",
  "AC-075:nawabpet": "mahabubnagar",
  "AC-075:balanagar": "mahabubnagar",
  "AC-093:nampalle": "nalgonda",
  "AC-093:chandur": "nalgonda",
  "AC-095:chityala": "nalgonda",
  "AC-097:gundala": "yadadribhuvanagiri",
  "AC-098:maddur": "siddipet",
  "AC-100:palakurthi": "jangoan",
  "AC-103:khanapur": "warangal",
  "AC-108:chityal": "jayashankarbhupalapally",
  "AC-109:mulug": "mulugu",
  "AC-110:gundala": "bhadradrikothagudem"
};

function full(name) { return { name, coverageType: "FULL" }; }
function partial(name) { return { name, coverageType: "PARTIAL" }; }
function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseScope(record) {
  if (Object.prototype.hasOwnProperty.call(specialScopes, record.code)) return specialScopes[record.code];
  const marker = record.extent.search(/\sMandals?\.?/i);
  if (marker < 0) return [];
  return record.extent.slice(0, marker)
    .split(/\s*,\s*|\s+and\s+/i)
    .map(function (name) { return name.replace(/^and\s+/i, "").trim(); })
    .filter(Boolean)
    .map(full);
}

function resolveMandal(record, scope, mandals) {
  const sourceName = normalize(scope.name);
  const wanted = normalize(nameAliases[sourceName] || scope.name);
  let candidates = mandals.filter(function (mandal) { return normalize(mandal.name) === wanted; });
  if (!candidates.length) {
    const withoutQualifier = normalize(scope.name.replace(/\([^)]*\)/g, ""));
    candidates = mandals.filter(function (mandal) {
      return normalize(mandal.name.replace(/\([^)]*\)/g, "")) === withoutQualifier;
    });
  }
  if (candidates.length > 1) {
    const preferredDistrict = districtPreferences[`${record.code}:${sourceName}`];
    if (preferredDistrict) candidates = candidates.filter(function (mandal) {
      return normalize(mandal.district_name) === preferredDistrict;
    });
  }
  return candidates.length === 1 ? { mandal: candidates[0] } : { candidates };
}

async function loadDatabaseState(db) {
  const [jurisdictions, mandals] = await Promise.all([
    db.query(`
      SELECT jurisdiction.id, jurisdiction.code, jurisdiction.name
      FROM jurisdictions jurisdiction
      JOIN jurisdiction_types type ON type.id = jurisdiction.jurisdiction_type_id
      WHERE jurisdiction.is_active = TRUE AND type.code ILIKE '%ASSEMBLY%'
    `),
    db.query(`
      SELECT mandal.id, mandal.name, mandal.code, mandal.lgd_code,
        district.id AS district_id, district.name AS district_name
      FROM geo_units mandal
      JOIN geo_units district ON district.id = mandal.parent_id
      WHERE mandal.geo_type = 'MANDAL' AND mandal.is_active = TRUE
        AND district.geo_type = 'DISTRICT' AND district.is_active = TRUE
      ORDER BY district.name, mandal.name
    `)
  ]);
  return { jurisdictions: jurisdictions.rows, mandals: mandals.rows };
}

function buildPlan(records, state) {
  const jurisdictionByCode = new Map(state.jurisdictions.map(function (item) { return [item.code, item]; }));
  const mappings = [];
  const unresolved = [];
  const boundaryOnly = [];
  for (const record of records) {
    const jurisdiction = jurisdictionByCode.get(record.code);
    if (!jurisdiction) {
      unresolved.push({ constituency: record.code, name: record.name, geography: "Jurisdiction record missing", candidates: "" });
      continue;
    }
    const scopes = parseScope(record);
    if (!scopes.length) boundaryOnly.push({ code: record.code, name: record.name, extent: record.extent });
    for (const scope of scopes) {
      const resolution = resolveMandal(record, scope, state.mandals);
      if (!resolution.mandal) {
        unresolved.push({
          constituency: record.code,
          name: record.name,
          geography: scope.name,
          candidates: (resolution.candidates || []).map(function (item) { return `${item.district_name}/${item.name}`; }).join(", ")
        });
        continue;
      }
      mappings.push({ jurisdiction, record, scope, mandal: resolution.mandal });
    }
  }
  return { mappings, unresolved, boundaryOnly };
}

function assertCriticalMappings(plan) {
  const mapped = function (code) { return plan.mappings.filter(function (item) { return item.record.code === code; }); };
  const gajwel = mapped("AC-042");
  const serilingampally = mapped("AC-052");
  if (gajwel.length !== 6 || gajwel.some(function (item) { return item.scope.coverageType !== "FULL"; })) {
    throw new Error(`Gajwel validation failed: expected 6 full Mandals, resolved ${gajwel.length}`);
  }
  if (serilingampally.length !== 2 || serilingampally.filter(function (item) { return item.scope.coverageType === "PARTIAL"; }).length !== 1) {
    throw new Error("Serilingampally validation failed: expected one full and one partial Mandal");
  }
}

async function applyPlan(db, records, plan) {
  const client = await db.connect();
  const backupSchema = `legislative_crosswalk_backup_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${backupSchema}"`);
    await client.query(`CREATE TABLE "${backupSchema}".jurisdiction_geo_mapping AS TABLE public.jurisdiction_geo_mapping`);
    await client.query(`CREATE TABLE "${backupSchema}".jurisdictions AS TABLE public.jurisdictions`);
    await client.query(`
      UPDATE jurisdiction_geo_mapping mapping SET is_active = FALSE, updated_at = now()
      FROM jurisdictions jurisdiction
      JOIN jurisdiction_types type ON type.id = jurisdiction.jurisdiction_type_id
      WHERE mapping.jurisdiction_id = jurisdiction.id
        AND type.code ILIKE '%ASSEMBLY%' AND mapping.is_active = TRUE
    `);
    for (const item of plan.mappings) {
      const values = [item.jurisdiction.id, item.mandal.id, item.scope.coverageType,
        SOURCE_NAME, SOURCE_REFERENCE, item.record.extent];
      const updated = await client.query(`
        UPDATE jurisdiction_geo_mapping SET coverage_type = $3,
          mapping_method = 'OFFICIAL_DELIMITATION', confidence = 1,
          source_name = $4, source_reference = $5,
          verification_status = 'SOURCE_VERIFIED', notes = $6,
          is_active = TRUE, updated_at = now()
        WHERE jurisdiction_id = $1 AND geo_unit_id = $2
        RETURNING id
      `, values);
      if (!updated.rowCount) {
        await client.query(`
          INSERT INTO jurisdiction_geo_mapping (
            jurisdiction_id, geo_unit_id, coverage_type, mapping_method, confidence,
            source_name, source_reference, verification_status, notes, is_active
          ) VALUES ($1,$2,$3,'OFFICIAL_DELIMITATION',1,$4,$5,'SOURCE_VERIFIED',$6,TRUE)
        `, values);
      }
    }
    for (const record of records) {
      const status = plan.boundaryOnly.some(function (item) { return item.code === record.code; })
        ? "WARD_CROSSWALK_REQUIRED"
        : plan.unresolved.some(function (item) { return item.constituency === record.code; })
          ? "REVIEW_REQUIRED" : "SOURCE_VERIFIED";
      await client.query(`
        UPDATE jurisdictions SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at = now()
        WHERE code = $1
      `, [record.code, JSON.stringify({ official_extent: record.extent, crosswalk_status: status,
        crosswalk_source: SOURCE_NAME, crosswalk_source_reference: SOURCE_REFERENCE })]);
    }
    await client.query("COMMIT");
    return backupSchema;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const records = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const db = await getDb();
  const state = await loadDatabaseState(db);
  const plan = buildPlan(records, state);
  console.table([
    { metric: "Assembly constituencies", value: records.length },
    { metric: "Resolved Mandal mappings", value: plan.mappings.length },
    { metric: "Full Mandal mappings", value: plan.mappings.filter(function (item) { return item.scope.coverageType === "FULL"; }).length },
    { metric: "Partial Mandal mappings", value: plan.mappings.filter(function (item) { return item.scope.coverageType === "PARTIAL"; }).length },
    { metric: "Unresolved Mandal references", value: plan.unresolved.length },
    { metric: "Ward-defined constituencies", value: plan.boundaryOnly.length }
  ]);
  if (plan.unresolved.length) { console.log("Unresolved references (not guessed):"); console.table(plan.unresolved); }
  if (plan.boundaryOnly.length) { console.log("Constituencies requiring a ward-level crosswalk:"); console.table(plan.boundaryOnly.map(function (item) { return { code: item.code, name: item.name }; })); }
  assertCriticalMappings(plan);
  if (!apply) { console.log("Dry run passed. Re-run with --apply to replace Assembly crosswalks in one transaction."); return; }
  const backupSchema = await applyPlan(db, records, plan);
  console.log(`Pre-import backup schema: ${backupSchema}`);
  console.log("Telangana Assembly crosswalk committed.");
}

main().then(function () { process.exit(0); }).catch(function (error) {
  console.error("Telangana Assembly crosswalk failed:", error);
  process.exit(1);
});
