"use strict";

const path = require("path");

module.exports = function isDescendant(root, candidate, paths = path) {
  const relative = paths.relative(root, candidate);
  // Exclude the root itself, parent escapes, and other Windows drives.
  return relative !== "" && relative !== ".." &&
    !relative.startsWith(".." + paths.sep) && !paths.isAbsolute(relative);
};
