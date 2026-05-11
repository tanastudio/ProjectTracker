import { runProvisionUsers } from "./provision-users.mjs";

runProvisionUsers("participants").catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
