import serverless from "serverless-http";
import { createApp } from "./app";

/**
 * AWS Lambda entry point — wraps the same Express app that `src/index.ts`
 * serves locally, so route/middleware behaviour is identical in both
 * environments. Deployed behind an API Gateway HTTP API (payload v2).
 *
 * Binary content types must be listed so serverless-http base64-encodes
 * them for API Gateway (student photos are served as raw image bytes).
 *
 * The Express app (and its Prisma client / document-store client) is
 * created once per Lambda container and reused across invocations.
 */
export const handler = serverless(createApp(), {
  binary: ["image/*", "application/pdf", "application/octet-stream", "font/*"],
});
