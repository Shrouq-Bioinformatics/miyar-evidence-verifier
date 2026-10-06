import { Router, type IRouter } from "express";
import {
  VerifyPublicContentBody,
  VerifyPublicContentResponse,
} from "@workspace/api-zod";
import { verifyPublicContent } from "../lib/public-verifier";

const router: IRouter = Router();

router.post("/verify/public", async (req, res): Promise<void> => {
  const parsed = VerifyPublicContentBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.content.trim()) {
    res.status(400).json({ error: "ألصق محتوى صالحًا للتحقق منه." });
    return;
  }

  try {
    const result = await verifyPublicContent(parsed.data.content);
    res.json(VerifyPublicContentResponse.parse(result));
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : undefined;
    req.log.error(
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        upstreamStatus: status,
      },
      "Public verification failed",
    );
    res.status(500).json({
      error: "تعذر إكمال التحقق حاليًا. أعد المحاولة بعد قليل.",
    });
  }
});

export default router;
