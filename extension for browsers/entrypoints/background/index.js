export default defineBackground({
  type: 'classic',
  main() {
    importScripts('constants.js', 'model-limits.js', 'legacy-background.js');
  },
});
