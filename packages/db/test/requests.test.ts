import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool, withTenant } from "../src/index.js";
import {
  WorkflowError,
  convertToTender,
  createRequest,
  invite,
  respond,
  setStatus,
} from "../src/requests.js";

const reachable = await pool
  .query("SELECT 1")
  .then(() => true)
  .catch(() => false);
if (!reachable) console.warn("\n  skipping request tests: no database at localhost:5433\n");
const withDb = reachable ? describe : describe.skip;

const BUYER = "11111111-1111-1111-1111-111111111111";
const SUP_A = "22222222-2222-2222-2222-222222222222";
const SUP_B = "33333333-3333-3333-3333-333333333333";
const ORG_BUYER = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_A = "aaaaaaaa-0000-0000-0000-000000000002";
const ORG_B = "aaaaaaaa-0000-0000-0000-000000000003";

const admin = new pg.Pool({
  connectionString:
    process.env.ADMIN_DATABASE_URL ?? "postgres://sealedrfq:localdev@localhost:5433/sealedrfq",
});

beforeEach(async () => {
  if (!reachable) return;
  await admin.query(`
    TRUNCATE request_responses, request_invitations, documents, requests, memberships,
             organizations, users RESTART IDENTITY CASCADE;
    INSERT INTO users (id, clerk_user_id) VALUES
      ('${BUYER}','user_buyer'), ('${SUP_A}','user_a'), ('${SUP_B}','user_b');
    INSERT INTO organizations (id, name, clerk_org_id) VALUES
      ('${ORG_BUYER}','Northwind','org_buyer'), ('${ORG_A}','Supplier A','org_a'), ('${ORG_B}','Supplier B','org_b');
    INSERT INTO memberships (org_id, user_id) VALUES
      ('${ORG_BUYER}','${BUYER}'), ('${ORG_A}','${SUP_A}'), ('${ORG_B}','${SUP_B}');
  `);
});

afterAll(async () => {
  await admin.end();
  await pool.end();
});

const openRfi = async (title = "Route optimisation") => {
  const rfi = await createRequest(BUYER, { orgId: ORG_BUYER, type: "RFI", title });
  await setStatus(BUYER, ORG_BUYER, rfi.id, "open");
  return rfi;
};

withDb("an RFI", () => {
  it("starts as a draft only its own organization can see", async () => {
    const rfi = await createRequest(BUYER, { orgId: ORG_BUYER, type: "RFI", title: "Draft" });
    expect(rfi.status).toBe("draft");
    const supplierSees = await withTenant(
      SUP_A,
      ORG_A,
      async (q) => (await q.query("SELECT id FROM requests WHERE id = $1", [rfi.id])).rowCount,
    );
    expect(supplierSees).toBe(0);
  });

  it("takes responses only while open", async () => {
    const rfi = await openRfi();
    await invite(BUYER, ORG_BUYER, rfi.id, ORG_A);
    await expect(
      respond(SUP_A, { requestId: rfi.id, orgId: ORG_A, body: "our approach" }),
    ).resolves.toBeTruthy();

    await setStatus(BUYER, ORG_BUYER, rfi.id, "closed");
    await expect(respond(SUP_A, { requestId: rfi.id, orgId: ORG_A, body: "late" })).rejects.toThrow(
      /closed request takes no responses/,
    );
  });

  it("cannot be answered by a supplier who was not invited", async () => {
    const rfi = await openRfi();
    await invite(BUYER, ORG_BUYER, rfi.id, ORG_A);
    await expect(
      respond(SUP_B, { requestId: rfi.id, orgId: ORG_B, body: "uninvited" }),
    ).rejects.toThrow(/not invited/);
  });

  it("cannot be invited to by anyone but the buyer", async () => {
    const rfi = await openRfi();
    await expect(invite(SUP_A, ORG_A, rfi.id, ORG_A)).rejects.toThrow(/not yours to change/);
  });
});

