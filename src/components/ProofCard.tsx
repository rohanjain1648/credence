import { shortAddress, shortDate, suiObjectUrl } from "@/lib/format";
import type { MemoryProof } from "@/lib/sui/memoryProof";

/** The memory account as read from Sui through Tatum's gateway, so anyone can check it independently. */
export function ProofCard({ proof }: { proof: MemoryProof }) {
  return (
    <div>
      <dl className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-2">Memory account</dt>
          <dd className="font-medium">
            <a href={suiObjectUrl(proof.accountId)} target="_blank" rel="noreferrer" className="underline decoration-rule-strong hover:text-ink">
              {shortAddress(proof.accountId)} on Suiscan
            </a>
          </dd>
        </div>
        <div>
          <dt className="text-ink-2">Status</dt>
          <dd className="font-medium">{proof.active ? "Active" : "Inactive"}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Owner</dt>
          <dd className="font-medium">{shortAddress(proof.owner)}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Delegate keys</dt>
          <dd className="font-medium">{proof.delegateKeyCount}</dd>
        </div>
        {proof.createdAtMs != null && (
          <div>
            <dt className="text-ink-2">Created</dt>
            <dd className="font-medium">{shortDate(proof.createdAtMs)}</dd>
          </div>
        )}
        {proof.memoriesOnWalrus != null && (
          <div>
            <dt className="text-ink-2">Memories the relayer reports</dt>
            <dd className="font-medium">{proof.memoriesOnWalrus}</dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-sm text-muted">
        Read through Tatum&apos;s Sui gateway at checkpoint #{Number(proof.checkpoint).toLocaleString("en-US")}.
      </p>
    </div>
  );
}
