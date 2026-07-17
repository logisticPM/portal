// Pure unit test for the BatchWriteCommand UnprocessedItems retry path in
// copyTable (scripts/migrate-table-region.ts). DynamoDB Local won't throttle
// a handful of items, so this exercises the retry/backoff logic against a
// fake doc client instead — no network, no DynamoDB Local required.
//
// Run: npx tsx scripts/test-migrate-unprocessed.ts
import { ScanCommand, BatchWriteCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { copyTable, type DocClientLike } from "./migrate-table-region";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const SRC_TABLE = "FakeSrc";
const DEST_TABLE = "FakeDest";

const SRC_ITEMS = [
  { PK: "ORG#1", SK: "META" },
  { PK: "ORG#2", SK: "META" },
  { PK: "ORG#3", SK: "META" },
];

// A fake src client: one Scan page, no pagination, no taxonomy fields.
function makeFakeSrc(): DocClientLike {
  return {
    send: (async (cmd: unknown) => {
      if (cmd instanceof ScanCommand) {
        return { Items: SRC_ITEMS, LastEvaluatedKey: undefined };
      }
      throw new Error(`fake src client: unexpected command ${(cmd as { constructor: { name: string } }).constructor.name}`);
    }) as DynamoDBDocumentClient["send"],
  };
}

// Fake dest client: first BatchWrite call reports the last item as
// UnprocessedItems; the retry call succeeds fully.
function makeFakeDestEventuallySucceeds(): { client: DocClientLike; getCalls: () => number } {
  let calls = 0;
  const client: DocClientLike = {
    send: (async (cmd: unknown) => {
      if (cmd instanceof BatchWriteCommand) {
        calls++;
        const items = cmd.input.RequestItems?.[DEST_TABLE]?.map((r) => r.PutRequest?.Item) ?? [];
        if (calls === 1) {
          // Report the last item of the batch as unprocessed on the first attempt.
          const straggler = items[items.length - 1];
          return {
            UnprocessedItems: straggler
              ? { [DEST_TABLE]: [{ PutRequest: { Item: straggler } }] }
              : {},
          };
        }
        // Retry (and any subsequent call): everything succeeds.
        return { UnprocessedItems: {} };
      }
      throw new Error(`fake dest client: unexpected command ${(cmd as { constructor: { name: string } }).constructor.name}`);
    }) as DynamoDBDocumentClient["send"],
  };
  return { client, getCalls: () => calls };
}

// Fake dest client: ALWAYS reports the last item as unprocessed, never clears.
function makeFakeDestNeverClears(): { client: DocClientLike; getCalls: () => number } {
  let calls = 0;
  const client: DocClientLike = {
    send: (async (cmd: unknown) => {
      if (cmd instanceof BatchWriteCommand) {
        calls++;
        const items = cmd.input.RequestItems?.[DEST_TABLE]?.map((r) => r.PutRequest?.Item) ?? [];
        const straggler = items[items.length - 1];
        return {
          UnprocessedItems: straggler ? { [DEST_TABLE]: [{ PutRequest: { Item: straggler } }] } : {},
        };
      }
      throw new Error(`fake dest client: unexpected command ${(cmd as { constructor: { name: string } }).constructor.name}`);
    }) as DynamoDBDocumentClient["send"],
  };
  return { client, getCalls: () => calls };
}

async function main() {
  // (a) UnprocessedItems on first attempt, success on retry: written count
  // must still be correct (3), and the batch call must have happened twice
  // (initial + one retry) to prove the retry path actually ran.
  {
    const src = makeFakeSrc();
    const { client: dest, getCalls } = makeFakeDestEventuallySucceeds();

    const rep = await copyTable({
      src: { region: "local", table: SRC_TABLE },
      dest: { region: "local", table: DEST_TABLE },
      srcDocClient: src,
      destDocClient: dest,
    });

    check("retries UnprocessedItems and reports correct written count", rep.written === 3);
    check("scanned count is unaffected by the retry", rep.scanned === 3);
    check("the retry attempt actually happened (second BatchWrite call observed)", getCalls() === 2);
  }

  // (b) UnprocessedItems never clears: copyTable must throw, not silently
  // under-count. This is the data-loss-prevention guarantee.
  {
    const src = makeFakeSrc();
    const { client: dest, getCalls } = makeFakeDestNeverClears();

    let threw = false;
    let message = "";
    try {
      await copyTable({
        src: { region: "local", table: SRC_TABLE },
        dest: { region: "local", table: DEST_TABLE },
        srcDocClient: src,
        destDocClient: dest,
      });
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    }

    check("throws when UnprocessedItems never clears (no silent under-count)", threw);
    check("thrown error names the failed key (ORG#3) without logging item bodies", message.includes("ORG#3"));
    // 1 initial attempt + 5 retries = 6 calls total, per the documented backoff schedule.
    check("exhausts all retries before giving up (6 BatchWrite calls)", getCalls() === 6);
  }

  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
