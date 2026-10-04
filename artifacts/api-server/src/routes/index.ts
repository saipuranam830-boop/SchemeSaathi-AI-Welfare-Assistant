import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import schemesRouter from "./schemes";
import profileRouter from "./profile";
import eligibilityRouter from "./eligibility";
import assistantRouter from "./assistant";
import savedRouter from "./saved";
import documentsRouter from "./documents";
import deadlinesRouter from "./deadlines";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(schemesRouter);
router.use(profileRouter);
router.use(eligibilityRouter);
router.use(assistantRouter);
router.use(savedRouter);
router.use(documentsRouter);
router.use(deadlinesRouter);
router.use(adminRouter);

export default router;
