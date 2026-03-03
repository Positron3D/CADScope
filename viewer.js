import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.161.0/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'https://unpkg.com/three@0.161.0/examples/jsm/loaders/DRACOLoader.js';

const canvas = document.getElementById('viewer');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth, canvas.clientHeight);

const scene = new THREE.Scene();

// Dark mode
const LIGHT_BG = 0xFFFFFF;
const DARK_BG = 0x1a1a1a;
const isDark = localStorage.getItem('darkMode') !== 'false';
if (isDark) document.body.classList.add('dark');
scene.background = new THREE.Color(isDark ? DARK_BG : LIGHT_BG);

document.getElementById('darkModeToggle').addEventListener('click', () => {
  const dark = document.body.classList.toggle('dark');
  localStorage.setItem('darkMode', dark);
  scene.background.set(dark ? DARK_BG : LIGHT_BG);
  document.getElementById('darkModeToggle').innerHTML = dark ? '&#9788;' : '&#9790;';
});
document.getElementById('darkModeToggle').innerHTML = isDark ? '&#9788;' : '&#9790;';

const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
camera.position.set(2, 2, 2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Store model bounds globally for view controls
let modelCenter = new THREE.Vector3();
let modelSize = 1;

const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.75);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.75);
dir.position.set(5, 10, 7);
scene.add(dir);
//const ambient = new THREE.AmbientLight(0xffffff, 0.3);
//scene.add(ambient);

// Draco loader for compressed geometry
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
dracoLoader.setDecoderConfig({ type: 'js' });

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

let currentModel = null;
// Per-category state: category name -> array of meshes / color picker input
const categoryMeshes = new Map();
const categoryPickers = new Map();

// URL query string support
function modelStem(path) {
  return path.split('/').pop().replace(/\.glb$/, '');
}

function updateURL() {
  const params = new URLSearchParams();
  const path = document.getElementById('modelSelect').value;
  params.set('model', modelStem(path));
  if (document.getElementById('colorControls').style.display !== 'none') {
    for (const [name, picker] of categoryPickers) {
      if (name !== 'model') {
        params.set(name, picker.value.slice(1));
      }
    }
  }
  history.replaceState(null, '', '?' + params.toString());
}

const urlParams = new URLSearchParams(window.location.search);
const urlModel = urlParams.get('model');
if (urlModel) {
  const select = document.getElementById('modelSelect');
  for (const opt of select.options) {
    if (modelStem(opt.value) === urlModel) {
      select.value = opt.value;
      break;
    }
  }
}
// URL color overrides are consumed once on initial load, then cleared
let urlColorsConsumed = false;

// Populate URL immediately with current model selection
updateURL();

document.getElementById('copyLinkBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href).then(() => {
    const btn = document.getElementById('copyLinkBtn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
});

function cleanNodeName(name) {
  if (!name) return '';
  // Strip path prefixes (keep text after last /)
  let cleaned = name.includes('/') ? name.substring(name.lastIndexOf('/') + 1) : name;
  // Remove .step suffix (case-insensitive, preserving -N numeric suffixes)
  cleaned = cleaned.replace(/\.step/i, '');
  // Remove (mesh) and (group) suffixes
  cleaned = cleaned.replace(/\s*\(mesh\)\s*/i, '').replace(/\s*\(group\)\s*/i, '');
  // Blender replaces spaces with underscores in object names on import
  cleaned = cleaned.replace(/ /g, '_');
  return cleaned.trim();
}

function stripNumericSuffix(name) {
  return name.replace(/-\d+$/, '');
}

function applyColorSet(colorSet, model) {
  categoryMeshes.clear();

  // Build per-category part sets and colors
  const categories = [];
  for (const [name, cat] of Object.entries(colorSet.categories)) {
    const partSet = new Set(cat.parts || []);
    categories.push({ name, partSet, color: new THREE.Color(cat.color) });
    categoryMeshes.set(name, []);
  }

  // First-match semantics: earlier categories win
  model.traverse((obj) => {
    if (!obj.isMesh) return;

    const cleaned = cleanNodeName(obj.name);
    const stripped = stripNumericSuffix(cleaned);
    const parentCleaned = obj.parent ? cleanNodeName(obj.parent.name) : '';

    for (const cat of categories) {
      if (cat.partSet.has(cleaned) || cat.partSet.has(stripped) || cat.partSet.has(parentCleaned)) {
        obj.material = obj.material.clone();
        obj.material.color.copy(cat.color);
        categoryMeshes.get(cat.name).push(obj);
        break;
      }
    }
  });
}

