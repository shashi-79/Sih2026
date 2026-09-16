/**
 * One-time microphone permission handler for extension origin
 */
document.addEventListener('DOMContentLoaded', () => {
  const grantBtn = document.getElementById('grantBtn');
  const statusDiv = document.getElementById('status');

  if (grantBtn) {
    grantBtn.addEventListener('click', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        if (statusDiv) statusDiv.style.display = 'block';
        grantBtn.style.display = 'none';
        setTimeout(() => window.close(), 1600);
      } catch (err) {
        alert('Microphone permission was not granted: ' + err.message);
      }
    });
  }
});
