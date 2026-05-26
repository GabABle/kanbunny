/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "flowjoe",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    new sst.aws.TanstackStart("Web", {
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL!,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY!,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL!,
        VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
        VITE_SUPABASE_PROJECT_ID: process.env.VITE_SUPABASE_PROJECT_ID!,
      },
    });
  },
});