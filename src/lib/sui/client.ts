import { SuiGraphQLClient } from "@mysten/sui/graphql";

export const TATUM_SUI_GRAPHQL = "https://sui-mainnet.gateway.tatum.io/graphql";

/**
 * Sui mainnet reads and writes go through Tatum's gateway, authenticated with the Tatum key.
 * The gateway's own `/_methods` listing offers only GraphQL on this host; the JSON-RPC
 * request shown in Tatum's docs returns 404.
 */
export function createTatumSuiClient(apiKey: string, fetchImpl?: typeof fetch): SuiGraphQLClient {
  return new SuiGraphQLClient({
    url: TATUM_SUI_GRAPHQL,
    network: "mainnet",
    headers: { "x-api-key": apiKey },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

export async function latestCheckpoint(client: SuiGraphQLClient): Promise<number> {
  const { data, errors } = await client.query<{ checkpoint: { sequenceNumber: number } | null }>({
    query: "{ checkpoint { sequenceNumber } }",
    variables: {},
  });
  if (errors?.length) throw new Error(`Sui GraphQL error: ${errors.map((e) => e.message).join("; ")}`);
  if (!data?.checkpoint) throw new Error("Sui GraphQL returned no checkpoint");
  return data.checkpoint.sequenceNumber;
}
