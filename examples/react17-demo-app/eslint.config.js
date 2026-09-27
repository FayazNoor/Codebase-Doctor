const react = require("eslint-plugin-react");
const globals = require("globals");

module.exports = [
  {
    files: ["src/**/*.{js,jsx}"],
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.jest },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      "react/prop-types": "off",
      "no-unused-vars": "error",
      "no-undef": "error",
    },
  },
];
