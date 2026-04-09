import { startServer } from "./server.js";

startServer()
  .then((app) => {
    const address = app.addresses()[0];
    console.log(`backend ready at ${typeof address === "string" ? address : `${address.address}:${address.port}`}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
