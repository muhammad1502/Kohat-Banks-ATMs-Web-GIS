// Local server: the API plus the website in public/, with the same security headers vercel.json sets online.
import express from "express";
import { readFileSync } from "node:fs";
import app from "./src/app.js";

const { headers } = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url)));
const port = Number(process.env.PORT) || 3000;

const site = express();
site.disable("x-powered-by");
site.use((req, res, next) => {
  for (const { key, value } of headers[0].headers) {
    // HSTS and the https upgrade would break plain http://localhost.
    if (key === "Strict-Transport-Security") continue;
    res.set(key, value.replace("; upgrade-insecure-requests", ""));
  }
  next();
});
site.use(app);
site.use(express.static("public", { extensions: ["html"] }));
site.use((req, res) => res.status(404).sendFile("404.html", { root: "public" }));

site.listen(port, () => console.log(`Kohat Banks and ATMs running at http://localhost:${port}`));
