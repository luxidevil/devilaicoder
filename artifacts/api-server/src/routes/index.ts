import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import filesRouter from "./files";
import aiRouter from "./ai";
import agentRouter from "./ai/agent";
import adminRouter from "./admin";
import conversationsRouter from "./conversations";
import snapshotsRouter from "./snapshots";
import secretsRouter from "./secrets";
import githubRouter from "./github";
import findingsRouter from "./findings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(filesRouter);
router.use(aiRouter);
router.use(agentRouter);
router.use(adminRouter);
router.use(conversationsRouter);
router.use(snapshotsRouter);
router.use(secretsRouter);
router.use(githubRouter);
router.use(findingsRouter);

export default router;
