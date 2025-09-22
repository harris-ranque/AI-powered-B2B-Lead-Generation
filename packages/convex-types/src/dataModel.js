const path = require("path");
const fs = require("fs");

let cached;

function loadGeneratedDataModel() {
  if (cached) {
    return cached;
  }

  const generatedDataModelPath = path.resolve(__dirname, "_generated/dataModel.js");
  if (fs.existsSync(generatedDataModelPath)) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    cached = require(generatedDataModelPath);
    return cached;
  }

  cached = {
    __isFallback: true,
  };

  return cached;
}

module.exports = loadGeneratedDataModel();
module.exports.loadGeneratedDataModel = loadGeneratedDataModel;
module.exports.isFallback = Boolean(module.exports.__isFallback);
