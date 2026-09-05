export const datasetProfile = {
  administrative: {
    states: 1,
    districts: 33,
    mandals: 621,
    villages: 11443,
    totalUnits: 12098
  },
  localBody: {
    zillaParishads: 33,
    mandalPrajaParishads: 621,
    gramPanchayats: 8409,
    municipalCorporations: 11,
    municipalities: 150,
    urbanWards: 3453,
    totalBodies: 9224,
    ruralBodies: 9063,
    urbanBodies: 161
  },
  sourceUpdated: "5 September 2026"
} as const;

export type LegislativeRecord = {
  id: string;
  name: string;
  type: "PC" | "AC" | "MLC";
  typeLabel: string;
  reservation: "GENERAL" | "SC" | "ST" | null;
  parent: string;
  office: "MP" | "MLA" | "MLC";
  seats: number;
};

const assemblyNames = [
  "Sirpur", "Chennur", "Bellampalli", "Mancherial", "Asifabad", "Khanapur", "Adilabad", "Boath", "Nirmal", "Mudhole",
  "Armur", "Bodhan", "Jukkal", "Banswada", "Yellareddy", "Kamareddy", "Nizamabad (Urban)", "Nizamabad (Rural)", "Balkonda",
  "Koratla", "Jagtial", "Dharmapuri", "Ramagundam", "Manthani", "Peddapalle", "Karimnagar", "Choppadandi", "Vemulawada", "Sircilla", "Manakondur", "Huzurabad", "Husnabad",
  "Siddipet", "Medak", "Narayankhed", "Andole", "Narsapur", "Zahirabad", "Sangareddy", "Patancheru", "Dubbak", "Gajwel",
  "Medchal", "Malkajgiri", "Quthbullapur", "Kukatpally", "Uppal", "Ibrahimpatnam", "Lal Bahadur Nagar", "Maheshwaram", "Rajendranagar", "Serilingampally", "Chevella", "Pargi", "Vikarabad", "Tandur",
  "Musheerabad", "Malakpet", "Amberpet", "Khairatabad", "Jubilee Hills", "Sanathnagar", "Nampally", "Karwan", "Goshamahal", "Charminar", "Chandrayangutta", "Yakutpura", "Bahadurpura", "Secunderabad", "Secunderabad Cantt.",
  "Kodangal", "Narayanpet", "Mahbubnagar", "Jadcherla", "Devarkadra", "Makthal", "Wanaparthy", "Gadwal", "Alampur", "Nagarkurnool", "Achampet", "Kalwakurthy", "Shadnagar", "Kollapur",
  "Devarakonda", "Nagarjuna Sagar", "Miryalaguda", "Huzurnagar", "Kodad", "Suryapet", "Nalgonda", "Munugode", "Bhongir", "Nakrekal", "Thungathurthi", "Alair",
  "Jangaon", "Ghanpur (Station)", "Palakurthi", "Dornakal", "Mahabubabad", "Narsampet", "Parkal", "Warangal West", "Warangal East", "Wardhannapet", "Bhupalpalle", "Mulug",
  "Pinapaka", "Yellandu", "Khammam", "Palair", "Madhira", "Wyra", "Sathupalle", "Kothagudem", "Aswaraopeta", "Bhadrachalam"
] as const;

const scAssembly = new Set([
  2, 3, 13, 22, 27, 30, 36, 38, 53, 55,
  71, 80, 82, 95, 96, 99, 107, 114, 116
]);

const stAssembly = new Set([
  5, 6, 8, 86, 101, 102,
  109, 110, 111, 115, 118, 119
]);

const parliamentaryDefinitions = [
  [1, "Adilabad", "ST", [1, 5, 6, 7, 8, 9, 10]],
  [2, "Peddapalle", "SC", [2, 3, 4, 22, 23, 24, 25]],
  [3, "Karimnagar", "GENERAL", [26, 27, 28, 29, 30, 31, 32]],
  [4, "Nizamabad", "GENERAL", [11, 12, 17, 18, 19, 20, 21]],
  [5, "Zahirabad", "GENERAL", [13, 14, 15, 16, 35, 36, 38]],
  [6, "Medak", "GENERAL", [33, 34, 37, 39, 40, 41, 42]],
  [7, "Malkajgiri", "GENERAL", [43, 44, 45, 46, 47, 49, 71]],
  [8, "Secunderabad", "GENERAL", [57, 59, 60, 61, 62, 63, 70]],
  [9, "Hyderabad", "GENERAL", [58, 64, 65, 66, 67, 68, 69]],
  [10, "Chevella", "GENERAL", [50, 51, 52, 53, 54, 55, 56]],
  [11, "Mahbubnagar", "GENERAL", [72, 73, 74, 75, 76, 77, 84]],
  [12, "Nagarkurnool", "SC", [78, 79, 80, 81, 82, 83, 85]],
  [13, "Nalgonda", "GENERAL", [86, 87, 88, 89, 90, 91, 92]],
  [14, "Bhongir", "GENERAL", [48, 93, 94, 95, 96, 97, 98]],
  [15, "Warangal", "SC", [99, 100, 104, 105, 106, 107, 108]],
  [16, "Mahabubabad", "ST", [101, 102, 103, 109, 110, 111, 119]],
  [17, "Khammam", "GENERAL", [112, 113, 114, 115, 116, 117, 118]]
] as const;

const pcByAssembly = new Map<number, string>();

for (const definition of parliamentaryDefinitions) {
  for (const assemblyNumber of definition[3]) {
    pcByAssembly.set(assemblyNumber, definition[1]);
  }
}

