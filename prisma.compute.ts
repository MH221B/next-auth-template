import { defineComputeConfig } from "@prisma/compute-sdk/config";

export default defineComputeConfig({
  app: {
    name: "next-auth-template",
    framework: "nextjs",
    env: ".env",
  },
});
