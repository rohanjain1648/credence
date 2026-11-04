import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/lib/db/client";
import { cachedMemoryProof, getMemoryAccountProof, parseMemWalAccount, type MemoryProof } from "@/lib/sui/memoryProof";
import account from "../fixtures/sui/memwal-account.json";
import { createTestDb } from "../helpers/db";

describe("parseMemWalAccount", () => {
  test("reads the real account object", () => {
    expect(parseMemWalAccount(account.json)).toEqual({
      owner: account.json.owner,
      delegateKeyCount: 1,
      active: true,
      createdAtMs: 1793787271273,
    });
  });

  test("tolerates a missing creation time", () => {
    const { created_at: _c, ...rest } = account.json;
    expect(parseMemWalAccount(rest).createdAtMs).toBeNull();
  });

  test("rejects anything that isn't a memory account", () => {
    expect(() => parseMemWalAccount(null)).toThrow(/memory account/i);
    expect(() => parseMemWalAccount({ owner: 5 })).toThrow(/memory account/i);
  });
});

describe("getMemoryAccountProof", () => {
  const client = {
    core: { getObject: async () => ({ object: account }) },
    query: async () => ({ data: { checkpoint: { sequenceNumber: 341530996 } } }),
  } as never;

  test("combines the account with the checkpoint it was read at", async () => {
    const proof = await getMemoryAccountProof(client, account.objectId, () => 1000);
    expect(proof).toEqual({
      accountId: account.objectId,
      type: account.type,
      owner: account.json.owner,
      delegateKeyCount: 1,
      active: true,
      createdAtMs: 1793787271273,
      checkpoint: "341530996",
      verifiedAt: 1000,
    });
  });
});

describe("cachedMemoryProof", () => {
  let db: Db;
  const proof = { accountId: "0x1", checkpoint: "1", verifiedAt: 1 } as MemoryProof;

  beforeEach(async () => {
    db = await createTestDb();
  });

  test("reads Sui at most once every 10 minutes", async () => {
    let calls = 0;
    const fetchProof = async () => {
      calls++;
      return proof;
    };
    await cachedMemoryProof(db, 0, fetchProof);
    expect(await cachedMemoryProof(db, 9 * 60_000, fetchProof)).toEqual(proof);
    expect(calls).toBe(1);
    await cachedMemoryProof(db, 11 * 60_000, fetchProof);
    expect(calls).toBe(2);
  });

  test("a failed read isn't cached", async () => {
    await expect(
      cachedMemoryProof(db, 0, async () => {
        throw new Error("gateway down");
      }),
    ).rejects.toThrow("gateway down");
    expect(await cachedMemoryProof(db, 1, async () => proof)).toEqual(proof);
  });
});
