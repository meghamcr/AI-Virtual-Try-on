import { initStorage } from "../apps/api/src/storage";
await initStorage();
console.log("Private image bucket ready; no public access policy installed.");
