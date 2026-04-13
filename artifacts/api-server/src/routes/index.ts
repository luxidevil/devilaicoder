import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import filesRouter from "./files";
import aiRouter from "./ai";
import agentRouter from "./ai/agent";
import adminRouter from "./admin";
import conversationsRouter from "./conversations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(filesRouter);
router.use(aiRouter);
router.use(agentRouter);
router.use(adminRouter);
router.use(conversationsRouter);

export default router;