export const parliamentaryConstituencies: LegislativeRecord[] =
  parliamentaryDefinitions.map(function (definition) {
    return {
      id: `PC-${String(definition[0]).padStart(2, "0")}`,
      name: definition[1],
      type: "PC",
      typeLabel: "Parliamentary Constituency",
      reservation: definition[2],
      parent: "Telangana",
      office: "MP",
      seats: 1
    };
  });

export const assemblyConstituencies: LegislativeRecord[] =
  assemblyNames.map(function (name, index) {
    const number = index + 1;

    return {
      id: `AC-${String(number).padStart(3, "0")}`,
      name,
      type: "AC",
      typeLabel: "Assembly Constituency",
      reservation:
        scAssembly.has(number)
          ? "SC"
          : stAssembly.has(number)
            ? "ST"
            : "GENERAL",
      parent: pcByAssembly.get(number) || "Review required",
      office: "MLA",
      seats: 1
    };
  });

const mlcDefinitions = [
  ["MLC-LA-MBNR", "Mahbubnagar Local Authorities", "Local Authorities", "Mahbubnagar", 2],
  ["MLC-LA-RR", "Ranga Reddy Local Authorities", "Local Authorities", "Ranga Reddy", 2],
  ["MLC-LA-HYD", "Hyderabad Local Authorities", "Local Authorities", "Hyderabad", 2],
  ["MLC-LA-MED", "Medak Local Authorities", "Local Authorities", "Medak", 1],
  ["MLC-LA-NZB", "Nizamabad Local Authorities", "Local Authorities", "Nizamabad", 1],
  ["MLC-LA-ADB", "Adilabad Local Authorities", "Local Authorities", "Adilabad", 1],
  ["MLC-LA-KRM", "Karimnagar Local Authorities", "Local Authorities", "Karimnagar", 2],
  ["MLC-LA-WGL", "Warangal Local Authorities", "Local Authorities", "Warangal", 1],
  ["MLC-LA-KMM", "Khammam Local Authorities", "Local Authorities", "Khammam", 1],
  ["MLC-LA-NLG", "Nalgonda Local Authorities", "Local Authorities", "Nalgonda", 1],
  ["MLC-GRAD-MRH", "Mahbubnagar-Ranga Reddy-Hyderabad Graduates", "Graduates", "Mahbubnagar, Ranga Reddy, Hyderabad", 1],
  ["MLC-GRAD-MNAK", "Medak-Nizamabad-Adilabad-Karimnagar Graduates", "Graduates", "Medak, Nizamabad, Adilabad, Karimnagar", 1],
  ["MLC-GRAD-WKN", "Warangal-Khammam-Nalgonda Graduates", "Graduates", "Warangal, Khammam, Nalgonda", 1],
  ["MLC-TEACH-MRH", "Mahbubnagar-Ranga Reddy-Hyderabad Teachers", "Teachers", "Mahbubnagar, Ranga Reddy, Hyderabad", 1],
  ["MLC-TEACH-MNAK", "Medak-Nizamabad-Adilabad-Karimnagar Teachers", "Teachers", "Medak, Nizamabad, Adilabad, Karimnagar", 1],
  ["MLC-TEACH-WKN", "Warangal-Khammam-Nalgonda Teachers", "Teachers", "Warangal, Khammam, Nalgonda", 1]
] as const;

export const mlcConstituencies: LegislativeRecord[] =
  mlcDefinitions.map(function (definition) {
    return {
      id: definition[0],
      name: definition[1],
      type: "MLC",
      typeLabel: `MLC ${definition[2]}`,
      reservation: null,
      parent: definition[3],
      office: "MLC",
      seats: definition[4]
    };
  });

export const legislativeRecords: LegislativeRecord[] = [
  ...parliamentaryConstituencies,
  ...assemblyConstituencies,
  ...mlcConstituencies
];

export const legislativeProfile = {
  parliamentary: parliamentaryConstituencies.length,
  assembly: assemblyConstituencies.length,
  mlcConstituencies: mlcConstituencies.length,
  mlcSeats: mlcConstituencies.reduce(
    function (sum, constituency) {
      return sum + constituency.seats;
    },
    0
  ),
  totalConstituencies: legislativeRecords.length
} as const;

export const localBodyDatasets = [
  {
    name: "Zilla Parishads",
    level: "Rural institution",
    count: datasetProfile.localBody.zillaParishads,
    geography: "District",
    status: "Ready for import"
  },
  {
    name: "Mandal Praja Parishads",
    level: "Rural institution",
    count: datasetProfile.localBody.mandalPrajaParishads,
    geography: "Mandal",
    status: "Ready for import"
  },
  {
    name: "Gram Panchayats",
    level: "Village institution",
    count: datasetProfile.localBody.gramPanchayats,
    geography: "Mandal / Village",
    status: "Review duplicate GP codes"
  },
  {
    name: "Municipal Corporations",
    level: "Urban institution",
    count: datasetProfile.localBody.municipalCorporations,
    geography: "District / Mandal",
    status: "Ready for import"
  },
  {
    name: "Municipalities",
    level: "Urban institution",
    count: datasetProfile.localBody.municipalities,
    geography: "District / Mandal",
    status: "Ready for import"
  },
  {
    name: "Urban Divisions / Wards",
    level: "Contested electoral area",
    count: datasetProfile.localBody.urbanWards,
    geography: "Urban local body",
    status: "25 ULBs require ward verification"
  },
  {
    name: "ZPTC / MPTC / GP Wards",
    level: "Contested electoral area",
    count: null,
    geography: "District / Mandal / Village",
    status: "Official constituency data required"
  }
] as const;
