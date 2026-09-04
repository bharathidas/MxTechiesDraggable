const base = require("@mendix/pluggable-widgets-tools/configs/eslint.ts.base.json");

module.exports = {
    ...base,
    ignorePatterns: ["dist/**", "node_modules/**"]
};
