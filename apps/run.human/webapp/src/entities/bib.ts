import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * Read-only Bib reader (run.human side).
 *
 * The bib service (run.bib) owns the Bib entity and all writes to it. This is a
 * minimal, read-only mirror so the profile page can surface a runner's bib code
 * (BIB-XXXX) without a cross-service API call — the Bib record lives in the same
 * shared ElectroDB table (service "run"), keyed by ownerSub = the auth user id.
 *
 * IMPORTANT: keep model.entity / version / service and the primary key config in
 * lockstep with apps/run.bib/webapp/src/entities/bib.ts. Only the attributes we
 * actually read are declared here; ElectroDB ignores the rest.
 */
export const Bib = new Entity(
  {
    model: {
      entity: "Bib",
      version: "1",
      service: "run",
    },
    attributes: {
      ownerSub: {
        type: "string",
        required: true,
      },
      runnerCode: {
        type: "string",
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["ownerSub"] },
        sk: { field: "sk", composite: [], template: "BIB" },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

/**
 * Resolve the runner's bib code, or null if they haven't visited the bib
 * service yet (the Bib record is created lazily on that page).
 */
export async function getRunnerCode(ownerSub: string): Promise<string | null> {
  const result = await Bib.get({ ownerSub }).go();
  return result.data?.runnerCode ?? null;
}
