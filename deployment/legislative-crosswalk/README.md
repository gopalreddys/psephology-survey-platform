# Telangana legislative Administrative crosswalk

This package replaces broad legacy Assembly-to-District links with Mandal-level mappings from the Election Commission of India Delimitation of Parliamentary and Assembly Constituencies Order, 2008.

It deliberately distinguishes:

- `FULL` Mandals, which are safe for Mandal-level campaign allocation.
- `PARTIAL` Mandals, which remain visible but require a finer voter/ward crosswalk before allocation.
- ward-defined urban constituencies, which are reported but are not guessed as entire Mandals or Districts.

Parliamentary scope is resolved from its child Assembly constituencies by the updated repository.

## Files to copy into the API repository

- `import-telangana-assembly-crosswalk.js` → `src/db/import-telangana-assembly-crosswalk.js`
- `telangana-assembly-extents.json` → `src/db/telangana-assembly-extents.json`
- `jurisdictions.repository.js` → `src/repositories/jurisdictions.repository.js`
- `../campaign-workspace/campaigns.repository.js` → `src/repositories/campaigns.repository.js`

The Campaign repository copy contains the matching server-side safety check: a browser cannot submit a Mandal outside the selected constituency's verified full scope.

## Run the guarded import

Run the dry check first. It makes no database changes and prints every unresolved or ambiguous Mandal instead of guessing:

```bash
node src/db/import-telangana-assembly-crosswalk.js
```

The dry run must confirm these two critical controls:

- Gajwel resolves to 6 full Mandals.
- Serilingampally resolves to 1 full and 1 partial Mandal.
- The current LGD Administrative master produces 450 mappings: 443 full, 7 partial and 0 unresolved Mandal references.
- 17 urban constituencies remain explicitly marked as requiring ward-level crosswalks.

After reviewing the unresolved report, apply the crosswalk in one transaction:

```bash
node src/db/import-telangana-assembly-crosswalk.js --apply
sudo systemctl restart psephology-api.service
```

The apply creates a timestamped backup schema containing the pre-import jurisdiction and mapping tables. Then validate the authenticated scope endpoint for AC-042 and AC-052 in the Campaign page. Gajwel should show six assignable Mandals. Serilingampally should show only Serilingampally as assignable and Balanagar as a partial-boundary warning; it must not show all Ranga Reddy Mandals.

## Source

Election Commission of India, *Delimitation of Parliamentary and Assembly Constituencies Order, 2008*:

https://www.eci.gov.in/Documents/Delimitation/DelimitationofParliamentaryAssemblyConstituenciesOrder-2008%28English%29.pdf
