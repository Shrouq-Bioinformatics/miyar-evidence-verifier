import { Router, type IRouter } from "express";
import healthRouter from "./health";
import verifyRouter from "./verify";
import casesRouter from "./cases";
import workspacesRouter from "./workspaces";
import workspaceDataRouter from "./workspace-data";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireAuth, verifyRouter);
router.use(requireAuth, casesRouter);
router.use(requireAuth, workspacesRouter);
router.use(requireAuth, workspaceDataRouter);

export default router;
