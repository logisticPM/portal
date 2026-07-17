// Tiny operator helper: list ca-central-1 DynamoDB tables matching the
// `indigenomics-portal-ca-` prefix so an operator can see what the `ca` SST
// stage actually deployed (physical names carry a random SST-generated
// suffix that's only known after deploy).
//
// Counts/names only — this script never touches item data.
//
//   Run: AWS_REGION=ca-central-1 npx tsx scripts/list-ca-tables.ts
//   (or: npm run ca:tables)
import {
  DynamoDBClient,
  ListTablesCommand,
  // @ts-ignore: package may be resolved at runtime / installed in the environment
} from "@aws-sdk/client-dynamodb";

const REGION = "ca-central-1";
const PREFIX = "indigenomics-portal-ca-";

async function listAllTableNames(region: string): Promise<string[]> {
  const client = new DynamoDBClient({ region });
  const names: string[] = [];
  let ExclusiveStartTableName: string | undefined;
  do {
    const res = await client.send(new ListTablesCommand({ ExclusiveStartTableName }));
    names.push(...(res.TableNames ?? []));
    ExclusiveStartTableName = res.LastEvaluatedTableName;
  } while (ExclusiveStartTableName);
  return names;
}

async function main(): Promise<void> {
  console.log(`list-ca-tables: listing tables in ${REGION} matching prefix "${PREFIX}"`);
  const allNames = await listAllTableNames(REGION);
  const matching = allNames.filter((n) => n.startsWith(PREFIX));

  if (matching.length === 0) {
    console.log(`No tables found with prefix "${PREFIX}" in ${REGION}. Has the "ca" stage been deployed?`);
    return;
  }

  console.log(`Found ${matching.length} table(s):`);
  for (const name of matching) {
    console.log(`  ${name}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