withDb("converting an RFI into a tender", () => {
  it("creates a new request and leaves the RFI intact", async () => {
    const rfi = await openRfi();
    await invite(BUYER, ORG_BUYER, rfi.id, ORG_A);
    await respond(SUP_A, { requestId: rfi.id, orgId: ORG_A, body: "our approach" });

    const { tender, rfi: after } = await convertToTender(BUYER, ORG_BUYER, {
      rfiId: rfi.id,
      type: "RFQ",
      title: "Route optimisation, tendered",
    });

    // A new document, not the old one rewritten: suppliers answered the RFI knowing it bound them
    // to nothing, and editing it in place would change what they agreed to after the fact.
    expect(tender.id).not.toBe(rfi.id);
    expect(tender.type).toBe("RFQ");
    expect(tender.parent_rfi_id).toBe(rfi.id);
    expect(after.status).toBe("converted");
    expect(after.type).toBe("RFI");

    // The RFI keeps its own answers.
    const responses = await withTenant(
      BUYER,
      ORG_BUYER,
      async (q) =>
        (await q.query("SELECT id FROM request_responses WHERE request_id = $1", [rfi.id]))
          .rowCount,
    );
    expect(responses).toBe(1);
  });

  it("produces a draft, so opening it stays a separate human act", async () => {
    const rfi = await openRfi();
    const { tender } = await convertToTender(BUYER, ORG_BUYER, {
      rfiId: rfi.id,
      type: "RFQ",
      title: "T",
    });
    expect(tender.status).toBe("draft");
  });

  it("refuses to convert twice", async () => {
    const rfi = await openRfi();
    await convertToTender(BUYER, ORG_BUYER, { rfiId: rfi.id, type: "RFQ", title: "first" });
    await expect(
      convertToTender(BUYER, ORG_BUYER, { rfiId: rfi.id, type: "RFQ", title: "second" }),
    ).rejects.toThrow(/converted request is final/);
  });

  it("refuses to convert an RFQ", async () => {
    const rfq = await createRequest(BUYER, { orgId: ORG_BUYER, type: "RFQ", title: "Already" });
    await expect(
      convertToTender(BUYER, ORG_BUYER, { rfiId: rfq.id, type: "RFQ", title: "nope" }),
    ).rejects.toThrow(/only an RFI can be converted/);
  });

  it("cannot be done by a supplier who merely answered it", async () => {
    const rfi = await openRfi();
    await invite(BUYER, ORG_BUYER, rfi.id, ORG_A);
    await respond(SUP_A, { requestId: rfi.id, orgId: ORG_A, body: "our approach" });
    await expect(
      convertToTender(SUP_A, ORG_A, { rfiId: rfi.id, type: "RFQ", title: "hijack" }),
    ).rejects.toThrow(/not yours to change/);
  });

  it("stops the RFI taking further answers", async () => {
    const rfi = await openRfi();
    await invite(BUYER, ORG_BUYER, rfi.id, ORG_A);
    await convertToTender(BUYER, ORG_BUYER, { rfiId: rfi.id, type: "RFQ", title: "T" });
    await expect(
      respond(SUP_A, { requestId: rfi.id, orgId: ORG_A, body: "too late" }),
    ).rejects.toThrow(/converted request takes no responses/);
  });
});

withDb("the status machine", () => {
  it("refuses a move that is not on the map", async () => {
    const rfi = await createRequest(BUYER, { orgId: ORG_BUYER, type: "RFI", title: "D" });
    await expect(setStatus(BUYER, ORG_BUYER, rfi.id, "closed")).rejects.toThrow(WorkflowError);
    await expect(setStatus(BUYER, ORG_BUYER, rfi.id, "closed")).rejects.toThrow(
      /can only become open/,
    );
  });

  it("treats cancelled as final", async () => {
    const rfi = await openRfi();
    await setStatus(BUYER, ORG_BUYER, rfi.id, "cancelled");
    await expect(setStatus(BUYER, ORG_BUYER, rfi.id, "open")).rejects.toThrow(/final/);
  });
});