function loadColorSet(path, model) {
  const colorPath = path.replace(/\.glb$/, '.colors.json');
  const colorControls = document.getElementById('colorControls');

  fetch(colorPath).then((res) => {
    if (!res.ok) {
      colorControls.style.display = 'none';
      updateURL();
      return;
    }
    return res.json();
  }).then((colorSet) => {
    if (!colorSet) return;

    applyColorSet(colorSet, model);

    // Build color picker UI dynamically from categories
    colorControls.innerHTML = '';
    categoryPickers.clear();
    for (const [name, cat] of Object.entries(colorSet.categories)) {
      const row = document.createElement('div');
      row.className = 'color-row';

      const label = document.createElement('label');
      label.textContent = name;

      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = cat.color;

      // Apply URL override on first load
      if (!urlColorsConsumed && name !== 'model') {
        const urlVal = urlParams.get(name);
        if (urlVal) {
          const override = '#' + urlVal;
          picker.value = override;
          const c = new THREE.Color(override);
          (categoryMeshes.get(name) || []).forEach((mesh) => { mesh.material.color.copy(c); });
        }
      }

      picker.addEventListener('input', () => {
        const c = new THREE.Color(picker.value);
        (categoryMeshes.get(name) || []).forEach((mesh) => { mesh.material.color.copy(c); });
        updateURL();
      });

      row.appendChild(label);
      row.appendChild(picker);
      colorControls.appendChild(row);
      categoryPickers.set(name, picker);
    }

    urlColorsConsumed = true;
    colorControls.style.display = '';
    updateURL();
  }).catch(() => {
    colorControls.style.display = 'none';
    updateURL();
  });
}

function loadModel(path) {
  // Remove previous model
  if (currentModel) {
    scene.remove(currentModel);
  }

  // Hide color controls while loading
  document.getElementById('colorControls').style.display = 'none';

  // Show loading overlay
  let overlay = document.getElementById('loadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.innerHTML = '<div class="spinner"></div><p id="loadingText">Loading model...</p>';
    document.body.appendChild(overlay);
  }
  document.getElementById('loadingText').textContent = 'Loading model...';

  gltfLoader.load(path, (gltf) => {
    currentModel = gltf.scene;
    scene.add(currentModel);

    const box = new THREE.Box3().setFromObject(currentModel);
    modelSize = box.getSize(new THREE.Vector3()).length();
    modelCenter = box.getCenter(new THREE.Vector3());

    controls.target.copy(modelCenter);
    camera.position.copy(modelCenter).add(new THREE.Vector3(modelSize, modelSize, modelSize));
    camera.updateProjectionMatrix();

    buildTree(currentModel);
    loadColorSet(path, currentModel);
    document.getElementById('loadingOverlay').remove();
  }, (progress) => {
    if (progress.total) {
      const pct = (progress.loaded / progress.total * 100).toFixed(0);
      document.getElementById('loadingText').textContent = `Loading model... ${pct}%`;
    }
  }, (error) => {
    console.error('Error loading model:', error);
    document.getElementById('loadingText').textContent = 'Failed to load model.';
  });
}

window.loadModel = loadModel;

// Load the initially selected model
loadModel(document.getElementById('modelSelect').value);

