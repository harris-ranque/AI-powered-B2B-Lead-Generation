const { ConvexHttpClient } = require("convex/browser");
const client = new ConvexHttpClient(process.env.CONVEX_URL);

(async () => {
  try {
    const search = await client.query("search/queries:getSearch", {
      searchId: "k977r8hee5d91svr5q8227hfa97p1ppb",
    });
    console.log("Search status:", search?.status);
    console.log("Search results:", search?.results);
    console.log("Search progress:", search?.progress);
  } catch (error) {
    console.log("Error:", error.message);
  }
})();
