// Runnable entry for the survey seed loader.
//   Local:  npm run survey:seed
//   Cloud:  npm run survey:seed:cloud
import { seedSurvey } from "../src/lib/survey/seed";

async function main() {
  const n = await seedSurvey();
  console.log(`✅ seeded ${n.organizations} organizations, ${n.responses} survey responses`);
}

main().catch((e) => {
  console.error("❌ survey seed failed:", e);
  process.exit(1);
});
