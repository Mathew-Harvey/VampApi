# Third-party API (Rise-X) integration

This folder holds the **request payload** used to call the Rise-X asset-rows API, and instructions for syncing that data into VAMP.

## Request files

- **`asset-rows-request-without-filter.json`** — Full request (URL + payload) for fetching all asset rows (no `displayName` filter). Use this for the sync script.
- **`asset-rows-with-displayName-filter.json`** — Same but with a filter (e.g. `displayName: "HMAS Adelaide"`) for testing a single asset.

The sync script reads the payload from the “without filter” file and paginates with `skip` / `take`.

## Syncing Rise-X data into VAMP

1. **Database**
   - **Render External** (from your machine / CI): use the **external** connection string (e.g. `...singapore-postgres.render.com/...`) with `?sslmode=require` for `DATABASE_URL`.
   - **Render Internal** (API when deployed on Render): use the **internal** connection string for `DATABASE_URL` in the Render service env.

2. **Run the sync**
   ```bash
   cd apps/api
   npm run sync:rise-x
   ```
   Requires in `.env`: `DATABASE_URL`, `RISE_X_API_URL`, and optionally `RISE_X_API_KEY` (or `RISE_X_BEARER_TOKEN`). On first run the script may create a “Rise-X Fleet” org and print `FLEET_ORG_ID=...` — add that to `.env` so all logged-in users see the synced vessels.

3. **Result**
   - Vessels are upserted into the same Render Postgres DB the API uses.
   - Synced vessels are read-only in the UI and visible to every user who logs in (when `FLEET_ORG_ID` is set).
