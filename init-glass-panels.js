// init-glass-panels.js
// Initializes Three.js physical glass panels for all .liquid-glass-panel elements

import { createGlassPanel } from './glassPanelComponent.js';

async function initPanels() {
  const panels = document.querySelectorAll('.liquid-glass-panel');
  const controllers = [];

  // Disable CSS glass effects when Three.js loads (prevents double-glass)
  document.body.classList.add('glass-three-active');

  // Find video element for direct texture
  const videoElement = document.querySelector('video.background-video');

  for (const panel of panels) {
    // Ensure relative positioning for canvas containment
    if (getComputedStyle(panel).position === 'static') {
      panel.style.position = 'relative';
    }

    // Ensure content-layer is above canvas
    const contentLayer = panel.querySelector('.content-layer');
    if (contentLayer) {
      contentLayer.style.position = 'relative';
      contentLayer.style.zIndex = '10';
    }

    const controller = await createGlassPanel({
      attachToElement: panel,
      borderRadius: 44,
      resolutionMultiplier: 1.0,
      // Physical glass parameters — subtle but visible refraction
      ior: 1.52,
      thickness: 4.2,
      absorption: 0.022,
      dispersion: 0.05,
      curvature: 0.004,
      refractionStrength: 0.08,
      tiltAmount: 0.04,
      mouseInfluence: 1.0,
      zIndex: 0,
      videoElement: videoElement,
    });

    // Store controller reference on element for modal access
    panel._glassController = controller;
    controllers.push({ panel, controller, isModal: panel.closest('#contactModal') !== null });
  }

  // Expose controllers globally for modal integration
  window.glassPanels = controllers;

  // Modal integration
  const modalEntry = controllers.find(c => c.isModal);
  if (modalEntry && window.optimizer) {
    const { controller } = modalEntry;
    const modalOverlay = document.getElementById('contactModal');

    // Initially hide the modal panel canvas
    controller.hide();

    // Replace optimizer's openModal/closeModal
    window.optimizer.openModal = () => {
      if (modalOverlay) {
        modalOverlay.classList.remove('opacity-0', 'invisible');
      }
      controller.show();
    };

    window.optimizer.closeModal = () => {
      if (modalOverlay) {
        modalOverlay.classList.add('opacity-0', 'invisible');
      }
      controller.hide();
    };
  }

  // Disable optimizer's CSS panel mouse handling (Three.js handles its own)
  if (window.optimizer) {
    window.optimizer.panels = [];
  }

  console.log(`[Glass] Initialized ${controllers.length} refractive glass panel(s)`);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPanels);
} else {
  initPanels();
}
