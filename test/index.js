<script>
document.addEventListener("mousemove", (e) => {
  const panels = document.querySelectorAll(".liquid-glass-panel");
  const x = (e.clientX / window.innerWidth - 0.5) * 2; // -1 to 1
  const y = (e.clientY / window.innerHeight - 0.5) * 2;

  panels.forEach(panel => {
    const rotateX = y * 10;  // adjust for sensitivity
    const rotateY = -x * 10;
    const translateZ = (Math.abs(x) + Math.abs(y)) * 10;

    panel.style.transform = `
      rotateX(${rotateX}deg)
      rotateY(${rotateY}deg)
      translateZ(${translateZ}px)
    `;
  });
});
</script>
