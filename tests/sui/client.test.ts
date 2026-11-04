import { describe, expect, test } from "vitest";
import { createTatumSuiClient, latestCheckpoint, TATUM_SUI_GRAPHQL } from "@/lib/sui/client";
import { fakeFetch } from "../helpers/fakeFetch";

describe("tatum sui client", () => {
  test("queries Tatum's GraphQL endpoint with the API key", async () => {
    const f = fakeFetch([{ status: 200, body: { data: { checkpoint: { sequenceNumber: 341530996 } } } }]);
    await latestCheckpoint(createTatumSuiClient("k", f));
    expect(TATUM_SUI_GRAPHQL).toBe("https://sui-mainnet.gateway.tatum.io/graphql");
    expect(f.calls[0].url).toBe(TATUM_SUI_GRAPHQL);
    expect(f.calls[0].headers["x-api-key"]).toBe("k");
  });

  test("latestCheckpoint returns the sequence number", async () => {
    const f = fakeFetch([{ status: 200, body: { data: { checkpoint: { sequenceNumber: 341530996 } } } }]);
    await expect(latestCheckpoint(createTatumSuiClient("k", f))).resolves.toBe(341530996);
  });

  test("latestCheckpoint fails loudly on GraphQL errors", async () => {
    const f = fakeFetch([{ status: 200, body: { data: null, errors: [{ message: "boom" }] } }]);
    await expect(latestCheckpoint(createTatumSuiClient("k", f))).rejects.toThrow(/boom/);
  });
});
