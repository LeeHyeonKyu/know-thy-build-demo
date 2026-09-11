import express from "express";
const app = express();
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
const port = process.env.PORT ?? 3000;
app.listen(port, () => console.log(`listening on ${port}`));
