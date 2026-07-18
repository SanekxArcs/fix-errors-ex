// `electron .` reads ELECTRON_RUN_AS_NODE from the environment and, if set,
// boots as a plain Node process instead of the Electron runtime (Chromium,
// app/BrowserWindow APIs, etc. all become unavailable). Some dev setups leave
// that variable set globally, which silently breaks `npm start` with an
// "app is undefined" crash. Clear it before spawning so `npm start` works
// regardless of the parent shell's environment.
const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('Failed to launch Electron:', err);
  process.exit(1);
});
