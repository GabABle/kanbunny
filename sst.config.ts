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
    const web = new sst.aws.TanStackStart("Web", {
      server: {
        streaming: false,
      },
      environment: {
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL!,
        VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
        VITE_SUPABASE_PROJECT_ID: process.env.VITE_SUPABASE_PROJECT_ID!,
      },
    });

    return {
      url: web.url,
    };
  },
});