function buildTree(sceneRoot) {
  const treeContainer = document.getElementById('tree');
  treeContainer.innerHTML = '';

  // Skip the glTF "Scene" wrapper — start from its first child
  const root = (sceneRoot.children.length === 1 && sceneRoot.name === 'Scene')
    ? sceneRoot.children[0]
    : sceneRoot;

  function createTreeItem(obj, parentElement, depth = 0) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'tree-item';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'tree-item-content';

    // Toggle arrow for items with children
    const toggleSpan = document.createElement('span');
    toggleSpan.className = 'tree-toggle';
    if (obj.children && obj.children.length > 0) {
      toggleSpan.textContent = depth === 0 ? '▼' : '▶';
    }
    contentDiv.appendChild(toggleSpan);

    // Visibility checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'tree-checkbox';
    checkbox.checked = obj.visible;
    checkbox.addEventListener('change', (e) => {
      obj.visible = e.target.checked;
      if (e.target.checked) {
        itemDiv.classList.remove('hidden');
      } else {
        itemDiv.classList.add('hidden');
      }
    });
    contentDiv.appendChild(checkbox);

    // Object name
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = obj.name || obj.type || 'Object';
    contentDiv.appendChild(label);

    itemDiv.appendChild(contentDiv);

    // Children container
    if (obj.children && obj.children.length > 0) {
      const childrenDiv = document.createElement('div');
      childrenDiv.className = 'tree-children' + (depth === 0 ? ' expanded' : '');

      // Add toggle functionality
      toggleSpan.addEventListener('click', () => {
        childrenDiv.classList.toggle('expanded');
        toggleSpan.textContent = childrenDiv.classList.contains('expanded') ? '▼' : '▶';
      });

      // Recursively add children
      obj.children.forEach(child => {
        createTreeItem(child, childrenDiv, depth + 1);
      });

      itemDiv.appendChild(childrenDiv);
    }

    parentElement.appendChild(itemDiv);
  }

  createTreeItem(root, treeContainer);
}

// View control function
window.setView = function(view) {
  const distance = modelSize * 1.5;
  controls.target.copy(modelCenter);

  switch(view) {
    case 'top':
      camera.position.set(modelCenter.x, modelCenter.y + distance, modelCenter.z);
      camera.up.set(0, 0, -1);
      break;
    case 'bottom':
      camera.position.set(modelCenter.x, modelCenter.y - distance, modelCenter.z);
      camera.up.set(0, 0, 1);
      break;
    case 'front':
      camera.position.set(modelCenter.x, modelCenter.y, modelCenter.z + distance);
      camera.up.set(0, 1, 0);
      break;
    case 'back':
      camera.position.set(modelCenter.x, modelCenter.y, modelCenter.z - distance);
      camera.up.set(0, 1, 0);
      break;
    case 'right':
      camera.position.set(modelCenter.x + distance, modelCenter.y, modelCenter.z);
      camera.up.set(0, 1, 0);
      break;
    case 'left':
      camera.position.set(modelCenter.x - distance, modelCenter.y, modelCenter.z);
      camera.up.set(0, 1, 0);
      break;
    case 'iso':
      camera.position.set(
        modelCenter.x + distance * 0.7,
        modelCenter.y + distance * 0.7,
        modelCenter.z + distance * 0.7
      );
      camera.up.set(0, 1, 0);
      break;
    case 'home':
      camera.position.set(
        modelCenter.x + modelSize,
        modelCenter.y + modelSize,
        modelCenter.z + modelSize
      );
      camera.up.set(0, 1, 0);
      break;
  }

  camera.lookAt(modelCenter);
  camera.updateProjectionMatrix();
  controls.update();
};

// Zoom function
window.zoom = function(factor) {
  // Calculate direction from target to camera
  const direction = new THREE.Vector3();
  direction.subVectors(camera.position, controls.target);

  // Scale the direction by the factor
  const newDistance = direction.length() * (1 + factor);

  // Prevent zooming too close or too far
  const minDistance = modelSize * 0.1;
  const maxDistance = modelSize * 10;

  if (newDistance >= minDistance && newDistance <= maxDistance) {
    direction.normalize().multiplyScalar(newDistance);
    camera.position.copy(controls.target).add(direction);
    camera.updateProjectionMatrix();
  }
};

// Reset zoom to default distance
window.resetZoom = function() {
  const direction = new THREE.Vector3();
  direction.subVectors(camera.position, controls.target).normalize();
  camera.position.copy(controls.target).add(direction.multiplyScalar(modelSize * 1.5));
  camera.updateProjectionMatrix();
};

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});
