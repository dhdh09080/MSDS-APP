let capturePromise;

// Image capture is only needed after the user asks to save an image.
export function loadCaptureLibrary() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (capturePromise) return capturePromise;
  capturePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => finish(new Error('이미지 모듈 연결 시간이 초과됐습니다. 다시 시도해주세요.')), 20000);
    function finish(error) {
      clearTimeout(timeout);
      script.onload = script.onerror = null;
      if (error) {
        script.remove();
        capturePromise = null;
        reject(error);
      } else resolve(window.html2canvas);
    }
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    script.async = true;
    script.onload = () => finish(window.html2canvas ? null : new Error('이미지 모듈을 불러오지 못했습니다. 다시 시도해주세요.'));
    script.onerror = () => finish(new Error('이미지 모듈을 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해주세요.'));
    document.head.append(script);
  });
  return capturePromise;
}
