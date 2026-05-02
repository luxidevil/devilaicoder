import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";
import { requireAdmin } from "./middlewares/admin-auth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "75mb" }));
app.use(express.urlencoded({ extended: true, limit: "75mb" }));

app.use("/api", requireAdmin, router);

if (process.env.NODE_ENV === "production") {
  const feDistPath = path.resolve(__dirname, "../../luxi-ide/dist/public");
  app.use(express.static(feDistPath));
  app.use((_req, res, next) => {
    if (_req.path.startsWith("/api")) return next();
    res.sendFile(path.join(feDistPath, "index.html"));
  });
}

export default app;
