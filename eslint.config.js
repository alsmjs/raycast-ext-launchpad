const raycastConfig = require("@raycast/eslint-config");

module.exports = [
  { ignores: ["dist/**", "coverage/**", "raycast-env.d.ts"] },
  ...raycastConfig,
];
