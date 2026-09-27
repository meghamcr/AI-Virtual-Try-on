// Browser-test entrypoint only. Never used by the production start command.
import express from "express";
import { app } from "../apps/api/src/app";
const fixture = express();
const garment =
  "https://cdn.shopify.com/s/files/1/2341/3995/files/TCW6233-4161-jasper-treeblend-tank-dress_2.jpg?v=1745961649";
fixture.get("/fixture-product", (_req, res) =>
  res
    .type("html")
    .send(
      `<!doctype html><title>Test garment fixture</title><script type="application/ld+json">{"@type":"Product","name":"Browser test dress","url":"http://localhost:4000/fixture-product","image":"${garment}","offers":{"price":"42","priceCurrency":"USD"}}</script><main><h1>Browser test dress</h1><img src="${garment}" width="600" height="750" alt="Dress reference"></main>`,
    ),
);
fixture.use(app);
const server = fixture.listen(4000, "127.0.0.1", () =>
  console.log("Fixture API listening"),
);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
