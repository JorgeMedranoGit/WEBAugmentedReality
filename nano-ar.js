const workerCode = `
  importScripts('https://docs.opencv.org/4.8.0/opencv.js');

  let cvReady = false;
  let targets = []; 
  
  // 1000 características para buscar hasta el más mínimo detalle en las letras
  const MAX_FEATURES = 1000; 
  const PROCESS_WIDTH = 320; 
  
  let orb, matcher;

  cv.onRuntimeInitialized = () => {
    // Inicialización estándar para no crashear WebAssembly
    orb = new cv.ORB(MAX_FEATURES);
    matcher = new cv.DescriptorMatcher('BruteForce-Hamming');
    cvReady = true;
    self.postMessage({ type: 'READY' });
  };

  self.onmessage = function(e) {
    const msg = e.data;
    if (!cvReady) return;

    if (msg.type === 'REGISTER_TARGET') {
      let mat = cv.matFromImageData(msg.imageData);
      let gray = new cv.Mat();
      cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);

      // NUEVO: Ecualización de histograma global. 100% compatible y fuerza el contraste en fondos lisos
      cv.equalizeHist(gray, gray);

      // Compilador en RAM: 3 tamaños
      const scales = [1.0, 0.75, 0.5]; 
      
      for (let scale of scales) {
        let resized = new cv.Mat();
        cv.resize(gray, resized, new cv.Size(Math.round(gray.cols * scale), Math.round(gray.rows * scale)));

        let keypoints = new cv.KeyPointVector();
        let descriptors = new cv.Mat();
        orb.detectAndCompute(resized, new cv.Mat(), keypoints, descriptors);

        targets.push({
          id: msg.id,
          width: resized.cols, 
          height: resized.rows,
          scale: scale,
          keypoints: keypoints,
          descriptors: descriptors
        });

        resized.delete();
      }

      mat.delete(); gray.delete();
    } 
    
    else if (msg.type === 'PROCESS_FRAME') {
      let results = [];
      let src = cv.matFromImageData(msg.imageData);
      
      let scale = PROCESS_WIDTH / src.cols;
      let processHeight = Math.round(src.rows * scale);
      
      let smallSrc = new cv.Mat();
      cv.resize(src, smallSrc, new cv.Size(PROCESS_WIDTH, processHeight));

      let gray = new cv.Mat();
      cv.cvtColor(smallSrc, gray, cv.COLOR_RGBA2GRAY);

      // Ecualizar también el fotograma de la cámara para que coincida con la imagen de referencia
      cv.equalizeHist(gray, gray);

      let kp = new cv.KeyPointVector();
      let desc = new cv.Mat();
      orb.detectAndCompute(gray, new cv.Mat(), kp, desc);

      if (kp.size() > 0 && targets.length > 0) {
        let matchedIds = new Set(); 

        for (let target of targets) {
          if (matchedIds.has(target.id)) continue; 

          let matches = new cv.DMatchVector();
          matcher.match(target.descriptors, desc, matches);

          let goodMatches = [];
          for (let i = 0; i < matches.size(); i++) {
            let m = matches.get(i);
            // Tolerancia súper flexible (65)
            if (m.distance < 65) goodMatches.push(m);
          }

          // Límite de RANSAC bajado a 5 (casi el mínimo matemático de 4)
          if (goodMatches.length >= 5) {
            let objPts = [];
            let imgPts = [];

            for (let i = 0; i < goodMatches.length; i++) {
              objPts.push(target.keypoints.get(goodMatches[i].queryIdx).pt);
              imgPts.push(kp.get(goodMatches[i].trainIdx).pt);
            }

            let matObj = cv.matFromArray(objPts.length, 1, cv.CV_32FC2, [].concat(...objPts.map(p => [p.x, p.y])));
            let matImg = cv.matFromArray(imgPts.length, 1, cv.CV_32FC2, [].concat(...imgPts.map(p => [p.x, p.y])));
            
            // Reproyección geométrica con tolerancia de 5.0 píxeles de error
            let H = cv.findHomography(matObj, matImg, cv.RANSAC, 5.0);
            
            if (!H.empty()) {
              let cx = target.width / 2;
              let cy = target.height / 2;
              let hData = H.data64F;
              
              let w = hData[6]*cx + hData[7]*cy + hData[8];
              let px = (hData[0]*cx + hData[1]*cy + hData[2]) / w;
              let py = (hData[3]*cx + hData[4]*cy + hData[5]) / w;
              
              let fX = (px / PROCESS_WIDTH) * 2 - 1;
              let fY = -((py / processHeight) * 2 - 1); 
              let fovSpread = 4;

              let rotZ = Math.atan2(hData[3], hData[0]) * (180 / Math.PI);

              results.push({
                id: target.id,
                position: { x: fX * fovSpread, y: fY * fovSpread, z: -5 },
                rotation: { x: 0, y: 0, z: -rotZ } 
              });
              
              matchedIds.add(target.id);
              H.delete();
            }
            matObj.delete(); matImg.delete();
          }
          matches.delete();
        }
      }

      self.postMessage({ type: 'TRACKING_RESULTS', results: results });
      
      src.delete(); smallSrc.delete(); gray.delete(); kp.delete(); desc.delete();
    }
  };
`;

