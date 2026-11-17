export default defineBackground({
  type: 'classic',
  main() {
    importScripts('constants.js', 'model-limits.js', 'learning.js', 'legacy-background.js');
  },
});
