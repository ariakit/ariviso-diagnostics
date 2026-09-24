import { writeScenario } from "./scenario.mjs";

await writeScenario({
  repository: process.env.GITHUB_REPOSITORY,
  testedSha: process.env.GITHUB_SHA,
  token: process.env.GH_TOKEN,
});
