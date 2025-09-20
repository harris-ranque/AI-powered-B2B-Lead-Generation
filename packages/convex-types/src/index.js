const path = require("path");
const fs = require("fs");

let cached;

const FALLBACK_REFERENCE_MAP = {
  "profile.queries.getBusinessProfile": "profile:get",
  "users.queries.getCurrentUserData": "users:getCurrentUser",
  "search.queries.getUserSearches": "searches:getUserSearches",
  "leads.queries.getLeadsBySearch": "leads:getBySearch",
};

function createStubNamespace(segments) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === Symbol.toStringTag) {
          return "ConvexReferenceStub";
        }

        if (prop === "toString" || prop === "valueOf") {
          return () => segments.join(".");
        }

        if (prop === Symbol.toPrimitive) {
          return (hint) => {
            if (hint === "number") {
              return NaN;
            }
            return segments.join(".");
          };
        }

        const key = String(prop);
        const nextSegments = [...segments, key];

        if (
          nextSegments.length >= 4 &&
          (nextSegments[0] === "api" || nextSegments[0] === "internal")
        ) {
          const moduleName = nextSegments[1];
          const qualifier = nextSegments.slice(2).join(".");
          const mapped = FALLBACK_REFERENCE_MAP[`${moduleName}.${qualifier}`];

          if (mapped) {
            return mapped;
          }

          const functionName = nextSegments[nextSegments.length - 1];
          return `${moduleName}:${functionName}`;
        }

        return createStubNamespace(nextSegments);
      },
    },
  );
}

function loadGeneratedApi() {
  if (cached) {
    return cached;
  }

  const generatedApiPath = path.resolve(__dirname, "_generated/api.js");

  if (fs.existsSync(generatedApiPath)) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    cached = require(generatedApiPath);
    return cached;
  }

  if (!process.env.GENNI_SILENCE_CONVEX_WARNINGS && process.env.NODE_ENV !== "production") {
    console.warn(
      "[genni/convex-types] Convex generated API not found. " +
        "Falling back to test stubs. Run `npx convex codegen` to generate real types.",
    );
  }

  const fallbackApi = createStubNamespace(["api"]);
  const fallbackInternal = createStubNamespace(["internal"]);

  cached = {
    api: fallbackApi,
    internal: fallbackInternal,
    __isFallback: true,
  };

  return cached;
}

const generated = loadGeneratedApi();

module.exports = {
  ...generated,
  loadGeneratedApi,
  isFallback: Boolean(generated.__isFallback),
};
