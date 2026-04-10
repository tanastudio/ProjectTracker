import { runProvisionUsers } from "./provision-users.mjs";

runProvisionUsers("test-users").catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
