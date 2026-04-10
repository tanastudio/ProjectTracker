import { runProvisionUsers } from "./provision-users.mjs";

runProvisionUsers("candidates").catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