const blob = new Blob([workerCode], { type: 'application/javascript' });
const workerTracker = new Worker(URL.createObjectURL(blob));

AFRAME.registerSystem('nano-ar', {
  init: function () {
    this.video = document.createElement('video');
    this.video.setAttribute('autoplay', '');
    this.video.setAttribute('muted', '');
    this.video.setAttribute('playsinline', '');
    this.video.style.position = 'fixed';
    this.video.style.top = '0';
    this.video.style.left = '0';
    this.video.style.width = '100vw';
    this.video.style.height = '100vh';
    this.video.style.objectFit = 'cover';
    this.video.style.zIndex = '-2';
    document.body.appendChild(this.video);

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    
    this.targets = new Map();
    this.isProcessing = false;
    this.engineReady = false;

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } })
      .then(stream => {
        this.video.srcObject = stream;
        this.video.onloadedmetadata = () => {
          this.video.play();
          this.canvas.width = this.video.videoWidth;
          this.canvas.height = this.video.videoHeight;
        };
      })
      .catch(err => alert("Permiso de cámara denegado."));

    workerTracker.onmessage = (e) => {
      if (e.data.type === 'READY') {
        this.engineReady = true;
        const loader = document.getElementById('nano-loader');
        if(loader) loader.style.display = 'none';
        console.log("[NanoAR] OpenCV Inicializado (Ecualizado).");
      }
      else if (e.data.type === 'TRACKING_RESULTS') {
        this.updateTargets(e.data.results);
        this.isProcessing = false; 
      }
    };
  },

  registerTarget: function (id, imageSrc) {
    this.targets.set(id, { visible: false });
    
    const img = new Image();
    img.src = imageSrc;
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      const tCtx = tempCanvas.getContext('2d');
      tCtx.drawImage(img, 0, 0);
      const imgData = tCtx.getImageData(0, 0, img.width, img.height);
      
      workerTracker.postMessage({ 
        type: 'REGISTER_TARGET', 
        id: id, 
        imageData: imgData
      });
    };
  },

  updateTargets: function (results) {
    this.targets.forEach(target => target.visible = false);
    
    results.forEach(res => {
      if (this.targets.has(res.id)) {
        const target = this.targets.get(res.id);
        target.visible = true;
        target.position = res.position;
        target.rotation = res.rotation;
      }
    });
  },

  tick: function () {
    if (!this.engineReady || !this.video || this.video.readyState !== 4 || this.isProcessing) return;

    this.isProcessing = true;
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

    workerTracker.postMessage({ type: 'PROCESS_FRAME', imageData: imageData }, [imageData.data.buffer]);
  }
});

AFRAME.registerComponent('nano-target', {
  schema: { 
    image: { type: 'string' },
    threshold: { type: 'number', default: 65 }
  },

  init: function () {
    this.system = this.el.sceneEl.systems['nano-ar'];
    this.id = 'target_' + Math.random().toString(36).substr(2, 9);
    
    this.el.setAttribute('visible', false);
    this.system.registerTarget(this.id, this.data.image, this.data.threshold);
  },

  tick: function () {
    const targetData = this.system.targets.get(this.id);
    if (targetData && targetData.visible) {
      this.el.setAttribute('visible', true);
      this.el.object3D.position.lerp(targetData.position, 0.15);
      
      if (targetData.rotation) {
        let currentRot = this.el.object3D.rotation;
        currentRot.z += (THREE.MathUtils.degToRad(targetData.rotation.z) - currentRot.z) * 0.15;
      }
    } else {
      this.el.setAttribute('visible', false);
    }
  }
});