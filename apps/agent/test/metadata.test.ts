import { type Server, createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearMetadataCache,
  isPrivateAddress,
  loadMetadata,
  readCapped,
  toFetchableUrl,
} from "../src/modules/evaluator/metadata.js";

afterEach(() => clearMetadataCache());

describe("private address detection", () => {
  it("blocks the ranges an SSRF would aim at", () => {
    for (const ip of [
      "127.0.0.1",
      "169.254.169.254", // cloud instance metadata, the classic target
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1", // carrier NAT
      "0.0.0.0",
      "::1",
      "fd00::1", // unique-local
      "fe80::1", // link-local
      "::ffff:169.254.169.254", // v4 smuggled through a v6 literal
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "192.167.1.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("treats anything it cannot parse as unsafe", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
  });
});

describe("uri handling", () => {
  it("accepts https and refuses plaintext or odd schemes", () => {
    expect(toFetchableUrl("https://example.com/rfq.json")?.href).toBe(
      "https://example.com/rfq.json",
    );
    expect(toFetchableUrl("http://example.com/rfq.json")).toBeNull();
    expect(toFetchableUrl("file:///etc/passwd")).toBeNull();
    expect(toFetchableUrl("gopher://example.com")).toBeNull();
    expect(toFetchableUrl("not a uri at all")).toBeNull();
  });

  it("maps ipfs:// onto a gateway", () => {
    expect(toFetchableUrl("ipfs://bafyabc123")?.href).toBe("https://ipfs.io/ipfs/bafyabc123");
  });
});

describe("loadMetadata", () => {
  it("still reads inline JSON, which is how the web form publishes", async () => {
    const doc = { scope: "laptops", rubric: { price: 50, delivery: 30, quality: 20 } };
    await expect(loadMetadata(JSON.stringify(doc))).resolves.toEqual(doc);
  });

  it("returns null for free text rather than throwing", async () => {
    await expect(loadMetadata("see the attached PDF")).resolves.toBeNull();
    await expect(loadMetadata("")).resolves.toBeNull();
    await expect(loadMetadata("{not json")).resolves.toBeNull();
  });

  it("refuses to fetch a loopback URL even over https", async () => {
    // The whole point: an RFQ author must not be able to aim the agent at its own network.
    await expect(loadMetadata("https://127.0.0.1/rfq.json")).rejects.toThrow(/private address/);
    await expect(loadMetadata("https://[::1]/rfq.json")).rejects.toThrow(/private address/);
  });

  it("refuses the cloud metadata endpoint", async () => {
    await expect(loadMetadata("https://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /private address/,
    );
  });
});

describe("size cap", () => {
  const cap = 256 * 1024;

  it("reads a normal document", async () => {
    await expect(readCapped(new Response('{"rubric":{}}'))).resolves.toBe('{"rubric":{}}');
  });

  it("refuses a body that overruns the cap, even when content-length lied", async () => {
    // A hostile host can understate content-length, so the stream itself has to be counted.
    const huge = "x".repeat(cap + 1024);
    const res = new Response(huge, { headers: { "content-length": "10" } });
    await expect(readCapped(res)).rejects.toThrow(/exceeded/);
  });

  it("refuses up front when content-length already declares too much", async () => {
    const res = new Response("{}", { headers: { "content-length": String(cap + 1) } });
    await expect(readCapped(res)).rejects.toThrow(/over the/);
  });
});

describe("loadMetadata over the network", () => {
  let server: Server;
  const start = (handler: Parameters<typeof createServer>[1]) =>
    new Promise<number>((resolve) => {
      server = createServer(handler);
      server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
    });

  afterEach(() => server?.close());

  it("will not fetch plaintext http even from a public-looking host", async () => {
    const port = await start((_req, res) => res.end("{}"));
    // http is rejected before any request is made, so this must not reach the server at all.
    await expect(loadMetadata(`http://127.0.0.1:${port}/rfq.json`)).resolves.toBeNull();
  });
});
