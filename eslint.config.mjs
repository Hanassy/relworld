// Minimal lint pass for the game: no build, no dependencies beyond eslint.
//   npx eslint src/game.js tests/smoke.js
const browser = [
  'window', 'document', 'navigator', 'localStorage', 'performance', 'console',
  'requestAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'KeyboardEvent', 'SpeechSynthesisUtterance', 'ResizeObserver'
];
const node = ['require', 'module', '__dirname', 'process', 'Promise'];
const globals = list => Object.fromEntries(list.map(name => [name, 'readonly']));

export default [
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2021, sourceType: 'script', globals: globals(browser) },
    rules: {
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-func-assign': 'error',
      'no-fallthrough': 'error',
      'no-cond-assign': 'error',
      'no-constant-condition': 'error',
      'no-self-compare': 'error',
      'no-unreachable': 'error',
      'no-unsafe-negation': 'error',
      // empty catch bindings are deliberate: storage and audio are best-effort
      'no-unused-vars': ['warn', { caughtErrors: 'none' }]
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021, sourceType: 'script',
      globals: globals([...browser, ...node])
    },
    rules: { 'no-undef': 'error', 'no-unused-vars': 'warn' }
  }
];
