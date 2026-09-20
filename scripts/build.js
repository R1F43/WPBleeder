const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (target !== 'chrome' && target !== 'firefox') {
  console.error('Error: Please specify target browser: chrome or firefox');
  process.exit(1);
}

console.log(`Building WPBleeder for ${target}...`);

const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist', target);

// Utility: deep merge objects
function isObject(item) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

function merge(targetObj, sourceObj) {
  const output = Object.assign({}, targetObj);
  if (isObject(targetObj) && isObject(sourceObj)) {
    Object.keys(sourceObj).forEach(key => {
      if (isObject(sourceObj[key])) {
        if (!(key in targetObj)) {
          Object.assign(output, { [key]: sourceObj[key] });
        } else {
          output[key] = merge(targetObj[key], sourceObj[key]);
        }
      } else {
        // Overwrite arrays and primitives directly
        Object.assign(output, { [key]: sourceObj[key] });
      }
    });
  }
  return output;
}

// 1. Merge Manifests
console.log('Merging manifests...');
const manifestCommonPath = path.join(srcDir, 'manifest', 'manifest.common.json');
const manifestTargetPath = path.join(srcDir, 'manifest', `manifest.${target}.json`);

const manifestCommon = JSON.parse(fs.readFileSync(manifestCommonPath, 'utf8'));
let manifestTarget = {};
if (fs.existsSync(manifestTargetPath)) {
  manifestTarget = JSON.parse(fs.readFileSync(manifestTargetPath, 'utf8'));
}

const finalManifest = merge(manifestCommon, manifestTarget);

// 2. Prepare Output Directory
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// 3. Write Final Manifest
fs.writeFileSync(
  path.join(distDir, 'manifest.json'),
  JSON.stringify(finalManifest, null, 2)
);

// 4. Copy Project Directories
console.log('Copying directories...');
const dirsToCopy = [
  { src: 'src/background', dest: 'background' },
  { src: 'src/content', dest: 'content' },
  { src: 'src/panel', dest: 'panel' },
  { src: 'src/options', dest: 'options' },
  { src: 'src/platform', dest: 'platform' },
  { src: 'src/lib', dest: 'lib' },
  { src: 'data', dest: 'data' },
  { src: 'icons', dest: 'icons' }
];

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  
  if (isDirectory) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(childItemName => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else if (exists) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

dirsToCopy.forEach(dir => {
  const source = path.join(rootDir, dir.src);
  const destination = path.join(distDir, dir.dest);
  if (fs.existsSync(source)) {
    copyRecursiveSync(source, destination);
  }
});

console.log(`Build complete! Output directory: dist/${target}`);
