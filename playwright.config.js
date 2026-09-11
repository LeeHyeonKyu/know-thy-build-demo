export default {
  testDir: "e2e",
  use: { baseURL: "http://localhost:3000", headless: true },
  webServer: { command: "node src/app.js", url: "http://localhost:3000/healthz", timeout: 30_000 },
  reporter: [["json", { outputFile: ".spike/e2e.json" }]],
};
